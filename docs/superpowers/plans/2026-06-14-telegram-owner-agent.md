# Owner-DM Telegram Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing `@CarlitoBC_bot` Telegram webhook into a private, owner-only conversational AI agent that answers questions about the live business and performs operational actions behind a Confirm tap, understanding text, voice, photos, and PDFs.

**Architecture:** Extend the single existing `/api/telegram/webhook` route (never add a second route). Keep the existing Sales-group order-button callbacks (`approve:/preparing:/delay15:`...) untouched; add (a) `message`-type routing that only runs the agent in the bound owner's private DM, and (b) new `confirm:<uuid>` / `cancel:<uuid>` callbacks for the mutation confirm-gate. The agent is an Ollama tool-calling loop; read tools run inline, mutating tools short-circuit into a Blob-stored pending action that executes exactly once on Confirm. Media (voice/photo/PDF) is converted to a text instruction that re-enters the same loop + gate.

**Tech Stack:** Next.js 16 route handler (nodejs runtime), TypeScript, Vitest, `@vercel/blob` (state), `unpdf` (PDF text), Ollama Cloud (`deepseek-v4-flash:cloud` / `deepseek-v4-pro:cloud` / `gemini-3-flash-preview`), Groq Whisper (`whisper-large-v3-turbo`), Google Apps Script backend (existing).

**Reference port source:** `sambawy01/Holistic-Beauty-Website-` @ `main` (the "Vassili" agent). Read files via `gh api repos/sambawy01/Holistic-Beauty-Website-/contents/<path>?ref=main --jq '.content' | base64 -d`. Reference paths are under `vercel-app/src/lib/assistant/` and `vercel-app/src/app/api/telegram/webhook/route.ts`.

**Working directory:** `vercel-app/` (the Next.js app). All paths below are relative to repo root.

**Branch:** all work happens on `feat/telegram-owner-agent` (created in Task 0). Do NOT commit on `main`.

**Existing surface this plan depends on (already in the repo — do not recreate):**
- `vercel-app/src/lib/telegram.ts` — exports `sendMessage(chatId, text, keyboard?)`, `editMessageText(chatId, messageId, text, keyboard?)`, `editMessageReplyMarkup(chatId, messageId, keyboard)`, `answerCallbackQuery(callbackQueryId, text?)`, `telegramConfigured()`, types `InlineKeyboard` / `TelegramResult`. Base call uses `botUrl(method)` + `fetch` with `AbortSignal.timeout(15_000)`, plain text (no `parse_mode`). MISSING (this plan adds): `getFile`, `downloadFile`, `sendDocument`.
- `vercel-app/src/lib/appsScript.ts` — GET-only client (`appsScriptGet`), 20s timeout, admin password via `process.env.APPS_SCRIPT_ADMIN_PASSWORD` passed as query param. Existing actions/clients: `placeOrder`, `orderFinalize(token, instapayDetails?)`, `setOrderStatusByToken(token, status)` (returns `previousStatus`), `delayOrder(token, minutes)`, `getOrderStatus(token, withPrivate?)`, `slaListActiveOrders()`, `markSlaAlerted(token)`. Types `OrderStatus`, `OrderStatusDetail`, `SlaActiveOrder`.
- `vercel-app/src/app/api/telegram/webhook/route.ts` — `secretOk(received)` constant-time check on header `X-Telegram-Bot-Api-Secret-Token` vs `TELEGRAM_WEBHOOK_SECRET`; `runtime="nodejs"`, `dynamic="force-dynamic"`, `maxDuration=60`. Currently handles ONLY `callback_query` order buttons, parsed as `const [action, token] = cb.data.split(":")`, with prefixes `delay`/`delayback`/`delay15`/`delay30`/`delay60`/`approve`/`decline`/`preparing`/`otd`/`delivered`/`cancel`. Uses `after()` from `next/server` for deferred email/Loyverse. **Ignores `message` updates today.**
- Test conventions (mirror exactly): Vitest, `environment: node`, `@` alias → `./src`. Mock modules with `vi.mock("@/lib/...", ...)` BEFORE importing code under test. Mock fetch via `vi.spyOn(globalThis, "fetch")`. Pin clock with `vi.useFakeTimers({ toFake: ["Date"] })` + `vi.setSystemTime(...)` and ALWAYS `vi.useRealTimers()` in `afterEach`. Save/restore `process.env` in `beforeEach`/`afterEach`. Construct webhook requests with `new Request(url, { method, headers: { "X-Telegram-Bot-Api-Secret-Token": SECRET }, body })`.

---

## Task ordering & dependencies

```
Task 0  deps + branch (no tests)
Task 1  telegram.ts: getFile/downloadFile/sendDocument      ──┐
Task 2  appsScript.ts: new read/mutate clients + logExpense ──┤
Task 3  assistant/state.ts: Blob (owner/history/pending/claim/audit)
Task 4  assistant/prompt.ts: Bistro system prompt
Task 5  assistant/tools.ts: schemas + validate + describe + execute  (needs 2)
Task 6  assistant/agent.ts: Ollama loop + confirm short-circuit       (needs 4,5)
Task 7  assistant/voice.ts: Groq Whisper                              (needs 1)
Task 8  assistant/vision.ts: photo→JSON→instruction                  (needs 1)
Task 9  assistant/docs.ts: PDF→text                                  (needs 1)
Task 10 webhook/route.ts: message routing + confirm callbacks         (needs 1,2,3,5,6,7,8,9)
Task 11 scripts/setup-telegram.mjs: register webhook (manual verify)
Task 12 Apps Script .gs: Expenses sheet + logExpense (clasp/curl verify)
Task 13 final review + rollout
```

Tasks 1–9 are independent of each other except where noted and can each be implemented and committed on their own. Task 10 integrates them.

---

## Task 0: Branch + dependencies

**Files:**
- Modify: `vercel-app/package.json`
- Modify: `vercel-app/.env.example`
- Modify: `.env.example` (repo root — keep documentation in sync)

- [ ] **Step 1: Create the feature branch from up-to-date main**

```bash
cd "/Volumes/Sambawy/Dev Projects/Bistro-Cloud-website"
git checkout main && git pull --ff-only origin main
git checkout -b feat/telegram-owner-agent
```

- [ ] **Step 2: Install runtime deps**

```bash
cd vercel-app
npm install @vercel/blob unpdf
```

Expected: `package.json` `dependencies` now include `@vercel/blob` and `unpdf`. (`unpdf` is serverless-friendly, zero native deps; preferred over `pdf-parse`.)

- [ ] **Step 3: Document new env vars in both `.env.example` files**

Append to `vercel-app/.env.example` (and mirror in root `.env.example`):

```bash
# --- Owner-DM Telegram agent ---
# Ollama Cloud API key (brain + vision). https://ollama.com
OLLAMA_API_KEY=
# Owner-binding password for /start <ADMIN_PASS> (timing-safe compared). Keep secret.
ADMIN_PASS=
# Vercel Blob store token (agent state: owner/history/pending/claims/audit).
BLOB_READ_WRITE_TOKEN=
# Optional model overrides (defaults shown):
# OLLAMA_MODEL=deepseek-v4-flash:cloud
# OLLAMA_MODEL_HEAVY=deepseek-v4-pro:cloud
# OLLAMA_MODEL_VISION=gemini-3-flash-preview
```

Note: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_OWNER_CHAT_ID` (the Sales **group** id), `APPS_SCRIPT_URL`, `APPS_SCRIPT_ADMIN_PASSWORD`, `GROQ_API_KEY` already exist and are reused.

- [ ] **Step 4: Verify install + baseline green**

```bash
cd vercel-app && npm test 2>/dev/null | grep -E "Test Files|Tests " && npx tsc --noEmit && echo "baseline clean"
```
Expected: existing tests still pass, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add vercel-app/package.json vercel-app/package-lock.json vercel-app/.env.example .env.example
git commit -m "chore(agent): add @vercel/blob + unpdf deps and env docs for owner-DM agent"
```

---

## Task 1: `telegram.ts` — add `getFile`, `downloadFile`, `sendDocument`

**Files:**
- Modify: `vercel-app/src/lib/telegram.ts`
- Test: `vercel-app/src/lib/telegram.test.ts` (create)

Telegram file download is two hops: `getFile(file_id)` returns a `file_path`; the bytes are then fetched from `https://api.telegram.org/file/bot<TOKEN>/<file_path>`. Voice/photo/PDF handlers all need this.

- [ ] **Step 1: Write the failing test**

