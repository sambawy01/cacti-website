import { del, get, list, put } from "@vercel/blob";
import type { InlineKeyboard } from "@/lib/telegram";

/**
 * Owner-DM Telegram agent state on Vercel Blob (same private store as the rest
 * of the app, authenticated by BLOB_READ_WRITE_TOKEN).
 *
 * Layout:
 * - telegram/owner.json          — the ONE bound owner chat ({ chatId, boundAt })
 * - telegram/history.json        — rolling conversation memory (last ~12 turns)
 * - telegram/pending/<uuid>.json — confirmation-gated mutations awaiting a tap
 * - telegram/claims/<uuid>.json  — exactly-once claim markers for pending taps
 * - telegram/audit.jsonl         — append-only action log (best effort)
 * - telegram/alerts.json         — intrusion-alert rate-limit state per stranger
 *
 * All reads use `useCache: false` — every document here is read-modify-write
 * and a stale CDN copy would replay an executed pending action or lose turns.
 */

const OWNER_PATH = "telegram/owner.json";
const HISTORY_PATH = "telegram/history.json";
const AUDIT_PATH = "telegram/audit.jsonl";

/** Confirmation window for chat-initiated mutations. */
export const PENDING_TTL_MS = 15 * 60 * 1000;

/** Conversation memory: keep the last 12 turns (24 messages). */
const HISTORY_MAX_MESSAGES = 24;
/** Cap stored message size so one giant brief doesn't bloat every request. */
const HISTORY_MAX_CHARS = 2000;

async function readJson<T>(pathname: string): Promise<T | null> {
  const result = await get(pathname, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) return null;
  try {
    return (await new Response(result.stream).json()) as T;
  } catch {
    return null;
  }
}

async function writeJson(pathname: string, value: unknown): Promise<void> {
  await put(pathname, JSON.stringify(value, null, 2), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

// --- Owner binding -----------------------------------------------------------

interface OwnerRecord {
  chatId: number;
  boundAt: string;
}

/**
 * The bound owner's chat id, or null when NO owner has ever been bound.
 *
 * Fails CLOSED: only a true missing blob (404) means "unbound". A corrupt or
 * ill-shaped owner record throws — mapping it to null would silently reopen
 * one-time binding to the next /start, which is a takeover vector. Callers
 * (webhook route) must treat a throw as a hard error, never as "unbound".
 */
export async function getOwnerChatId(): Promise<number | null> {
  const result = await get(OWNER_PATH, { access: "private", useCache: false });
  // The SDK returns null only for a genuinely missing blob (true 404).
  if (!result) return null;
  if (result.statusCode !== 200) {
    throw new Error(`Owner record read failed (status ${result.statusCode})`);
  }
  let parsed: unknown;
  try {
    parsed = await new Response(result.stream).json();
  } catch {
    throw new Error("Owner record is corrupt (unparseable JSON)");
  }
  const chatId = (parsed as { chatId?: unknown } | null)?.chatId;
  if (typeof chatId !== "number" || !Number.isFinite(chatId)) {
    throw new Error("Owner record is corrupt (ill-shaped chatId)");
  }
  return chatId;
}

/**
 * Bind the owner chat. One-time by design: callers must check
 * `getOwnerChatId()` first and refuse when a binding already exists —
 * re-binding requires manually deleting telegram/owner.json from Blob.
 */
export async function bindOwner(chatId: number): Promise<void> {
  await writeJson(OWNER_PATH, {
    chatId,
    boundAt: new Date().toISOString(),
  } satisfies OwnerRecord);
}

// --- Intrusion alert rate limiting --------------------------------------------

const ALERTS_PATH = "telegram/alerts.json";

/** At most this many owner alerts per stranger chat per rolling window. */
export const ALERT_MAX_PER_WINDOW = 3;
export const ALERT_WINDOW_MS = 60 * 60 * 1000;
/** Drop rate-limit records for strangers idle longer than this. */
const ALERT_RECORD_TTL_MS = 48 * 60 * 60 * 1000;

export type IntrusionKind =
  | "start-wrong-pass" // /start with a wrong (or missing/empty) password
  | "start-rebind-blocked" // /start with the CORRECT password after binding
  | "unauthorized-message" // any other message from a non-owner chat
  | "unauthorized-callback"; // confirmation-button tap from a non-owner

interface AlertRecord {
  windowStart: number;
  count: number;
  /** YYYY-MM-DD (UTC) of the last plain-contact alert consideration. */
  lastContactDay?: string;
}

/**
 * Decide whether an intrusion by `strangerChatId` should produce an alert to
 * the owner, and record the attempt. Policy:
 * - /start attempts (wrong pass, or correct pass post-binding) always alert,
 *   capped at ALERT_MAX_PER_WINDOW per stranger per hour.
 * - Plain messages / callback taps alert only on first contact per stranger
 *   per UTC day, and still count against the hourly cap.
 *
 * Best effort (read-modify-write on Blob, not atomic): if state is
 * unreadable we fail OPEN (alert anyway) — the cap protects the owner from
 * notification noise; it is not a security boundary.
 */
export async function shouldAlertOwner(
  strangerChatId: number,
  kind: IntrusionKind
): Promise<boolean> {
  try {
    const file =
      (await readJson<Record<string, AlertRecord>>(ALERTS_PATH)) ?? {};
    const key = String(strangerChatId);
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);

    let rec = file[key];
    if (
      !rec ||
      !Number.isFinite(rec.windowStart) ||
      now - rec.windowStart >= ALERT_WINDOW_MS
    ) {
      rec = { windowStart: now, count: 0, lastContactDay: rec?.lastContactDay };
    }

    let alert = true;
    if (kind === "unauthorized-message" || kind === "unauthorized-callback") {
      if (rec.lastContactDay === today) alert = false;
      rec.lastContactDay = today;
    }
    if (alert && rec.count >= ALERT_MAX_PER_WINDOW) alert = false;
    if (alert) rec.count += 1;
    file[key] = rec;

    // Keep the file bounded: drop strangers not seen for ALERT_RECORD_TTL_MS.
    for (const [k, v] of Object.entries(file)) {
      const lastDay = v.lastContactDay
        ? Date.parse(`${v.lastContactDay}T00:00:00Z`)
        : 0;
      const lastSeen = Math.max(v.windowStart || 0, lastDay);
      if (now - lastSeen > ALERT_RECORD_TTL_MS) delete file[k];
    }

    await writeJson(ALERTS_PATH, file);
    return alert;
  } catch (error) {
    console.error("[assistant] Alert rate-limit state failed:", error);
    return true;
  }
}

// --- Proactive-notification markers (cron) -----------------------------------
//
// Two tiny single-key blobs that throttle the proactive owner DMs sent from the
// crons. Same private store / read-modify-write pattern as everything else here;
// best effort — a read/write failure must never break a cron run.

const PENDING_REMINDED_PATH = "telegram/pending-reminded.json";
const DIGEST_SENT_PATH = "telegram/digest-sent.json";

/** Re-remind the owner about pending-approval orders at most this often. */
export const PENDING_REMINDER_COOLDOWN_MS = 60 * 60 * 1000;

/**
 * Epoch-ms of the last "N orders awaiting approval" reminder DM, or null if the
 * owner has never been reminded (or the marker is unreadable — fail OPEN so a
 * blip just lets the next reminder through rather than suppressing it forever).
 */
export async function getPendingRemindedAt(): Promise<number | null> {
  const rec = await readJson<{ at?: number }>(PENDING_REMINDED_PATH);
  return rec && typeof rec.at === "number" && Number.isFinite(rec.at) ? rec.at : null;
}

/** Record that the pending-approval reminder DM just went out. */
export async function markPendingReminded(at: number = Date.now()): Promise<void> {
  await writeJson(PENDING_REMINDED_PATH, { at });
}

/**
 * Has the owner-digest for this slot key (`YYYY-MM-DD:slot`, Cairo date) already
 * been sent? Only the LAST slot key is stored: morning and evening keys differ,
 * and a new day's key differs from both, so one key is enough to dedup the
 * current slot while never blocking the next one.
 */
export async function wasDigestSent(key: string): Promise<boolean> {
  const rec = await readJson<{ key?: string }>(DIGEST_SENT_PATH);
  return Boolean(rec && rec.key === key);
}

/** Record that the digest for this slot key just went out. */
export async function markDigestSent(key: string): Promise<void> {
  await writeJson(DIGEST_SENT_PATH, { key, at: new Date().toISOString() });
}

// --- Conversation memory -------------------------------------------------------

export interface HistoryMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  /** Set on tool-result turns so the model can attribute the output. */
  tool_name?: string;
}

export async function loadHistory(): Promise<HistoryMessage[]> {
  const history = await readJson<HistoryMessage[]>(HISTORY_PATH);
  if (!Array.isArray(history)) return [];
  return history.filter(
    (m) =>
      (m?.role === "user" || m?.role === "assistant" || m?.role === "tool") &&
      typeof m?.content === "string"
  );
}