Create `vercel-app/src/lib/telegram.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getFile, downloadFile, sendDocument } from "./telegram";

const ORIG = { ...process.env };
beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = "TESTTOKEN";
});
afterEach(() => {
  process.env = { ...ORIG };
  vi.restoreAllMocks();
});

describe("getFile", () => {
  it("resolves a file_path from getFile", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: { file_id: "F", file_path: "voice/file_1.oga", file_size: 1234 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const r = await getFile("F");
    expect(r.ok).toBe(true);
    expect(r.filePath).toBe("voice/file_1.oga");
    expect(r.fileSize).toBe(1234);
  });

  it("returns ok:false on Telegram error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: false, description: "file not found" }), { status: 400 }),
    );
    const r = await getFile("bad");
    expect(r.ok).toBe(false);
  });
});

describe("downloadFile", () => {
  it("fetches bytes from the file endpoint using the bot token", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(bytes, { status: 200 }),
    );
    const out = await downloadFile("voice/file_1.oga", 20 * 1024 * 1024);
    expect(out).not.toBeNull();
    expect(Array.from(out!)).toEqual([1, 2, 3, 4]);
    const url = spy.mock.calls[0][0] as string;
    expect(url).toBe("https://api.telegram.org/file/botTESTTOKEN/voice/file_1.oga");
  });

  it("returns null when the file exceeds the size cap", async () => {
    const big = new Uint8Array(11);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(big, { status: 200, headers: { "content-length": "11" } }),
    );
    const out = await downloadFile("x", 10);
    expect(out).toBeNull();
  });
});

describe("sendDocument", () => {
  it("posts multipart with the document bytes and filename", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 }),
    );
    const r = await sendDocument(123, new Uint8Array([9]), "report.pdf", "here you go");
    expect(r.ok).toBe(true);
    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain("/sendDocument");
    expect(spy.mock.calls[0][1]!.body).toBeInstanceOf(FormData);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd vercel-app && npx vitest run src/lib/telegram.test.ts`
Expected: FAIL — `getFile`/`downloadFile`/`sendDocument` are not exported.

- [ ] **Step 3: Implement**

Append to `vercel-app/src/lib/telegram.ts` (reuse the existing `botUrl` helper and `API_BASE`):

```typescript
export interface GetFileResult {
  ok: boolean;
  filePath?: string;
  fileSize?: number;
  description?: string;
}

/** Resolve a Telegram file_id to a downloadable file_path (step 1 of 2). */
export async function getFile(fileId: string): Promise<GetFileResult> {
  const res = await fetch(botUrl("getFile"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: { file_path?: string; file_size?: number };
    description?: string;
  };
  if (!res.ok || !data.ok || !data.result?.file_path) {
    return { ok: false, description: data.description };
  }
  return { ok: true, filePath: data.result.file_path, fileSize: data.result.file_size };
}

/**
 * Download file bytes from Telegram's file endpoint (step 2 of 2).
 * Returns null if the file exceeds `maxBytes` or the download fails.
 * `maxBytes` is enforced both on Content-Length and on the realized buffer.
 */
export async function downloadFile(filePath: string, maxBytes: number): Promise<Uint8Array | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  const res = await fetch(`${API_BASE}/file/bot${token}/${filePath}`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return null;
  const declared = Number(res.headers.get("content-length") || "0");
  if (declared > maxBytes) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) return null;
  return buf;
}

/** Send a document (e.g. generated PDF) to a chat. Multipart upload. */
export async function sendDocument(
  chatId: string | number,
  bytes: Uint8Array,
  filename: string,
  caption?: string,
): Promise<TelegramResult> {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", caption);
  form.append("document", new Blob([new Uint8Array(bytes)]), filename);
  const res = await fetch(botUrl("sendDocument"), {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: unknown; description?: string };
  if (!res.ok || !data.ok) {
    console.error(`[telegram] sendDocument failed (${res.status}): ${String(data.description).slice(0, 300)}`);
  }
  return { ok: Boolean(data.ok), status: res.status, result: data.result, description: data.description };
}
```

If `API_BASE` is not already module-scoped in `telegram.ts`, confirm it is `const API_BASE = "https://api.telegram.org";` (it is, per the existing file).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd vercel-app && npx vitest run src/lib/telegram.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add vercel-app/src/lib/telegram.ts vercel-app/src/lib/telegram.test.ts
git commit -m "feat(telegram): add getFile/downloadFile/sendDocument for media handling"
```

---

## Task 2: `appsScript.ts` — new read/mutate clients + `logExpense`

**Files:**
- Modify: `vercel-app/src/lib/appsScript.ts`
- Test: `vercel-app/src/lib/appsScript.test.ts` (extend existing)

These wrap Apps Script actions the agent's tools call. **Read actions** (`getAvailability`, `getOrders`, `getCRMOrders`, `getContacts`, `getMenu`, `getStock`, `getPantry`) and **mutate actions** (`toggleVisibility`, `togglePantryVisibility`, `approveRequisition`, `rejectRequisition`, `logExpense`) are assumed to exist server-side EXCEPT `logExpense`, which is created in Task 12. Each client mirrors the existing `appsScriptGet` pattern. Because the server contract for some of these is not yet verified, every new client returns a discriminated `{ success: boolean; ... }` and callers treat non-success as a tool error (never throw into the agent loop).

> **Implementer note:** Before writing each client, confirm the action name and return shape against the live Apps Script if possible (`curl "$APPS_SCRIPT_URL?action=getMenu"` with a PII-free probe). If an action does not exist server-side, flag it in your DONE_WITH_CONCERNS report — the tool that depends on it must degrade gracefully, and Task 12 / a follow-up must add the `.gs` action. Do not silently invent a contract.

- [ ] **Step 1: Write the failing tests**

Append to `vercel-app/src/lib/appsScript.test.ts`:

```typescript
import { getAvailabilitySummary, getOrdersList, getMenuList, logExpense } from "./appsScript";

describe("agent read clients", () => {
  beforeEach(() => {
    process.env.APPS_SCRIPT_URL = "https://script.example/exec";
    process.env.APPS_SCRIPT_ADMIN_PASSWORD = "secret";
  });
  afterEach(() => vi.restoreAllMocks());

  it("getMenuList calls action=getMenu and returns items", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, items: [{ id: "1", name: "Bone Broth", visible: true }] }), { status: 200 }),
    );
    const r = await getMenuList();
    expect(r.success).toBe(true);
    expect((spy.mock.calls[0][0] as string)).toContain("action=getMenu");
  });

  it("getOrdersList passes the admin password and a range param", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, orders: [] }), { status: 200 }),
    );
    await getOrdersList("today");
    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain("action=getOrders");
    expect(url).toContain("password=secret");
    expect(url).toContain("range=today");
  });
});