/** Append turns and trim to the rolling window. Never throws (best effort). */
export async function appendHistory(
  ...messages: HistoryMessage[]
): Promise<void> {
  try {
    const history = await loadHistory();
    const next = [
      ...history,
      ...messages.map((m) => ({
        ...m,
        content: m.content.slice(0, HISTORY_MAX_CHARS),
      })),
    ].slice(-HISTORY_MAX_MESSAGES);
    // Ollama requires tool messages to follow an assistant tool_calls turn —
    // trimming must never strand a leading tool message.
    while (next.length > 0 && next[0].role === "tool") next.shift();
    await writeJson(HISTORY_PATH, next);
  } catch (error) {
    console.error("[assistant] Failed to persist history:", error);
  }
}

// --- Pending (confirmation-gated) actions ----------------------------------------

export interface PendingAction {
  id: string;
  chatId: number;
  tool: string;
  args: Record<string, unknown>;
  summary: string;
  createdAt: string;
  /**
   * Per-action confirmation TTL in ms. Absent/invalid = PENDING_TTL_MS
   * (the chat default).
   */
  ttlMs?: number;
}

/** The effective TTL for one pending action (fail safe to the chat default). */
function actionTtlMs(action: Pick<PendingAction, "ttlMs"> | null): number {
  const ttl = action?.ttlMs;
  return typeof ttl === "number" && Number.isFinite(ttl) && ttl > 0
    ? ttl
    : PENDING_TTL_MS;
}

export const PENDING_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const CLAIMS_PREFIX = "telegram/claims/";
export const PENDING_PREFIX = "telegram/pending/";

function pendingPath(id: string): string {
  if (!PENDING_ID_RE.test(id)) {
    // Defense in depth: ids come back via callback_data from the network.
    throw new Error("Invalid pending action id");
  }
  return `${PENDING_PREFIX}${id}.json`;
}

function claimPath(id: string): string {
  if (!PENDING_ID_RE.test(id)) throw new Error("Invalid pending action id");
  return `${CLAIMS_PREFIX}${id}.json`;
}

/**
 * Atomically claim a pending action id — the EXACTLY-ONCE gate. The Blob API
 * enforces `allowOverwrite: false` server-side (x-allow-overwrite: 0): when
 * two taps race, exactly one put succeeds and the loser gets an error. We
 * fail CLOSED on any error (including transport): a tap that cannot prove it
 * claimed first must never execute — `del()` alone cannot provide this
 * because it succeeds silently on already-deleted blobs.
 */