describe("logExpense", () => {
  beforeEach(() => {
    process.env.APPS_SCRIPT_URL = "https://script.example/exec";
    process.env.APPS_SCRIPT_ADMIN_PASSWORD = "secret";
  });
  afterEach(() => vi.restoreAllMocks());

  it("validates required vendor+amount and forwards them", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, id: "exp-1" }), { status: 200 }),
    );
    const r = await logExpense({ vendor: "Metro", amountEgp: 540, date: "2026-06-14", category: "ingredients", note: "veg" });
    expect(r.success).toBe(true);
    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain("action=logExpense");
    expect(url).toContain("vendor=Metro");
    expect(url).toContain("amount=540");
  });

  it("rejects a missing amount without calling fetch", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const r = await logExpense({ vendor: "Metro", amountEgp: NaN, date: "", category: "other", note: "" });
    expect(r.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd vercel-app && npx vitest run src/lib/appsScript.test.ts`
Expected: FAIL — new clients not exported.

- [ ] **Step 3: Implement the new clients**

Append to `vercel-app/src/lib/appsScript.ts`. Reuse `appsScriptGet` and the admin-password pattern. (Define `adminPassword()` once if not present.)

```typescript
function adminPassword(): string {
  const p = process.env.APPS_SCRIPT_ADMIN_PASSWORD;
  if (!p) throw new Error("APPS_SCRIPT_ADMIN_PASSWORD is not configured");
  return p;
}

// ---- Read clients (admin-gated where they expose PII) ----

export interface MenuItem { id: string; name: string; visible?: boolean; price?: number | string; }
export async function getMenuList(): Promise<{ success: boolean; items?: MenuItem[]; error?: string }> {
  return appsScriptGet({ action: "getMenu" });
}

export interface PantryItem { id: string; name: string; visible?: boolean; }
export async function getPantryList(): Promise<{ success: boolean; items?: PantryItem[]; error?: string }> {
  return appsScriptGet({ action: "getPantry" });
}

export interface StockRow { id: string; name: string; qty?: number | string; unit?: string; }
export async function getStockList(): Promise<{ success: boolean; items?: StockRow[]; error?: string }> {
  return appsScriptGet({ action: "getStock", password: adminPassword() });
}

export interface AvailabilitySlot { slot: string; ordersLeft?: number; itemsLeft?: number; }
export async function getAvailabilitySummary(slot?: string): Promise<{ success: boolean; slots?: AvailabilitySlot[]; error?: string }> {
  return appsScriptGet({ action: "getAvailability", ...(slot ? { slot } : {}) });
}

export interface AdminOrder {
  id: number | string; tracking_token: string; status: string; name: string; phone?: string;
  order_total: number | string; order_summary: string; delivery_date: string; delivery_slot: string; created_at?: string;
}
export async function getOrdersList(range: "today" | "week" = "today"): Promise<{ success: boolean; orders?: AdminOrder[]; error?: string }> {
  return appsScriptGet({ action: "getOrders", password: adminPassword(), range });
}
export async function getCrmOrdersList(range: "today" | "week" = "week"): Promise<{ success: boolean; orders?: AdminOrder[]; error?: string }> {
  return appsScriptGet({ action: "getCRMOrders", password: adminPassword(), range });
}

export interface Contact { name: string; phone?: string; email?: string; orders?: number; }
export async function getContactsList(query: string): Promise<{ success: boolean; contacts?: Contact[]; error?: string }> {
  return appsScriptGet({ action: "getContacts", password: adminPassword(), q: query });
}

// ---- Mutate clients (always reached via the confirm gate) ----

export async function toggleMenuVisibility(id: string, visible: boolean): Promise<{ success: boolean; error?: string }> {
  return appsScriptGet({ action: "toggleVisibility", password: adminPassword(), id, visible: String(visible) });
}
export async function togglePantryVisibility(id: string, visible: boolean): Promise<{ success: boolean; error?: string }> {
  return appsScriptGet({ action: "togglePantryVisibility", password: adminPassword(), id, visible: String(visible) });
}
export async function decideRequisition(id: string, decision: "approve" | "reject"): Promise<{ success: boolean; error?: string }> {
  return appsScriptGet({
    action: decision === "approve" ? "approveRequisition" : "rejectRequisition",
    password: adminPassword(),
    id,
  });
}

export interface LogExpenseArgs { vendor: string; amountEgp: number; date?: string; category?: string; note?: string; }
export async function logExpense(args: LogExpenseArgs): Promise<{ success: boolean; id?: string; error?: string }> {
  const vendor = (args.vendor ?? "").trim();
  if (!vendor) return { success: false, error: "vendor is required" };
  if (!Number.isFinite(args.amountEgp) || args.amountEgp <= 0) return { success: false, error: "amount must be a positive number" };
  return appsScriptGet({
    action: "logExpense",
    password: adminPassword(),
    vendor,
    amount: String(args.amountEgp),
    date: args.date ?? "",
    category: args.category ?? "other",
    note: args.note ?? "",
    source: "telegram-agent",
  });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd vercel-app && npx vitest run src/lib/appsScript.test.ts`
Expected: PASS (existing + 4 new tests).

- [ ] **Step 5: Commit**

```bash
git add vercel-app/src/lib/appsScript.ts vercel-app/src/lib/appsScript.test.ts
git commit -m "feat(appsScript): add agent read/mutate clients + logExpense"
```

---

## Task 3: `assistant/state.ts` — Vercel Blob state

**Files:**
- Create: `vercel-app/src/lib/assistant/state.ts`
- Test: `vercel-app/src/lib/assistant/state.test.ts`

**Port source:** reference `vercel-app/src/lib/assistant/state.ts`. Read it in full:
```bash
gh api repos/sambawy01/Holistic-Beauty-Website-/contents/vercel-app/src/lib/assistant/state.ts?ref=main --jq '.content' | base64 -d
```

Port it **near-verbatim**, applying these Bistro adaptations:
1. Keep the Blob path layout exactly: `telegram/owner.json`, `telegram/history.json`, `telegram/pending/<uuid>.json`, `telegram/claims/<uuid>.json`, `telegram/audit.jsonl`. (Drop `telegram/alerts.json` only if you also drop intrusion alerts — keep it; intrusion alerting is in scope per design §11.)
2. Keep `@vercel/blob` usage exactly (`put` with `access: "private"`, `addRandomSuffix: false`; claim uses `allowOverwrite: false`; `get`/`del`/`list`). These are the load-bearing exactly-once primitives — do not change them.
3. Keep `PendingAction`, `createPendingAction`, `takePendingAction` (atomic claim), `retirePendingAction`, `getOwnerChatId` (fail-closed: throws on corrupt record), `bindOwner`, `loadHistory`, `appendHistory` (24-msg / 2000-char cap, never strand a leading `tool` message), `appendAudit`, `sweepStalePendingState`.
4. `HistoryMessage` role union: `"user" | "assistant" | "tool"`.
5. Remove any Victoria-specific fields/paths; no functional rename needed.

The exactly-once claim MUST be (verbatim from reference):
```typescript
await put(claimPath(id), JSON.stringify({ claimedAt: new Date().toISOString() }), {
  access: "private", contentType: "application/json", addRandomSuffix: false, allowOverwrite: false,
});
```

- [ ] **Step 1: Write the failing tests**

Create `vercel-app/src/lib/assistant/state.test.ts`. Mock `@vercel/blob` with an in-memory store so exactly-once is actually exercised:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// In-memory blob store. `allowOverwrite:false` throws if key exists (mirrors server x-allow-overwrite:0).
const store = new Map<string, string>();
vi.mock("@vercel/blob", () => ({
  put: vi.fn(async (pathname: string, body: string, opts: { allowOverwrite?: boolean }) => {
    if (opts?.allowOverwrite === false && store.has(pathname)) throw new Error("blob exists");
    store.set(pathname, body);
    return { pathname };
  }),
  get: vi.fn(async (pathname: string) => {
    if (!store.has(pathname)) return null;
    return { statusCode: 200, stream: new Response(store.get(pathname)!).body };
  }),
  del: vi.fn(async (pathname: string) => { store.delete(pathname); }),
  list: vi.fn(async ({ prefix }: { prefix: string }) => ({
    blobs: [...store.keys()].filter((k) => k.startsWith(prefix)).map((pathname) => ({ pathname, uploadedAt: new Date().toISOString() })),
  })),
  head: vi.fn(async () => null),
}));

import {
  bindOwner, getOwnerChatId, appendHistory, loadHistory,
  createPendingAction, takePendingAction,
} from "./state";

beforeEach(() => { store.clear(); process.env.BLOB_READ_WRITE_TOKEN = "tok"; });
afterEach(() => vi.restoreAllMocks());

describe("owner binding", () => {
  it("returns null before binding, the chatId after", async () => {
    expect(await getOwnerChatId()).toBeNull();
    await bindOwner(12345);
    expect(await getOwnerChatId()).toBe(12345);
  });
});

describe("history", () => {
  it("caps to the last 24 messages and never strands a leading tool message", async () => {
    for (let i = 0; i < 30; i++) await appendHistory({ role: "user", content: `m${i}` });
    const h = await loadHistory();
    expect(h.length).toBeLessThanOrEqual(24);
    expect(h[0].role).not.toBe("tool");
  });
});

describe("pending action exactly-once", () => {
  it("first take succeeds, second take returns not-found", async () => {
    const p = await createPendingAction({ chatId: 1, tool: "order_delay", args: { token: "t", minutes: 15 }, summary: "delay" });
    const first = await takePendingAction(p.id);
    const second = await takePendingAction(p.id);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd vercel-app && npx vitest run src/lib/assistant/state.test.ts`
Expected: FAIL — module/exports do not exist yet.

- [ ] **Step 3: Implement (port + adapt)**

Create `vercel-app/src/lib/assistant/state.ts` by porting the reference file with the adaptations above. The reference `readJson`/`writeJson` use `get(..., { access: "private", useCache: false })` and read `result.stream` via `new Response(stream).json()`; keep that. Keep `PENDING_ID_RE`, `PENDING_TTL_MS` (15 min), and `actionTtlMs`.

- [ ] **Step 4: Run to verify pass**

Run: `cd vercel-app && npx vitest run src/lib/assistant/state.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add vercel-app/src/lib/assistant/state.ts vercel-app/src/lib/assistant/state.test.ts
git commit -m "feat(agent): port Blob state (owner/history/pending/claims/audit) with exactly-once claim"
```

---

## Task 4: `assistant/prompt.ts` — Bistro system prompt

**Files:**
- Create: `vercel-app/src/lib/assistant/prompt.ts`
- Test: `vercel-app/src/lib/assistant/prompt.test.ts`

Net-new (Bistro persona). A function so the Cairo date can be injected.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "./prompt";

describe("buildSystemPrompt", () => {
  it("includes Cairo date, plain-text rule, confirm-gate rule, and bilingual note", () => {
    const p = buildSystemPrompt(new Date("2026-06-14T12:00:00+03:00"));
    expect(p).toMatch(/Bistro Cloud/);
    expect(p).toMatch(/2026-06-14/);          // injected Cairo date
    expect(p).toMatch(/confirm/i);            // mutating tools need a tap
    expect(p).toMatch(/plain text/i);         // no markdown
    expect(p).toMatch(/Arabic|English/i);     // bilingual
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd vercel-app && npx vitest run src/lib/assistant/prompt.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```typescript
/** Cairo wall-clock date string (yyyy-MM-dd) for prompt grounding. */
function cairoDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

export function buildSystemPrompt(now: Date = new Date()): string {
  const today = cairoDate(now);
  return [
    `You are the private operations assistant for Bistro Cloud, a premium cloud kitchen in El Gouna, Egypt.`,
    `You talk only to the owner, in their private Telegram DM. Today (Cairo time) is ${today}.`,
    ``,
    `Your job: answer questions about the live business and perform operational actions using the tools provided.`,
    `Be concise, warm, and direct. Reply in the owner's language — they may write in English or Arabic; match them.`,
    ``,
    `TOOL RULES:`,
    `- Use READ tools freely to answer questions (orders, capacity, revenue, customers, menu, stock).`,
    `- MUTATING tools (changing order status, delaying, marking out of stock, deciding requisitions, broadcasting to the Sales group, logging an expense) are gated: when you call one, the owner is shown a Confirm button and nothing happens until they tap it. Never claim a mutation is done before confirmation.`,
    `- Look up identifiers (order token, item id) with a read tool BEFORE calling a mutating tool. Never invent ids or amounts.`,
    `- If you lack a required argument, ASK the owner rather than guessing.`,
    ``,
    `FORMAT: reply in PLAIN TEXT only — no markdown, asterisks, or backticks (the chat does not render them).`,
    `Keep answers short unless asked for detail. Times and dates are Cairo time. Currency is EGP.`,
  ].join("\n");
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd vercel-app && npx vitest run src/lib/assistant/prompt.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add vercel-app/src/lib/assistant/prompt.ts vercel-app/src/lib/assistant/prompt.test.ts
git commit -m "feat(agent): Bistro system prompt (Cairo time, plain-text, bilingual, confirm-gate rules)"
```

---

## Task 5: `assistant/tools.ts` — schemas, validation, describe, execute

**Files:**
- Create: `vercel-app/src/lib/assistant/tools.ts`
- Test: `vercel-app/src/lib/assistant/tools.test.ts`

This is the Bistro tool catalog (design §5), wired to the Task 2 Apps Script clients. Mirror the reference's `OllamaTool` shape, `tool()` helper, `MUTATING_TOOLS` set, `requiresConfirmation`, `validateMutationArgs`, `describeMutation`, and add `executeTool` that dispatches to the appsScript clients + computes `revenue_summary`.

Reference for the shapes (read for structure, then write Bistro catalog):
```bash
gh api repos/sambawy01/Holistic-Beauty-Website-/contents/vercel-app/src/lib/assistant/tools.ts?ref=main --jq '.content' | base64 -d
```

**Bistro tool catalog:**

| name | kind | maps to (Task 2 client) |
|---|---|---|
| `orders_active` | read | `slaListActiveOrders()` |
| `order_lookup` | read | `getOrderStatus(token, true)` |
| `capacity_today` | read | `getAvailabilitySummary(slot?)` |
| `revenue_summary` | read | sums `order_total` from `getOrdersList`/`getCrmOrdersList` (TS aggregation) |
| `customer_lookup` | read | `getContactsList(query)` |
| `menu_list` | read | `getMenuList()` |
| `stock_list` | read | `getStockList()` / `getPantryList()` |
| `order_set_status` | mutate | `setOrderStatusByToken(token, status)` |
| `order_delay` | mutate | `delayOrder(token, minutes)` |
| `order_finalize` | mutate | `orderFinalize(token, payment?)` |
| `menu_set_out_of_stock` | mutate | `toggleMenuVisibility(id, !out)` (or pantry variant) |
| `requisition_decide` | mutate | `decideRequisition(id, decision)` |
| `broadcast_group` | mutate | `sendMessage(TELEGRAM_OWNER_CHAT_ID, sanitized)` |
| `log_expense` | mutate | `logExpense(args)` |

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/appsScript", () => ({
  slaListActiveOrders: vi.fn(async () => ({ success: true, orders: [{ tracking_token: "t1", status: "preparing", name: "A", order_summary: "x", delivery_slot: "14:00", delivery_date: "2026-06-14", phone: "" }] })),
  getOrdersList: vi.fn(async () => ({ success: true, orders: [{ order_total: 500 }, { order_total: "300" }] })),
  getCrmOrdersList: vi.fn(async () => ({ success: true, orders: [] })),
  setOrderStatusByToken: vi.fn(async () => ({ success: true, status: "confirmed", previousStatus: "pending_approval" })),
  delayOrder: vi.fn(async () => ({ success: true, newLabel: "14:30" })),
  logExpense: vi.fn(async () => ({ success: true, id: "exp-1" })),
  getMenuList: vi.fn(async () => ({ success: true, items: [] })),
  getStockList: vi.fn(async () => ({ success: true, items: [] })),
  getPantryList: vi.fn(async () => ({ success: true, items: [] })),
  getAvailabilitySummary: vi.fn(async () => ({ success: true, slots: [] })),
  getContactsList: vi.fn(async () => ({ success: true, contacts: [] })),
  toggleMenuVisibility: vi.fn(async () => ({ success: true })),
  togglePantryVisibility: vi.fn(async () => ({ success: true })),
  decideRequisition: vi.fn(async () => ({ success: true })),
  orderFinalize: vi.fn(async () => ({ success: true })),
}));
vi.mock("@/lib/telegram", () => ({ sendMessage: vi.fn(async () => ({ ok: true, status: 200 })) }));

import { TOOLS, requiresConfirmation, validateMutationArgs, describeMutation, executeTool } from "./tools";
import { setOrderStatusByToken, sendMessage } from "@/lib/appsScript";

beforeEach(() => { process.env.TELEGRAM_OWNER_CHAT_ID = "555"; });
afterEach(() => vi.restoreAllMocks());

describe("tool schemas", () => {
  it("declares every catalog tool with a native function schema", () => {
    const names = TOOLS.map((t) => t.function.name);
    for (const n of ["orders_active","order_lookup","capacity_today","revenue_summary","customer_lookup","menu_list","stock_list","order_set_status","order_delay","order_finalize","menu_set_out_of_stock","requisition_decide","broadcast_group","log_expense"]) {
      expect(names).toContain(n);
    }
  });
});

describe("confirmation gate", () => {
  it("read tools never require confirmation", () => {
    expect(requiresConfirmation("orders_active", {})).toBe(false);
  });
  it("mutating tools always require confirmation", () => {
    expect(requiresConfirmation("order_set_status", { token: "t", status: "confirmed" })).toBe(true);
    expect(requiresConfirmation("log_expense", { vendor: "M", amountEgp: 10 })).toBe(true);
  });
});

describe("validateMutationArgs", () => {
  it("rejects an unknown status for order_set_status", () => {
    const r = validateMutationArgs("order_set_status", { token: "t", status: "bogus" });
    expect(r.ok).toBe(false);
  });
  it("coerces a numeric string for order_delay minutes", () => {
    const r = validateMutationArgs("order_delay", { token: "t", minutes: "15" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.args.minutes).toBe(15);
  });
});

describe("executeTool", () => {
  it("revenue_summary aggregates order_total across read sources", async () => {
    const out = await executeTool("revenue_summary", { period: "today" }, { chatId: 1 });
    expect(out).toMatch(/800/); // 500 + 300
  });
  it("order_set_status calls the apps script client", async () => {
    await executeTool("order_set_status", { token: "t1", status: "confirmed" }, { chatId: 1 });
    expect(setOrderStatusByToken).toHaveBeenCalledWith("t1", "confirmed");
  });
  it("broadcast_group sanitizes and sends to the group chat id", async () => {
    await executeTool("broadcast_group", { text: "Closed today‮evil" }, { chatId: 1 });
    expect(sendMessage).toHaveBeenCalled();
    const sent = (sendMessage as any).mock.calls[0];
    expect(sent[0]).toBe("555");
    expect(sent[1]).not.toContain("‮"); // bidi stripped
  });
});
```

(Note: the test imports `sendMessage` from `@/lib/appsScript` only to satisfy the mock object; the real `broadcast_group` imports `sendMessage` from `@/lib/telegram`. Adjust the import in the test to `@/lib/telegram` to assert — keep the assertion against the telegram mock.)

- [ ] **Step 2: Run to verify failure**

Run: `cd vercel-app && npx vitest run src/lib/assistant/tools.test.ts` → FAIL.

- [ ] **Step 3: Implement**

Create `vercel-app/src/lib/assistant/tools.ts`. Include the `OllamaTool` interface + `tool()` helper (from reference), the `TOOLS` array for the catalog above, `MUTATING_TOOLS` set (`order_set_status`, `order_delay`, `order_finalize`, `menu_set_out_of_stock`, `requisition_decide`, `broadcast_group`, `log_expense`), `requiresConfirmation` (all mutating tools always gate — there is no owner-email allowlist concept here), `validateMutationArgs` (string→number coercion for `minutes`/`amountEgp`; enum check for `status` against `OrderStatus`; required-field enforcement from the schema), `describeMutation` (one human-readable summary per mutating tool, e.g. `order_delay` → `Delay order t1 by 15 min`), and:

```typescript
import {
  slaListActiveOrders, getOrderStatus, getAvailabilitySummary, getOrdersList, getCrmOrdersList,
  getContactsList, getMenuList, getStockList, getPantryList,
  setOrderStatusByToken, delayOrder, orderFinalize,
  toggleMenuVisibility, togglePantryVisibility, decideRequisition, logExpense,
} from "@/lib/appsScript";
import { sendMessage } from "@/lib/telegram";

export interface ToolContext { chatId: number; }

/** Strip control + bidi characters before any text is broadcast to the group. */
function sanitizeBroadcast(text: string): string {
  return text.replace(/[ -‪-‮⁦-⁩]/g, "").trim();
}

export async function executeTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  try {
    switch (name) {
      case "orders_active": {
        const r = await slaListActiveOrders();
        if (!r.success || !r.orders) return "No active orders, or the orders source is unavailable.";
        if (r.orders.length === 0) return "No active orders right now.";
        return r.orders.map((o) => `• ${o.name} — ${o.status} — slot ${o.delivery_slot} — ${o.order_summary}`).join("\n");
      }
      case "order_lookup": {
        const r = await getOrderStatus(String(args.token ?? ""), true);
        if (!r.success || !r.order) return "Order not found.";
        const o = r.order;
        return `${o.name}: ${o.status}, slot ${o.deliverySlot} on ${o.deliveryDate}, ${o.orderTotal} EGP — ${o.orderSummary}`;
      }
      case "capacity_today": {
        const r = await getAvailabilitySummary(args.slot ? String(args.slot) : undefined);
        if (!r.success || !r.slots) return "Capacity info unavailable.";
        return r.slots.map((s) => `${s.slot}: ${s.ordersLeft ?? "?"} orders / ${s.itemsLeft ?? "?"} items left`).join("\n") || "No slots configured.";
      }
      case "revenue_summary": {
        const period = args.period === "week" ? "week" : "today";
        const [today, crm] = await Promise.all([getOrdersList(period), getCrmOrdersList(period)]);
        const rows = [...(today.orders ?? []), ...(crm.orders ?? [])];
        const total = rows.reduce((sum, o) => sum + (Number(o.order_total) || 0), 0);
        return `Revenue (${period}): ${total} EGP across ${rows.length} orders.`;
      }
      case "customer_lookup": {
        const r = await getContactsList(String(args.query ?? args.name ?? args.phone ?? ""));
        if (!r.success || !r.contacts?.length) return "No matching customer.";
        return r.contacts.map((c) => `${c.name} — ${c.phone ?? ""} — ${c.orders ?? 0} orders`).join("\n");
      }
      case "menu_list": {
        const r = await getMenuList();
        return r.success && r.items ? r.items.map((i) => `${i.name}${i.visible === false ? " (hidden)" : ""}`).join("\n") : "Menu unavailable.";
      }
      case "stock_list": {
        const [stock, pantry] = await Promise.all([getStockList(), getPantryList()]);
        const lines = [...(stock.items ?? []).map((s) => `${s.name}: ${s.qty ?? "?"} ${s.unit ?? ""}`), ...(pantry.items ?? []).map((p) => `${p.name}${p.visible === false ? " (hidden)" : ""}`)];
        return lines.join("\n") || "Stock unavailable.";
      }
      // ---- mutating (only reached post-confirm) ----
      case "order_set_status": {
        const r = await setOrderStatusByToken(String(args.token), args.status as never);
        return r.success ? `Order set to ${r.status}.` : `Failed: ${r.error ?? "unknown"}`;
      }
      case "order_delay": {
        const r = await delayOrder(String(args.token), Number(args.minutes));
        return r.success ? `Delayed to ${r.newLabel}.` : `Failed: ${r.error ?? "unknown"}`;
      }
      case "order_finalize": {
        const r = await orderFinalize(String(args.token), args.payment ? String(args.payment) : undefined);
        return r.success ? "Order approved/finalized." : `Failed: ${r.error ?? "unknown"}`;
      }
      case "menu_set_out_of_stock": {
        const visible = !(args.outOfStock === true || args.outOfStock === "true");
        const r = args.pantry ? await togglePantryVisibility(String(args.id), visible) : await toggleMenuVisibility(String(args.id), visible);
        return r.success ? `Item ${visible ? "available" : "marked out of stock"}.` : `Failed: ${r.error ?? "unknown"}`;
      }
      case "requisition_decide": {
        const r = await decideRequisition(String(args.id), args.decision === "reject" ? "reject" : "approve");
        return r.success ? `Requisition ${args.decision === "reject" ? "rejected" : "approved"}.` : `Failed: ${r.error ?? "unknown"}`;
      }
      case "broadcast_group": {
        const group = process.env.TELEGRAM_OWNER_CHAT_ID;
        if (!group) return "Group chat id is not configured.";
        const text = sanitizeBroadcast(String(args.text ?? ""));
        if (!text) return "Nothing to broadcast.";
        const r = await sendMessage(group, text);
        return r.ok ? "Broadcast sent to the Sales group." : "Broadcast failed.";
      }
      case "log_expense": {
        const r = await logExpense({ vendor: String(args.vendor ?? ""), amountEgp: Number(args.amountEgp), date: args.date ? String(args.date) : undefined, category: args.category ? String(args.category) : undefined, note: args.note ? String(args.note) : undefined });
        return r.success ? `Expense logged (#${r.id}).` : `Failed: ${r.error ?? "unknown"}`;
      }
      default:
        return `Unknown tool: ${name}`;
    }
  } catch (err) {
    console.error(`[agent] tool ${name} failed:`, err);
    return `The ${name} tool hit an error. Please try again.`;
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd vercel-app && npx vitest run src/lib/assistant/tools.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add vercel-app/src/lib/assistant/tools.ts vercel-app/src/lib/assistant/tools.test.ts
git commit -m "feat(agent): Bistro tool catalog (read/mutate) wired to Apps Script + confirm gate"
```

---

## Task 6: `assistant/agent.ts` — Ollama tool-calling loop

**Files:**
- Create: `vercel-app/src/lib/assistant/agent.ts`
- Test: `vercel-app/src/lib/assistant/agent.test.ts`

**Port source** (read in full, then adapt):
```bash
gh api repos/sambawy01/Holistic-Beauty-Website-/contents/vercel-app/src/lib/assistant/agent.ts?ref=main --jq '.content' | base64 -d
```

Adaptations:
1. System prompt comes from `buildSystemPrompt()` (Task 4).
2. Tool schemas/validation/describe/execute from `./tools` (Task 5).
3. Pending actions from `./state` (Task 3): on a mutating tool that validates, call `createPendingAction({ chatId, tool: name, args: validated.args, summary: describeMutation(...) })` and return `{ kind: "confirm", text, pendingId }`.
4. Keep `MAX_TOOL_ROUNDS = 4`, deadline threading (`deadlineAt`), model routing (fast default; heavy when intent is doc/long-form; the route handler passes vision results as text so the agent itself never needs the vision model), and the heavy→fast fallback.
5. Ollama call exactly as reference: `POST https://ollama.com/api/chat` with `Authorization: Bearer ${OLLAMA_API_KEY}`, body `{ model, stream: false, options: { num_predict: 700 }, messages, tools: TOOLS }`, `AbortSignal.timeout(timeoutMs)`. Response `{ message: { content, tool_calls? } }`. Parse `tool_calls[].function.arguments` (object OR stringified JSON).
6. Public entry: `export async function runAgent(input: { chatId: number; userText: string; deadlineAt: number }): Promise<AgentResult>` where `AgentResult = { kind: "text"; text: string } | { kind: "confirm"; text: string; pendingId: string }`. It loads history, appends the user turn, runs the loop, persists history, returns.

- [ ] **Step 1: Write the failing tests** (mock Ollama via fetch; mock `./tools` + `./state`)

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./state", () => ({
  loadHistory: vi.fn(async () => []),
  appendHistory: vi.fn(async () => {}),
  createPendingAction: vi.fn(async (a: any) => ({ ...a, id: "11111111-1111-1111-1111-111111111111", createdAt: "now" })),
}));
const execMock = vi.fn(async () => "OK-RESULT");
vi.mock("./tools", () => ({
  TOOLS: [{ type: "function", function: { name: "orders_active", description: "", parameters: { type: "object", properties: {}, required: [] } } }],
  requiresConfirmation: (n: string) => n === "order_delay",
  validateMutationArgs: (_n: string, a: any) => ({ ok: true, args: a }),
  describeMutation: () => "Delay order t1 by 15 min",
  executeTool: execMock,
}));
vi.mock("./prompt", () => ({ buildSystemPrompt: () => "SYS" }));

import { runAgent } from "./agent";

function ollamaResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}
beforeEach(() => { process.env.OLLAMA_API_KEY = "k"; });
afterEach(() => vi.restoreAllMocks());

describe("runAgent", () => {
  it("runs a read tool inline then returns the model's final text", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(ollamaResponse({ message: { role: "assistant", content: "", tool_calls: [{ function: { name: "orders_active", arguments: {} } }] } }))
      .mockResolvedValueOnce(ollamaResponse({ message: { role: "assistant", content: "You have 1 active order." } }));
    const out = await runAgent({ chatId: 1, userText: "any active orders?", deadlineAt: Date.now() + 90_000 });
    expect(out.kind).toBe("text");
    if (out.kind === "text") expect(out.text).toContain("active order");
    expect(execMock).toHaveBeenCalledWith("orders_active", {}, { chatId: 1 });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("short-circuits a mutating tool into a confirm result without executing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      ollamaResponse({ message: { role: "assistant", content: "", tool_calls: [{ function: { name: "order_delay", arguments: { token: "t1", minutes: 15 } } }] } }),
    );
    const out = await runAgent({ chatId: 1, userText: "delay t1 by 15", deadlineAt: Date.now() + 90_000 });
    expect(out.kind).toBe("confirm");
    if (out.kind === "confirm") {
      expect(out.pendingId).toMatch(/^[0-9a-f-]{36}$/);
      expect(out.text).toMatch(/confirm/i);
    }
    expect(execMock).not.toHaveBeenCalled(); // not executed until the tap
  });

  it("stops after MAX_TOOL_ROUNDS and returns a graceful message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      ollamaResponse({ message: { role: "assistant", content: "", tool_calls: [{ function: { name: "orders_active", arguments: {} } }] } }),
    );
    const out = await runAgent({ chatId: 1, userText: "loop", deadlineAt: Date.now() + 90_000 });
    expect(out.kind).toBe("text");
  });
});
```

- [ ] **Step 2: Run to verify failure** → FAIL.

- [ ] **Step 3: Implement** the loop per the reference, with the public `runAgent` signature above. Ensure: a tool round that detects a mutating tool returns immediately with `{ kind: "confirm" }`; read tools push `{ role: "tool", tool_name, content }` and continue; after `MAX_TOOL_ROUNDS` rounds with no final text, return a short text fallback; on deadline exhaustion return partial text. Persist `appendHistory` for the user turn and the final assistant text (not for confirm — that is appended by the webhook after execution).

- [ ] **Step 4: Run to verify pass** → PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add vercel-app/src/lib/assistant/agent.ts vercel-app/src/lib/assistant/agent.test.ts
git commit -m "feat(agent): Ollama tool-calling loop with confirm short-circuit + deadline"
```

---

## Task 7: `assistant/voice.ts` — Groq Whisper transcription

**Files:**
- Create: `vercel-app/src/lib/assistant/voice.ts`
- Test: `vercel-app/src/lib/assistant/voice.test.ts`

**Port source** (near drop-in):
```bash
gh api repos/sambawy01/Holistic-Beauty-Website-/contents/vercel-app/src/lib/assistant/voice.ts?ref=main --jq '.content' | base64 -d
```

Keep verbatim: Groq multipart POST to `https://api.groq.com/openai/v1/audio/transcriptions`, model `whisper-large-v3-turbo`, `response_format=json`, no `language` param (auto EN/AR), caps (≤20 MB, ≤300 s), 30s timeout, `TranscriptionOutcome` union. Public entry should accept already-downloaded bytes so the webhook owns the Telegram `getFile`/`downloadFile` hop:
`export async function transcribeVoice(bytes: Uint8Array, deadlineAt: number): Promise<TranscriptionOutcome>`.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { transcribeVoice } from "./voice";

beforeEach(() => { process.env.GROQ_API_KEY = "g"; });
afterEach(() => vi.restoreAllMocks());

describe("transcribeVoice", () => {
  it("posts multipart to Groq and returns text on success", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ text: "what is on the menu" }), { status: 200 }),
    );
    const r = await transcribeVoice(new Uint8Array([1, 2, 3]), Date.now() + 60_000);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe("what is on the menu");
    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain("audio/transcriptions");
    expect(spy.mock.calls[0][1]!.body).toBeInstanceOf(FormData);
  });

  it("returns too-large when bytes exceed 20MB", async () => {
    const r = await transcribeVoice(new Uint8Array(20 * 1024 * 1024 + 1), Date.now() + 60_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("too-large");
  });

  it("returns disabled when GROQ_API_KEY is unset", async () => {
    delete process.env.GROQ_API_KEY;
    const r = await transcribeVoice(new Uint8Array([1]), Date.now() + 60_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("disabled");
  });
});
```

- [ ] **Step 2: Run to verify failure** → FAIL.
- [ ] **Step 3: Implement** (port). Size cap check happens before the fetch; missing key → `{ ok: false, reason: "disabled" }`.
- [ ] **Step 4: Run to verify pass** → PASS (3 tests).
- [ ] **Step 5: Commit**

```bash
git add vercel-app/src/lib/assistant/voice.ts vercel-app/src/lib/assistant/voice.test.ts
git commit -m "feat(agent): Groq Whisper voice transcription (auto EN/AR)"
```

---

## Task 8: `assistant/vision.ts` — photo → JSON → instruction

**Files:**
- Create: `vercel-app/src/lib/assistant/vision.ts`
- Test: `vercel-app/src/lib/assistant/vision.test.ts`

**Port source** (port pattern, replace schema):
```bash
gh api repos/sambawy01/Holistic-Beauty-Website-/contents/vercel-app/src/lib/assistant/vision.ts?ref=main --jq '.content' | base64 -d
```

Adaptations: DROP the skin-assessment guardrail (Victoria-specific). Bistro `VisionKind = "receipt" | "dish" | "product" | "general"`. Vision call unchanged: `POST https://ollama.com/api/chat`, model `gemini-3-flash-preview` (env `OLLAMA_MODEL_VISION`), `options: { temperature: 0 }`, message with `images: [imageBase64]`. Public entry accepts downloaded bytes: `export async function analyzePhoto(bytes: Uint8Array, caption: string, deadlineAt: number): Promise<VisionOutcome>` where `VisionOutcome = { kind: "agent"; instruction: string; echo: string } | { kind: "reply"; text: string }`. A `receipt` extraction synthesizes a `log_expense` instruction (per design §6); `dish`/`product`/`general` synthesize their own instruction or a direct reply.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { analyzePhoto } from "./vision";