async function claimPending(id: string): Promise<boolean> {
  try {
    await put(claimPath(id), JSON.stringify({ claimedAt: new Date().toISOString() }), {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: false,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Retention horizon for the stale-state sweep: 2× the pending TTL, applied to
 * BOTH prefixes.
 *
 * One shared horizon is deliberate: a claim marker must outlive ANY pending
 * action it could be guarding. If a winning claim's pending delete failed,
 * sweeping the claim on a shorter clock than the pending would make the
 * action re-claimable — i.e. RE-EXECUTABLE — for the rest of the pending's
 * life. Claims are a few bytes each; over-retention is free.
 */
export const STALE_SWEEP_RETENTION_MS = 2 * PENDING_TTL_MS;

/** Pure sweep cutoff rule — exported for the verification harness. */
export function isSweepStale(uploadedAt: string | Date, now: number): boolean {
  const t = new Date(uploadedAt).getTime();
  return Number.isFinite(t) && now - t > STALE_SWEEP_RETENTION_MS;
}

/**
 * Garbage-collect stale claim markers and pending blobs — judged purely by
 * each blob's `uploadedAt` from list(), with NO content reads. This runs
 * piggybacked on createPendingAction, which sits on the agent hot path:
 * content-reading every aged pending there risked timeouts → webhook
 * redelivery → duplicate execution. Over-retention is harmless — an expired
 * pending is refused by takePendingAction's own per-action TTL check
 * regardless of when the sweep removes the blob.
 *
 * Best effort, never throws. Exported for the verification harness;
 * production invokes it fire-and-forget (never awaited on a request path).
 */
export async function sweepStalePendingState(): Promise<void> {
  try {
    const now = Date.now();
    for (const prefix of [CLAIMS_PREFIX, PENDING_PREFIX]) {
      // Single page only (default cap 1000). At this feature's volume — a handful
      // of short-lived pendings/claims under a ~30-min retention horizon — a page
      // is never exceeded; if that ever changes, add a cursor loop here.
      const { blobs } = await list({ prefix });
      for (const blob of blobs) {
        if (isSweepStale(blob.uploadedAt, now)) {
          await del(blob.pathname);
        }
      }
    }
  } catch (error) {
    console.error("[assistant] Stale pending-state sweep failed:", error);
  }
}

export async function createPendingAction(
  action: Omit<PendingAction, "id" | "createdAt"> & { id?: string }
): Promise<PendingAction> {
  const id = action.id ?? crypto.randomUUID();
  if (!PENDING_ID_RE.test(id)) throw new Error("Invalid pending action id");
  const pending: PendingAction = {
    ...action,
    id,
    createdAt: new Date().toISOString(),
  };
  await writeJson(pendingPath(pending.id), pending);
  // Fire-and-forget garbage collection: the sweep must never delay or fail
  // the request path. It catches internally; if the serverless instance
  // freezes before it finishes, the next create retries.
  void sweepStalePendingState();
  return pending;
}

export type TakePendingResult =
  | { ok: true; action: PendingAction }
  | { ok: false; reason: "not-found" | "expired" | "invalid-id" };

/**
 * Fetch a pending action for execution — EXACTLY ONCE. The atomic claim blob
 * (not the delete) is what guarantees a second Confirm tap, or a racing
 * Cancel tap, can never also win: `del()` succeeds silently on
 * already-deleted blobs, so read-then-delete alone is a double-execute race.
 * Expired actions are claimed and deleted too (so the loser sees not-found).
 */
export async function takePendingAction(
  id: string
): Promise<TakePendingResult> {
  if (!PENDING_ID_RE.test(id)) return { ok: false, reason: "invalid-id" };
  const action = await readJson<PendingAction>(pendingPath(id));
  if (!action) return { ok: false, reason: "not-found" };

  // First claimer wins; everyone else treats the action as already handled.
  if (!(await claimPending(id))) return { ok: false, reason: "not-found" };

  // Claim won — remove the pending blob. Best effort: exactly-once is already
  // guaranteed by the claim, so a failed delete must not block execution.
  try {
    await del(pendingPath(id));
  } catch (error) {
    console.error("[assistant] Failed to delete pending action:", error);
  }

  const age = Date.now() - new Date(action.createdAt).getTime();
  if (!Number.isFinite(age) || age > actionTtlMs(action)) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, action };
}

/**
 * Retire a pending action without executing it — the kill switch for a Cancel
 * tap. Goes through the same atomic claim as takePendingAction so Cancel can
 * never race Confirm into a double outcome: the claim marker IS the kill
 * switch (takePendingAction can never win a claimed id), so it is written
 * unconditionally; the pending-blob delete is best effort on top. Never
 * throws.
 *
 * "Claim already taken" is not an error here: Confirm may have been tapped
 * concurrently, in which case its own winner claimed it first.
 */
export async function retirePendingAction(id: string): Promise<void> {
  if (!PENDING_ID_RE.test(id)) return;
  try {
    await claimPending(id); // false = already claimed elsewhere — fine.
    await del(pendingPath(id));
  } catch (error) {
    console.error("[assistant] Failed to retire pending action:", error);
  }
}

// --- Audit log --------------------------------------------------------------------

export interface AuditEntry {
  at: string;
  chatId: number;
  kind: string;
  detail: Record<string, unknown>;
}

/**
 * Append one line to telegram/audit.jsonl. Read-modify-write (no append API
 * on Blob) and strictly best effort — an audit failure never blocks an action.
 */
export async function appendAudit(
  entry: Omit<AuditEntry, "at">
): Promise<void> {
  try {
    const existing = await get(AUDIT_PATH, {
      access: "private",
      useCache: false,
    });
    let text = "";
    if (existing && existing.statusCode === 200) {
      text = await new Response(existing.stream).text();
    }
    const line = JSON.stringify({ at: new Date().toISOString(), ...entry });
    // Keep the log bounded: retain roughly the last 2000 lines.
    const lines = (text ? text.split("\n").filter(Boolean) : []).slice(-1999);
    lines.push(line);
    await put(AUDIT_PATH, lines.join("\n") + "\n", {
      access: "private",
      contentType: "application/x-ndjson",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  } catch (error) {
    console.error("[assistant] Audit append failed:", error);
  }
}

// --- Confirm-gate keyboard ----------------------------------------------------

/**
 * The Confirm/Cancel inline keyboard shown beneath a gated mutation. The
 * pending id is embedded in callback_data; the webhook parses `confirm:<id>`
 * / `cancel:<id>` and routes to takePendingAction / retirePendingAction.
 */
export function confirmCancelKeyboard(pendingId: string): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: "✅ Confirm", callback_data: `confirm:${pendingId}` },
        { text: "❌ Cancel", callback_data: `cancel:${pendingId}` },
      ],
    ],
  };
}