function visionResponse(json: unknown) {
  return new Response(JSON.stringify({ message: { content: JSON.stringify(json) } }), { status: 200 });
}
beforeEach(() => { process.env.OLLAMA_API_KEY = "k"; });
afterEach(() => vi.restoreAllMocks());

describe("analyzePhoto", () => {
  it("turns a receipt into a log_expense instruction with the read values", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      visionResponse({ kind: "receipt", vendor: "Metro", totalEgp: 540, date: "2026-06-14", category: "ingredients", text: "" }),
    );
    const out = await analyzePhoto(new Uint8Array([1]), "", Date.now() + 60_000);
    expect(out.kind).toBe("agent");
    if (out.kind === "agent") {
      expect(out.instruction).toMatch(/log_expense/);
      expect(out.instruction).toMatch(/540/);
      expect(out.echo).toMatch(/Metro/);
    }
  });

  it("base64-encodes the image and sends it to the vision model", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      visionResponse({ kind: "general", vendor: "", totalEgp: null, date: "", text: "a plate of food" }),
    );
    await analyzePhoto(new Uint8Array([1, 2, 3]), "what is this", Date.now() + 60_000);
    const body = JSON.parse((spy.mock.calls[0][1]!.body as string));
    expect(body.model).toContain("gemini");
    expect(body.messages.at(-1).images?.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure** → FAIL.
- [ ] **Step 3: Implement** (port + new schema, drop skin guardrail). Use `Buffer.from(bytes).toString("base64")` for the image. `parseJsonLoose` from reference handles models that wrap JSON in prose.
- [ ] **Step 4: Run to verify pass** → PASS (2 tests).
- [ ] **Step 5: Commit**

```bash
git add vercel-app/src/lib/assistant/vision.ts vercel-app/src/lib/assistant/vision.test.ts
git commit -m "feat(agent): vision pipeline (receipt/dish/product/general → agent instruction)"
```

---

## Task 9: `assistant/docs.ts` — PDF → text (net-new)

**Files:**
- Create: `vercel-app/src/lib/assistant/docs.ts`
- Test: `vercel-app/src/lib/assistant/docs.test.ts`

Net-new. Uses `unpdf` (`extractText`). Caps ~10 MB input, truncates extracted text to ~8000 chars before the agent sees it. Non-PDF declined upstream (webhook checks `mime_type`).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("unpdf", () => ({
  getDocumentProxy: vi.fn(async () => ({})),
  extractText: vi.fn(async () => ({ totalPages: 2, text: ["Hello ", "world"] })),
}));
import { extractPdfText } from "./docs";

afterEach(() => vi.restoreAllMocks());

describe("extractPdfText", () => {
  it("joins page text and returns it", async () => {
    const r = await extractPdfText(new Uint8Array([1, 2, 3]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toContain("Hello");
  });
  it("rejects oversize input without parsing", async () => {
    const r = await extractPdfText(new Uint8Array(10 * 1024 * 1024 + 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("too-large");
  });
});
```

- [ ] **Step 2: Run to verify failure** → FAIL.

- [ ] **Step 3: Implement**

```typescript
import { extractText, getDocumentProxy } from "unpdf";

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_CHARS = 8000;

export type PdfOutcome = { ok: true; text: string } | { ok: false; reason: "too-large" | "empty" | "parse-error" };

export async function extractPdfText(bytes: Uint8Array): Promise<PdfOutcome> {
  if (bytes.byteLength > MAX_PDF_BYTES) return { ok: false, reason: "too-large" };
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: false });
    const joined = (Array.isArray(text) ? text.join(" ") : String(text)).trim();
    if (!joined) return { ok: false, reason: "empty" };
    return { ok: true, text: joined.slice(0, MAX_TEXT_CHARS) };
  } catch (err) {
    console.error("[agent] PDF extract failed:", err);
    return { ok: false, reason: "parse-error" };
  }
}
```

- [ ] **Step 4: Run to verify pass** → PASS (2 tests).
- [ ] **Step 5: Commit**

```bash
git add vercel-app/src/lib/assistant/docs.ts vercel-app/src/lib/assistant/docs.test.ts
git commit -m "feat(agent): PDF text extraction via unpdf (capped + truncated)"
```

---

## Task 10: `webhook/route.ts` — message routing + confirm callbacks

**Files:**
- Modify: `vercel-app/src/app/api/telegram/webhook/route.ts`
- Test: `vercel-app/src/app/api/telegram/webhook/route.test.ts` (extend; **do not break existing order-button tests**)

This integrates everything. **Critical constraints:**
1. The existing order-button callback handling (`approve:/preparing:/delay15:`...) MUST keep working unchanged. Add the new `confirm:`/`cancel:` branch by checking those prefixes FIRST in the callback handler and returning early; everything else falls through to the existing order-button logic.
2. `message` updates are currently ignored. Add routing, but ONLY act on the bound owner's private DM. Group messages (`chat.type !== "private"` or `chat.id === TELEGRAM_OWNER_CHAT_ID` group) and non-owner DMs are ignored/refused.
3. Raise `export const maxDuration = 90;` and compute `deadlineAt = Date.now() + maxDuration*1000 - 10_000`.
4. Add in-memory `update_id` dedupe (per reference §7) so a Telegram redelivery does not double-run.
5. Always return `200` once the secret check passes; do real work via `after()` where possible so Telegram never redelivers. Owner replies are sent out-of-band with `sendMessage`.

Routing logic to add (pseudostructure — implement with real code):

```
POST(request):
  if (!secretOk(header)) return 401            // unchanged
  update = parse json
  if (alreadySeenUpdate(update.update_id)) return 200
  if (update.callback_query):
     data = cb.data
     if (/^(confirm|cancel):<uuid>$/.test(data)) -> handleConfirmCallback(cb); return 200
     else -> <EXISTING order-button handling unchanged>
  if (update.message):
     msg = update.message
     if (msg.chat.type !== "private") return 200          // ignore group
     text = msg.text ?? msg.caption ?? ""
     // /start binding (owner gating)
     if (/^\/start/.test(text)) -> handleStart(msg, text); return 200
     owner = await getOwnerChatId()                         // fail-closed
     if (owner === null || msg.chat.id !== owner):
        await sendMessage(msg.chat.id, REFUSAL); return 200
     // owner DM — route by type, deadline-bounded, deferred:
     after(async () => {
        if (msg.voice)      -> getFile+downloadFile -> transcribeVoice -> runAgentAndReply(text=transcript)
        else if (msg.photo) -> largest -> getFile+downloadFile -> analyzePhoto -> (echo + runAgentAndReply(instruction) | reply)
        else if (msg.document?.mime_type === "application/pdf") -> getFile+downloadFile -> extractPdfText -> runAgentAndReply("Summarize/act on this document:\n"+text)
        else if (text)      -> runAgentAndReply(text)
     })
     return 200

handleConfirmCallback(cb):
  match verb,pendingId
  if (verb === "cancel"): await retirePendingAction(pendingId); editMessageText("Cancelled."); return
  taken = await takePendingAction(pendingId)
  if (!taken.ok): editMessageText(expired/gone message); return
  result = await executeTool(taken.action.tool, taken.action.args, { chatId })
  editMessageText(`${taken.action.summary}\n\n${result}`)
  appendHistory({ role: "assistant", content: `Confirmed and executed: ${summary}\nResult: ${result}` })

runAgentAndReply(chatId, text, deadlineAt):
  res = await runAgent({ chatId, userText: text, deadlineAt })
  if (res.kind === "confirm"): sendMessage(chatId, res.text, confirmCancelKeyboard(res.pendingId))
  else: sendMessage(chatId, res.text)
```

Add a `confirmCancelKeyboard(pendingId)` helper (in `state.ts` or inline) producing `{ inline_keyboard: [[{text:"✅ Confirm", callback_data:`confirm:${id}`},{text:"❌ Cancel", callback_data:`cancel:${id}`}]] }`.

- [ ] **Step 1: Write the failing tests** (extend existing file; mock the new modules)

Add to `vercel-app/src/app/api/telegram/webhook/route.test.ts` (keep all existing tests passing):

```typescript
// New mocks for the agent surface (add alongside existing appsScript/telegram mocks):
vi.mock("@/lib/assistant/agent", () => ({
  runAgent: vi.fn(async () => ({ kind: "text", text: "Here is your answer." })),
}));
vi.mock("@/lib/assistant/state", () => ({
  getOwnerChatId: vi.fn(async () => 777),
  bindOwner: vi.fn(async () => {}),
  takePendingAction: vi.fn(async () => ({ ok: true, action: { tool: "order_delay", args: { token: "t", minutes: 15 }, summary: "Delay order t by 15 min" } })),
  retirePendingAction: vi.fn(async () => {}),
  appendHistory: vi.fn(async () => {}),
  confirmCancelKeyboard: (id: string) => ({ inline_keyboard: [[{ text: "✅ Confirm", callback_data: `confirm:${id}` }, { text: "❌ Cancel", callback_data: `cancel:${id}` }]] }),
}));
vi.mock("@/lib/assistant/tools", () => ({ executeTool: vi.fn(async () => "Delayed to 14:30.") }));

// helpers
function ownerDm(text: string) {
  return { update_id: Math.floor(Math.random() * 1e9), message: { message_id: 1, chat: { id: 777, type: "private" }, from: { id: 777 }, text } };
}
function strangerDm(text: string) {
  return { update_id: Math.floor(Math.random() * 1e9), message: { message_id: 1, chat: { id: 999, type: "private" }, from: { id: 999 }, text } };
}
function groupMsg(text: string) {
  return { update_id: Math.floor(Math.random() * 1e9), message: { message_id: 1, chat: { id: -100, type: "group" }, from: { id: 5 }, text } };
}

describe("owner-DM agent routing", () => {
  it("runs the agent for the bound owner's text and replies", async () => {
    await POST(req(ownerDm("any active orders?")));
    await flushAfter();
    const { runAgent } = await import("@/lib/assistant/agent");
    expect(runAgent).toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalled();
  });

  it("ignores group messages (never runs the agent)", async () => {
    const { runAgent } = await import("@/lib/assistant/agent");
    (runAgent as any).mockClear();
    await POST(req(groupMsg("delete everything")));
    await flushAfter();
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("refuses a non-owner DM without running the agent", async () => {
    const { runAgent } = await import("@/lib/assistant/agent");
    (runAgent as any).mockClear();
    await POST(req(strangerDm("hi")));
    await flushAfter();
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("a confirm tap executes the pending action exactly once", async () => {
    const data = "confirm:11111111-1111-1111-1111-111111111111";
    await POST(req({ update_id: 42, callback_query: { id: "c", data, message: { message_id: 9, chat: { id: 777 } } } }));
    const { executeTool } = await import("@/lib/assistant/tools");
    expect(executeTool).toHaveBeenCalledWith("order_delay", { token: "t", minutes: 15 }, expect.objectContaining({ chatId: 777 }));
  });

  it("a cancel tap retires the pending action and does not execute", async () => {
    const { executeTool } = await import("@/lib/assistant/tools");
    (executeTool as any).mockClear();
    const data = "cancel:11111111-1111-1111-1111-111111111111";
    await POST(req({ update_id: 43, callback_query: { id: "c", data, message: { message_id: 9, chat: { id: 777 } } } }));
    expect(executeTool).not.toHaveBeenCalled();
  });
});

describe("existing order buttons still work", () => {
  it("an approve tap still maps to setOrderStatusByToken(confirmed)", async () => {
    // existing assertion — ensure the new confirm:/cancel: branch did not shadow it
    await POST(req(update("approve:tok-xyz")));
    expect(setOrderStatusByToken).toHaveBeenCalledWith("tok-xyz", "confirmed");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd vercel-app && npx vitest run src/app/api/telegram/webhook/route.test.ts`
Expected: new tests FAIL; existing tests still present.

- [ ] **Step 3: Implement** the routing in `route.ts` per the structure above. Order matters: in the callback handler, test `^(confirm|cancel):` FIRST and return; otherwise fall through to the unchanged order-button code. Import `runAgent`, `getOwnerChatId`, `bindOwner`, `takePendingAction`, `retirePendingAction`, `appendHistory`, `confirmCancelKeyboard` from the assistant modules; `executeTool` from `./tools`; `getFile`/`downloadFile` from `@/lib/telegram`; `transcribeVoice`/`analyzePhoto`/`extractPdfText` from the assistant modules. Bump `maxDuration = 90`. Add the in-memory `alreadySeenUpdate`.

- [ ] **Step 4: Run to verify pass**

Run: `cd vercel-app && npx vitest run src/app/api/telegram/webhook/route.test.ts`
Then full suite: `cd vercel-app && npm test 2>/dev/null | grep -E "Test Files|Tests " && npx tsc --noEmit`
Expected: all green (existing + new), tsc clean.

- [ ] **Step 5: Commit**

```bash
git add vercel-app/src/app/api/telegram/webhook/route.ts vercel-app/src/app/api/telegram/webhook/route.test.ts
git commit -m "feat(telegram): route owner-DM messages to the agent + confirm/cancel callbacks (order buttons unchanged)"
```

---

## Task 11: `scripts/setup-telegram.mjs` — webhook registration

**Files:**
- Create: `vercel-app/scripts/setup-telegram.mjs`

**Port source:**
```bash
gh api repos/sambawy01/Holistic-Beauty-Website-/contents/vercel-app/scripts/setup-telegram.mjs?ref=main --jq '.content' | base64 -d
```

Adaptations: `WEBHOOK_URL = "https://bistro-cloud-orders.vercel.app/api/telegram/webhook"`. Keep `allowed_updates: ["message", "callback_query"]`, `drop_pending_updates: true`, `secret_token: SECRET`. Modes `--info` / `--delete`. Reads `TELEGRAM_BOT_TOKEN` + `TELEGRAM_WEBHOOK_SECRET` from env/.env.local.

- [ ] **Step 1: Create the script** (no unit test — it talks to the live Telegram API).
- [ ] **Step 2: Dry-run info mode locally** (requires the bot token in env):

```bash
cd vercel-app && node scripts/setup-telegram.mjs --info
```
Expected: prints `Bot: @CarlitoBC_bot (id …)` and current `getWebhookInfo`.

- [ ] **Step 3: Commit**

```bash
git add vercel-app/scripts/setup-telegram.mjs
git commit -m "chore(agent): setup-telegram script (allowed_updates incl. message)"
```

> Actually registering the webhook with `allowed_updates: ["message","callback_query"]` happens in Task 13 rollout, AFTER deploy.

---

## Task 12: Apps Script — `Expenses` sheet + `logExpense` action

**Files:**
- Modify: the Google Apps Script project (`.gs`) — location per the existing `clasp` setup in this repo (search for `Code.gs`/`appsscript.json`).

Net-new server action. **Not unit-tested** (project convention: verified by `clasp` deploy + `curl` PII-free probe).

- [ ] **Step 1: Locate the Apps Script source**

```bash
cd "/Volumes/Sambawy/Dev Projects/Bistro-Cloud-website"
find . -name "appsscript.json" -o -name "Code.gs" -o -name "*.gs" | grep -v node_modules
```
If `clasp` is configured, the `.gs` lives in a synced dir. If not present locally, edit in the Apps Script editor and `clasp pull` after.

- [ ] **Step 2: Add the `Expenses` sheet bootstrap** (in the existing migrate-style helper or a new `ensureExpensesSheet_()`), columns: `id, timestamp, vendor, amount_egp, date, category, note, source, logged_by`. Use the same Sheets text-coercion guard the Orders sheet uses for `amount_egp` and `date`.

- [ ] **Step 3: Add the `logExpense` action** to the admin `switch` (password-gated like other admin actions):

```javascript
case 'logExpense': {
  if (!isAdmin_(e)) return json_({ success: false, error: 'unauthorized' });
  var vendor = String(e.parameter.vendor || '').trim();
  var amount = Number(e.parameter.amount);
  if (!vendor) return json_({ success: false, error: 'vendor required' });
  if (!isFinite(amount) || amount <= 0) return json_({ success: false, error: 'amount required' });
  var sheet = ensureExpensesSheet_();
  var id = 'exp-' + Date.now();
  sheet.appendRow([
    id, new Date(), vendor, amount,
    String(e.parameter.date || ''), String(e.parameter.category || 'other'),
    String(e.parameter.note || ''), String(e.parameter.source || ''), 'telegram-agent'
  ]);
  return json_({ success: true, id: id });
}
```
(Use the project's actual admin-check helper name and `json_` responder — match the existing actions in the file.)

- [ ] **Step 4: Deploy + verify** (per project convention — deploy in place to the current `@N`):

```bash
clasp push
clasp deploy            # or redeploy the existing deployment id in place
# PII-free probe (uses the admin password; logs a $0.01 test row):
curl -s "$APPS_SCRIPT_URL?action=logExpense&password=$APPS_SCRIPT_ADMIN_PASSWORD&vendor=TEST&amount=1&category=test&note=probe&source=verify"
```
Expected: `{"success":true,"id":"exp-..."}` and a new row in the `Expenses` sheet. Delete the probe row afterward.

- [ ] **Step 5: Commit** (the synced `.gs` if tracked in-repo)

```bash
git add <apps-script-dir>
git commit -m "feat(apps-script): Expenses sheet + logExpense admin action"
```

---

## Task 13: Final review + rollout

- [ ] **Step 1: Full suite + types green**

```bash
cd vercel-app && npm test 2>/dev/null | grep -E "Test Files|Tests " && npx tsc --noEmit && echo "all green"
```

- [ ] **Step 2: Dispatch the final whole-implementation code review** (subagent-driven skill does this automatically). Address findings before merge.

- [ ] **Step 3: Provision env + Blob store** (each `vercel env add` via the reliable stdin method):

```bash
cd vercel-app
# create a Blob store in the Vercel dashboard (Storage → Blob) → it auto-sets BLOB_READ_WRITE_TOKEN, or:
printf '%s' "$OLLAMA_KEY"  | vercel env add OLLAMA_API_KEY production
printf '%s' "$ADMIN_PASS"  | vercel env add ADMIN_PASS production
# BLOB_READ_WRITE_TOKEN is set automatically when the Blob store is linked to the project.
```

- [ ] **Step 4: Deploy + register webhook**

```bash
cd vercel-app && vercel --prod --yes
node scripts/setup-telegram.mjs           # registers allowed_updates incl. "message"
node scripts/setup-telegram.mjs --info     # confirm pending_update_count + allowed_updates
```

- [ ] **Step 5: Smoke test (live, per design §15)** — DM the bot:
  1. `/start <ADMIN_PASS>` → bound greeting.
  2. "any active orders?" → read answer.
  3. Send a voice note ("what's on the menu") → "🎙 Heard…" then a reply.
  4. Photograph a receipt → echo + Confirm → tap → check the `Expenses` sheet row.
  5. "delay order <token> by 15 minutes" → Confirm → tap → verify the Sales-group ticket reflects the delay.
  6. From a different Telegram account, DM the bot → generic refusal, agent never runs.

- [ ] **Step 6: Finish the branch** — use `superpowers:finishing-a-development-branch` (merge/PR per project flow; two-phase review already satisfied by the per-task + final reviews).

---

## Self-Review (run by plan author before handoff)

**Spec coverage (design §):** §2 scope → Tasks 5 (tools), 7/8/9 (voice/vision/docs); §3 architecture (extend single route) → Task 10; §4 components → Tasks 1–11 (each module mapped); §5 tool catalog → Task 5 table; §6 vision → Task 8; §7 voice → Task 7; §8 documents → Task 9; §9 expense logging → Tasks 2 (client) + 12 (sheet/action); §10 state → Task 3; §11 security (owner binding, confirm gate, secret reuse, no parse_mode, broadcast sanitize) → Tasks 3/5/10; §12 model stack/env → Tasks 0/6/8; §13 deadlines/200-fast → Tasks 6/10; §14 testing → tests in every task (Apps Script excluded per convention, Task 12); §15 rollout → Task 13; §16 future phases → out of scope (correctly omitted).

**Gaps flagged for the implementer (resolve during execution, not blockers to starting):**
- Task 2 assumes server-side actions (`getAvailability`, `getOrders`, `getCRMOrders`, `getContacts`, `getMenu`, `getStock`, `getPantry`, `toggleVisibility`, `togglePantryVisibility`, `approveRequisition`, `rejectRequisition`) exist. Verify each with a probe; any missing action becomes a `.gs` addition (extend Task 12) and the dependent tool must degrade gracefully. This is the single biggest unknown — verify early.
- Confirm `@CarlitoBC_bot` token is the same bot used for order tickets (design says reuse). If a separate bot is desired for DMs, that changes `setup-telegram` and the owner-id model.

**Placeholder scan:** no "TBD"/"handle edge cases"/"similar to" — ports cite the exact reference path + concrete adaptations + full test code.

**Type consistency:** `runAgent` returns `{kind:"text"|"confirm"}` (Tasks 6, 10 agree); `PendingAction.tool/args/summary` (Tasks 3, 5, 10 agree); appsScript client names (Tasks 2, 5 agree); `executeTool(name, args, {chatId})` signature (Tasks 5, 6, 10 agree).
