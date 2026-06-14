import { after } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { setOrderStatusByToken, getOrderStatus, delayOrder, type OrderStatus } from "@/lib/appsScript";
import {
  answerCallbackQuery,
  editMessageText,
  editMessageReplyMarkup,
  sendMessage,
  sendChatAction,
  getFile,
  downloadFile,
  type InlineKeyboard,
} from "@/lib/telegram";
import { actionToStatus, keyboardForStatus, delayKeyboard, delayActionMinutes } from "@/lib/orderMessage";
import { loyverseConfigured, pushReceipt, parseOrderSummary, type LoyverseOrder } from "@/lib/loyverse";
import { isActiveStatus, targetLine, cairoSlotInstant, type ActiveStatus } from "@/lib/sla";
import { confirmationEmail, statusEmail, declineEmail, delayEmail, sendEmail, type StatusEmailStatus } from "@/lib/email";
import type { PaymentMethod } from "@/lib/validation";
// ── Owner-DM agent surface ──
import { runAgent } from "@/lib/assistant/agent";
import {
  getOwnerChatId,
  bindOwner,
  takePendingAction,
  retirePendingAction,
  appendHistory,
  appendAudit,
  confirmCancelKeyboard,
  shouldAlertOwner,
  type IntrusionKind,
} from "@/lib/assistant/state";
import { executeTool } from "@/lib/assistant/tools";
import { transcribeVoice, MAX_VOICE_SECONDS, MAX_VOICE_BYTES } from "@/lib/assistant/voice";
import { analyzePhoto } from "@/lib/assistant/vision";
import { extractPdfText } from "@/lib/assistant/docs";

const PAYMENT_METHODS: LoyverseOrder["paymentMethod"][] = ["cod", "card_on_delivery", "instapay"];

/**
 * Best-effort: push a freshly-approved (pending_approval -> confirmed) order to
 * Loyverse. The webhook only carries the token + new status, so we fetch the
 * order detail from Apps Script (admin-gated fields: phone/address/payment) and
 * reconstruct the line items from the stored order_summary. Never throws; on
 * failure it warns the owner via Telegram. Non-fatal end to end.
 */
async function pushApprovedOrderToLoyverse(token: string, ownerChatId: number): Promise<void> {
  try {
    const detail = await getOrderStatus(token, true);
    if (!detail.success || !detail.order) {
      console.error("[webhook] Loyverse push: could not load order", token, detail.error);
      return;
    }
    const o = detail.order;
    // If private fields are missing, the admin-password gate in Apps Script
    // didn't open (e.g. APPS_SCRIPT_ADMIN_PASSWORD rotated to a non-role value).
    // We can still push, but payment defaults to Cash and the note loses
    // phone/address — warn so it's not silently wrong.
    if (!o.phone && !o.paymentMethod) {
      console.warn("[webhook] Loyverse push: order detail had no private fields — check APPS_SCRIPT_ADMIN_PASSWORD is a valid role password");
    }
    const orderTotal = Number(o.orderTotal) || 0;
    const parsed = parseOrderSummary(o.orderSummary);
    // Fall back to a single custom line item for the total if we couldn't
    // reconstruct the cart (so the sale + total still record in Loyverse).
    const items = parsed.length
      ? parsed
      : [{ name: `Order ${token}`, quantity: 1, price: orderTotal }];
    const paymentMethod = (PAYMENT_METHODS as string[]).includes(o.paymentMethod || "")
      ? (o.paymentMethod as LoyverseOrder["paymentMethod"])
      : "cod";

    const r = await pushReceipt({
      items,
      name: o.name || "",
      phone: o.phone || "",
      address: o.address || "",
      deliverySlot: o.deliverySlot || "",
      paymentMethod,
      orderTotal,
      trackingToken: token,
    });
    if (!r.ok) {
      console.error("[webhook] Loyverse push failed (non-fatal):", r.error);
      await sendMessage(ownerChatId, `⚠️ Order didn't sync to Loyverse: ${r.error || "unknown error"}`).catch(() => {});
    }
  } catch (err) {
    console.error("[webhook] Loyverse push threw (non-fatal):", err);
  }
}

/**
 * Best-effort: fetch the order's CURRENT status and rebuild its normal status
 * keyboard. Used by the delay flow to swap the delay sub-keyboard back to the
 * order's real controls. Returns undefined if the status can't be read (caller
 * then leaves the existing keyboard in place — non-fatal).
 */
async function statusKeyboard(token: string): Promise<InlineKeyboard | undefined> {
  try {
    const detail = await getOrderStatus(token);
    if (detail.success && detail.order?.status) {
      return keyboardForStatus(detail.order.status as OrderStatus, token);
    }
  } catch (err) {
    console.error("[webhook] delay: status fetch failed (non-fatal):", err);
  }
  return undefined;
}

/** Statuses that trigger a customer status-update email (port of STATUS_EMAIL_COPY keys). */
const EMAIL_STATUSES = new Set<string>(["preparing", "out_for_delivery", "delivered"]);

/**
 * Customer email is sent from Vercel via Resend (Apps Script lacks the OAuth
 * scopes). The webhook only carries the token, so each helper re-fetches the
 * order (admin-gated, to get email/name/slot) and sends the matching template.
 * All are non-fatal: they never throw and are deferred via after().
 */
async function sendStatusEmailByToken(token: string, status: StatusEmailStatus): Promise<void> {
  try {
    const detail = await getOrderStatus(token, true);
    const o = detail.order;
    if (!detail.success || !o || !o.email) {
      console.error("[webhook] status email: no order/email for", token, detail.error);
      return;
    }
    const { subject, html } = statusEmail(status, {
      name: o.name,
      deliverySlot: o.deliverySlot,
      trackingToken: token,
    });
    const sent = await sendEmail(o.email, subject, html);
    if (!sent.ok) console.error("[webhook] status email failed (non-fatal):", sent.error);
  } catch (err) {
    console.error("[webhook] status email threw (non-fatal):", err);
  }
}

async function sendDeclineEmailByToken(token: string): Promise<void> {
  try {
    const detail = await getOrderStatus(token, true);
    const o = detail.order;
    if (!detail.success || !o || !o.email) {
      console.error("[webhook] decline email: no order/email for", token, detail.error);
      return;
    }
    const { subject, html } = declineEmail({
      name: o.name,
      deliverySlot: o.deliverySlot,
      openSlotLabels: [],
    });
    const sent = await sendEmail(o.email, subject, html);
    if (!sent.ok) console.error("[webhook] decline email failed (non-fatal):", sent.error);
  } catch (err) {
    console.error("[webhook] decline email threw (non-fatal):", err);
  }
}

async function sendDelayEmailByToken(token: string, oldLabel: string, newLabel: string): Promise<void> {
  try {
    const detail = await getOrderStatus(token, true);
    const o = detail.order;
    if (!detail.success || !o || !o.email) {
      console.error("[webhook] delay email: no order/email for", token, detail.error);
      return;
    }
    const { subject, html } = delayEmail({ name: o.name, oldLabel, newLabel, trackingToken: token });
    const sent = await sendEmail(o.email, subject, html);
    if (!sent.ok) console.error("[webhook] delay email failed (non-fatal):", sent.error);
  } catch (err) {
    console.error("[webhook] delay email threw (non-fatal):", err);
  }
}

/**
 * Best-effort: send the order-confirmation email after an owner Approve tap
 * moves an order from pending_approval → confirmed. Deferred via after() so
 * the Telegram callback is acknowledged instantly. Never throws.
 */
async function sendConfirmationEmailByToken(token: string): Promise<void> {
  try {
    const detail = await getOrderStatus(token, true);
    const o = detail.order;
    if (!detail.success || !o || !o.email) {
      console.error("[webhook] confirmation email: no order/email for", token, detail.error);
      return;
    }
    // Validate the stored paymentMethod against the known enum; fall back to cod.
    const pm = (PAYMENT_METHODS as string[]).includes(o.paymentMethod || "")
      ? (o.paymentMethod as PaymentMethod)
      : ("cod" as PaymentMethod);
    const { subject, html } = confirmationEmail({
      name: o.name,
      orderSummary: o.orderSummary,
      orderTotal: o.orderTotal,
      deliverySlot: o.deliverySlot,
      paymentMethod: pm,
      instapayDetails: pm === "instapay" ? (process.env.INSTAPAY_DETAILS || "") : undefined,
      trackingToken: token,
    });
    const sent = await sendEmail(o.email, subject, html);
    if (!sent.ok) console.error("[webhook] confirmation email failed (non-fatal):", sent.error);
  } catch (err) {
    console.error("[webhook] confirmation email threw (non-fatal):", err);
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Raised from 60 → 90 to give the agent loop + media (voice/vision/PDF) headroom.
// The deadline passed into those calls is maxDuration*1000 − 10s so each leaves
// room to send the owner's reply before Vercel kills the function.
export const maxDuration = 90;
const DEADLINE_RESERVE_MS = 10_000;

interface TgCallback {
  id: string;
  data?: string;
  message?: { message_id: number; chat: { id: number }; text?: string };
}
interface TgVoice {
  file_id: string;
  duration: number;
}
interface TgPhotoSize {
  file_id: string;
  file_size?: number;
}
interface TgDocument {
  file_id: string;
  mime_type?: string;
  file_name?: string;
}
interface TgMessage {
  message_id: number;
  chat: { id: number; type?: string };
  from?: { id: number; username?: string };
  text?: string;
  caption?: string;
  voice?: TgVoice;
  photo?: TgPhotoSize[];
  document?: TgDocument;
}
interface TgUpdate {
  update_id?: number;
  callback_query?: TgCallback;
  message?: TgMessage;
}

function secretOk(received: string | null): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected || !received) return false;
  const a = Buffer.from(received, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    timingSafeEqual(a, a); // constant-time even on length mismatch
    return false;
  }
  return timingSafeEqual(a, b);
}

/** Timing-safe check of the owner-binding password against ADMIN_PASS. */
function passwordOk(received: string): boolean {
  const expected = process.env.ADMIN_PASS;
  if (!expected || !received) return false;
  const a = Buffer.from(received, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

// ── In-memory update_id dedupe ───────────────────────────────────────────────
// Telegram redelivers an update until it gets a 200; on a warm Lambda this
// module-level map prevents a redelivery from double-running heavy work. TTL is
// generous (15 min) — far longer than Telegram's retry window — and entries are
// pruned lazily. Cold starts reset it (acceptable: exactly-once mutations are
// guaranteed by the Blob claim, not by this cache).
const SEEN_UPDATE_TTL_MS = 15 * 60 * 1000;
const seenUpdates = new Map<number, number>();

function alreadySeenUpdate(updateId: number | undefined): boolean {
  if (typeof updateId !== "number") return false;
  const now = Date.now();
  for (const [id, expiry] of seenUpdates) {
    if (expiry <= now) seenUpdates.delete(id);
  }
  if (seenUpdates.has(updateId)) return true;
  seenUpdates.set(updateId, now + SEEN_UPDATE_TTL_MS);
  return false;
}

/** Test-only: clear the dedupe cache between cases. */
export function __resetSeenUpdatesForTest(): void {
  seenUpdates.clear();
}

// ── Owner-DM agent constants ──
const CONFIRM_CANCEL_RE =
  /^(confirm|cancel):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const GENERIC_REFUSAL =
  "Sorry, this is a private assistant and I can only talk to the bistro owner.";
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const MAX_PDF_BYTES = 10 * 1024 * 1024;

const STATUS_LABEL: Record<string, string> = {
  confirmed: "✅ Confirmed",
  declined: "❌ Declined",
  preparing: "👨‍🍳 Being prepared",
  out_for_delivery: "🛵 Out for delivery",
  delivered: "📦 Delivered",
  cancelled: "🚫 Cancelled",
};

// ── Owner-DM agent handlers ──────────────────────────────────────────────────

/**
 * Handle the mutation confirm-gate callbacks (`confirm:<uuid>` / `cancel:<uuid>`)
 * fired from the owner's private DM. These are detected BEFORE the group
 * order-button path and never collide with the order `cancel:<token>` action
 * (that token is not a uuid). Never throws.
 */
async function handleConfirmCallback(cb: TgCallback): Promise<void> {
  const data = cb.data ?? "";
  const message = cb.message;
  if (!message) return;
  const chatId = message.chat.id;
  const messageId = message.message_id;
  const sep = data.indexOf(":");
  const verb = data.slice(0, sep);
  const pendingId = data.slice(sep + 1);

  try {
    // Owner-gate (defense in depth): confirm/cancel taps only ever originate in
    // the owner's DM. Drop anything from another chat before touching state or
    // executing a tool, so executeTool can never run with a non-owner context.
    const owner = await getOwnerChatId();
    if (owner === null || chatId !== owner) {
      await answerCallbackQuery(cb.id).catch(() => {});
      return;
    }

    if (verb === "cancel") {
      await retirePendingAction(pendingId);
      // retirePendingAction returns void and can't distinguish cancelled-in-time
      // from already-gone — either way the action will not run, so just confirm.
      await editMessageText(chatId, messageId, "Cancelled.").catch(() => {});
      await answerCallbackQuery(cb.id, "Cancelled").catch(() => {});
      return;
    }

    // verb === "confirm"
    const taken = await takePendingAction(pendingId);
    if (!taken.ok) {
      const text =
        taken.reason === "expired"
          ? "⏳ That confirmation expired."
          : "This action is no longer available.";
      await editMessageText(chatId, messageId, text).catch(() => {});
      await answerCallbackQuery(cb.id).catch(() => {});
      return;
    }

    const { action } = taken;
    const result = await executeTool(action.tool, action.args, { chatId });
    await editMessageText(chatId, messageId, `${action.summary}\n\n${result}`).catch(() => {});
    await answerCallbackQuery(cb.id, "Done").catch(() => {});
    // The agent never audits — the webhook records the executed mutation here.
    await appendHistory({
      role: "assistant",
      content: `Confirmed and executed: ${action.summary}\nResult: ${result}`,
    });
    await appendAudit({ chatId, kind: "executed-mutation", detail: { tool: action.tool } });
  } catch (err) {
    console.error("[webhook] confirm callback failed (non-fatal):", err);
    await answerCallbackQuery(cb.id).catch(() => {});
  }
}

/** Run one owner text through the agent and send the reply (with a confirm keyboard when gated). */
async function runAgentAndReply(chatId: number, text: string, deadlineAt: number): Promise<void> {
  const res = await runAgent({ chatId, userText: text, deadlineAt });
  if (res.kind === "confirm") {
    await sendMessage(chatId, res.text, confirmCancelKeyboard(res.pendingId));
  } else {
    await sendMessage(chatId, res.text);
  }
}

function voiceFailureMessage(reason: string): string {
  switch (reason) {
    case "too-large":
      return "That voice note is too large for me to process.";
    case "too-slow":
      return "Sorry, I ran out of time transcribing that. Please try a shorter note.";
    case "empty":
      return "I couldn't hear anything in that voice note.";
    case "disabled":
      return "Voice transcription isn't available right now — please type your message.";
    default:
      return "Sorry, I couldn't transcribe that voice note. Please try again or type it.";
  }
}

function pdfFailureMessage(reason: string): string {
  switch (reason) {
    case "too-large":
      return "That PDF is too large (max 10 MB).";
    case "empty":
      return "I couldn't find any text in that PDF.";
    default:
      return "Sorry, I couldn't read that PDF. Please try again.";
  }
}

/**
 * Route an owner-DM message (text / voice / photo / PDF) to the agent. Deferred
 * via after() so the webhook returns 200 immediately. Replies are sent
 * out-of-band with sendMessage. Never throws.
 */
async function routeOwnerMessage(message: TgMessage, deadlineAt: number): Promise<void> {
  const chatId = message.chat.id;
  const caption = message.caption ?? "";
  // Show "typing…" immediately so the owner sees the agent is working while the
  // (possibly multi-second) model/media work runs below. Non-fatal.
  sendChatAction(chatId, "typing").catch(() => {});
  try {
    if (message.voice) {
      if (message.voice.duration > MAX_VOICE_SECONDS) {
        await sendMessage(chatId, "That voice note is too long — please keep it under 5 minutes.");
        return;
      }
      const f = await getFile(message.voice.file_id);
      if (!f.ok || !f.filePath) {
        await sendMessage(chatId, "Sorry, I couldn't fetch that voice note.");
        return;
      }
      const bytes = await downloadFile(f.filePath, MAX_VOICE_BYTES);
      if (!bytes) {
        await sendMessage(chatId, "That voice note was too large to download.");
        return;
      }
      const tr = await transcribeVoice(bytes, deadlineAt);
      if (!tr.ok) {
        await sendMessage(chatId, voiceFailureMessage(tr.reason));
        return;
      }
      await sendMessage(chatId, `🎙 Heard: ${tr.text}`);
      await runAgentAndReply(chatId, tr.text, deadlineAt);
      return;
    }

    if (message.photo && message.photo.length > 0) {
      const largest = message.photo[message.photo.length - 1];
      const f = await getFile(largest.file_id);
      if (!f.ok || !f.filePath) {
        await sendMessage(chatId, "Sorry, I couldn't fetch that photo.");
        return;
      }
      const bytes = await downloadFile(f.filePath, MAX_PHOTO_BYTES);
      if (!bytes) {
        await sendMessage(chatId, "That photo was too large to download.");
        return;
      }
      const out = await analyzePhoto(bytes, caption, deadlineAt);
      if (out.kind === "agent") {
        await sendMessage(chatId, out.echo);
        await runAgentAndReply(chatId, out.instruction, deadlineAt);
      } else {
        await sendMessage(chatId, out.text);
      }
      return;
    }

    if (message.document) {
      if (message.document.mime_type === "application/pdf") {
        const f = await getFile(message.document.file_id);
        if (!f.ok || !f.filePath) {
          await sendMessage(chatId, "Sorry, I couldn't fetch that document.");
          return;
        }
        const bytes = await downloadFile(f.filePath, MAX_PDF_BYTES);
        if (!bytes) {
          await sendMessage(chatId, "That PDF is too large (max 10 MB).");
          return;
        }
        const ex = await extractPdfText(bytes);
        if (!ex.ok) {
          await sendMessage(chatId, pdfFailureMessage(ex.reason));
          return;
        }
        await runAgentAndReply(chatId, `Summarize or act on this document:\n\n${ex.text}`, deadlineAt);
      } else {
        await sendMessage(chatId, "I can only read PDF documents for now.");
      }
      return;
    }

    const text = message.text ?? message.caption ?? "";
    if (text) {
      await runAgentAndReply(chatId, text, deadlineAt);
    }
  } catch (err) {
    console.error("[webhook] owner message routing failed (non-fatal):", err);
    await sendMessage(chatId, "Sorry, something went wrong handling that. Please try again.").catch(() => {});
  }
}

/**
 * Best-effort, rate-limited owner alert on an intrusion attempt (non-owner DM /
 * blocked /start). Delegates the rate-limit decision to `shouldAlertOwner`
 * (alerts.json state) and, when it says yes, DMs the bound owner a PII-LIGHT
 * note: the stranger's id/username + the intrusion kind ONLY — never the
 * message text. Callers must only invoke this when an owner is actually bound.
 * Never throws.
 */
async function alertOwner(
  ownerChatId: number,
  kind: IntrusionKind,
  from: { id?: number; username?: string } | undefined,
): Promise<void> {
  try {
    const strangerId = typeof from?.id === "number" ? from.id : 0;
    if (!(await shouldAlertOwner(strangerId, kind))) return;
    const who = from?.username ? `@${from.username}` : `id ${from?.id ?? "unknown"}`;
    await sendMessage(
      ownerChatId,
      `⚠️ Someone tried to use the bot — ${who} (${kind}). I refused them.`,
    ).catch(() => {});
  } catch (err) {
    console.error("[webhook] owner intrusion alert failed (non-fatal):", err);
  }
}

/**
 * Handle `/start` — owner binding. Binds the first DM that presents the correct
 * ADMIN_PASS (timing-safe); a friendly note if already bound to this chat;
 * otherwise the generic refusal. Never throws.
 */
async function handleStart(message: TgMessage, text: string): Promise<void> {
  const chatId = message.chat.id;
  try {
    const owner = await getOwnerChatId();
    if (owner !== null) {
      if (chatId === owner) {
        await sendMessage(chatId, "✅ You're already connected. Ask me anything about the business.");
      } else {
        // A stranger tried /start after an owner is already bound. Refuse, then
        // alert the bound owner (rate-limited). Distinguish a correct-password
        // rebind attempt (more serious) from a wrong/missing one. Deferred + non-fatal.
        await sendMessage(chatId, GENERIC_REFUSAL);
        const attempted = text.replace(/^\/start(@\S+)?\s*/i, "").trim();
        const kind: IntrusionKind =
          attempted && passwordOk(attempted) ? "start-rebind-blocked" : "start-wrong-pass";
        after(() => alertOwner(owner, kind, message.from));
      }
      return;
    }
    // Owner not yet bound — accept the first chat with the correct password.
    const password = text.replace(/^\/start(@\S+)?\s*/i, "").trim();
    if (password && passwordOk(password)) {
      await bindOwner(chatId);
      await sendMessage(chatId, "✅ Connected. I'm your Bistro Cloud assistant — ask me anything.");
    } else {
      await sendMessage(chatId, GENERIC_REFUSAL);
    }
  } catch (err) {
    console.error("[webhook] /start handling failed (non-fatal):", err);
  }
}

/**
 * Route a non-callback update. Only the bound owner's PRIVATE DM reaches the
 * agent; group messages are ignored and non-owner DMs get a generic refusal.
 * Always returns 200.
 */
async function handleMessageUpdate(message: TgMessage | undefined): Promise<Response> {
  if (!message || !message.chat) {
    return new Response("ok", { status: 200 });
  }
  // Ignore anything that isn't a private DM (groups/channels never run the agent).
  if (message.chat.type !== "private") {
    return new Response("ok", { status: 200 });
  }

  const chatId = message.chat.id;
  const text = message.text ?? message.caption ?? "";

  // /start owner-binding flow (gated by ADMIN_PASS).
  if (/^\/start\b/.test(text)) {
    await handleStart(message, text);
    return new Response("ok", { status: 200 });
  }

  // Fail-closed owner gate: only the bound owner's chat reaches the agent.
  // getOwnerChatId() THROWS on a corrupt/ill-shaped owner record (it refuses to
  // map that to "unbound"). The update_id is already marked seen, so letting the
  // throw escape would 500 and drop the message on Telegram's redelivery. Catch
  // it here (matching handleStart / handleConfirmCallback) and degrade to a
  // graceful reply + 200 so nothing silently vanishes.
  let owner: number | null;
  try {
    owner = await getOwnerChatId();
  } catch (err) {
    console.error("[webhook] owner-gate read failed (non-fatal):", err);
    await sendMessage(chatId, "Sorry, something went wrong on my side. Please try again in a moment.").catch(() => {});
    return new Response("ok", { status: 200 });
  }
  if (owner === null || chatId !== owner) {
    await sendMessage(chatId, GENERIC_REFUSAL).catch(() => {});
    // Proactively notify the bound owner of the intrusion (rate-limited). Only
    // when an owner exists — never when unbound (no one to alert, and a stray
    // /start-less DM pre-binding is not an intrusion). Deferred + non-fatal.
    if (owner !== null) {
      after(() => alertOwner(owner, "unauthorized-message", message.from));
    }
    return new Response("ok", { status: 200 });
  }

  // Owner DM — do the heavy work after the 200 so Telegram never redelivers.
  const deadlineAt = Date.now() + maxDuration * 1000 - DEADLINE_RESERVE_MS;
  after(() => routeOwnerMessage(message, deadlineAt));
  return new Response("ok", { status: 200 });
}

export async function POST(request: Request): Promise<Response> {
  if (!secretOk(request.headers.get("X-Telegram-Bot-Api-Secret-Token"))) {
    return new Response("unauthorized", { status: 401 });
  }

  let update: TgUpdate;
  try {
    update = (await request.json()) as TgUpdate;
  } catch {
    return new Response("ok", { status: 200 }); // never make Telegram redeliver
  }

  // Idempotency: a redelivered update_id must not re-run heavy work.
  if (alreadySeenUpdate(update.update_id)) {
    return new Response("ok", { status: 200 });
  }

  const cb = update.callback_query;
  if (!cb || !cb.data || !cb.message) {
    // Not a callback — route owner-DM messages to the agent (everything else 200).
    return await handleMessageUpdate(update.message);
  }

  // NEW confirm/cancel mutation-gate callbacks fire from the owner's PRIVATE DM,
  // so they must be detected BEFORE the group owner-chat check below. The uuid
  // regex guarantees this branch can never shadow the order `cancel:<token>`
  // action (whose token is not a uuid).
  if (CONFIRM_CANCEL_RE.test(cb.data)) {
    await handleConfirmCallback(cb);
    return new Response("ok", { status: 200 });
  }

  if (process.env.TELEGRAM_OWNER_CHAT_ID && String(cb.message.chat.id) !== process.env.TELEGRAM_OWNER_CHAT_ID) {
    return new Response("ok", { status: 200 });
  }

  const [action, token] = cb.data.split(":");

  // ── "Running late" / delay flow (control actions, NOT status changes) ──
  // Handled before the status path so the delay actions never fall through to
  // the "Unknown action" branch. Everything here is non-fatal and answers 200.
  if (token && (action === "delay" || action === "delayback")) {
    if (action === "delay") {
      // Swap to the +15/+30/+60 sub-keyboard. Message text unchanged; no state change.
      await editMessageReplyMarkup(cb.message.chat.id, cb.message.message_id, delayKeyboard(token)).catch(() => {});
    } else {
      // Back: restore the order's normal status keyboard (leave as-is if unknown).
      const kb = await statusKeyboard(token);
      if (kb) await editMessageReplyMarkup(cb.message.chat.id, cb.message.message_id, kb).catch(() => {});
    }
    await answerCallbackQuery(cb.id).catch(() => {});
    return new Response("ok", { status: 200 });
  }

  const delayMins = delayActionMinutes(action || "");
  if (token && delayMins !== null) {
    try {
      const r = await delayOrder(token, delayMins);
      if (r.success) {
        // Fetch the order's CURRENT state (status + the NEW slot/date, since
        // delayOrder just shifted the slot) so we can both restore its keyboard
        // and refresh the slot-anchored 🎯 target. Non-fatal if it can't be read.
        let detailOrder: { status: string; deliveryDate?: string; deliverySlot?: string } | null = null;
        try {
          const detail = await getOrderStatus(token);
          if (detail.success && detail.order) detailOrder = detail.order;
        } catch (e) {
          console.error("[webhook] delay: status fetch failed (non-fatal):", e);
        }
        const kb = detailOrder?.status
          ? keyboardForStatus(detailOrder.status as OrderStatus, token)
          : undefined;
        // Strip any prior "Delayed" line (so a second delay replaces rather than
        // stacks) AND any stale "🎯" target line (the slot moved, so the
        // slot-anchored target moved too).
        const base = (cb.message.text || "Order")
          .split("\n")
          .filter((line) => !line.startsWith("⏰ Delayed") && !line.startsWith("🎯"))
          .join("\n")
          .replace(/\n+$/, "");
        const etaLine = r.newLabel ? `⏰ Delayed → new ETA ${r.newLabel}` : "⏰ Delayed";
        // Re-append a fresh slot-anchored 🎯 line for the order's current stage.
        let targetSuffix = "";
        if (detailOrder && isActiveStatus(detailOrder.status)) {
          const slotInstant = cairoSlotInstant(detailOrder.deliveryDate || "", detailOrder.deliverySlot || "");
          targetSuffix = `\n${targetLine(detailOrder.status as ActiveStatus, new Date(), slotInstant)}`;
        }
        await editMessageText(cb.message.chat.id, cb.message.message_id, `${base}\n\n${etaLine}${targetSuffix}`, kb).catch(() => {});
        await answerCallbackQuery(cb.id, `ETA +${delayMins} min`).catch(() => {});
        // Email the customer the new ETA (deferred, non-fatal).
        if (r.newLabel) {
          after(() => sendDelayEmailByToken(token, r.oldLabel || "", r.newLabel || ""));
        }
      } else {
        await answerCallbackQuery(cb.id, "Couldn't update").catch(() => {});
      }
    } catch (err) {
      console.error("[webhook] delay failed (non-fatal):", err);
      await answerCallbackQuery(cb.id, "Couldn't update").catch(() => {});
    }
    return new Response("ok", { status: 200 });
  }

  const status = actionToStatus(action || "");
  if (!status || !token) {
    await answerCallbackQuery(cb.id, "Unknown action").catch(() => {});
    return new Response("ok", { status: 200 });
  }

  try {
    const r = await setOrderStatusByToken(token, status);
    if (r.success) {
      const base = (cb.message.text || "Order")
        .split("\n")
        .filter((line) => !line.startsWith("🎯"))
        .join("\n")
        .replace(/\n+$/, "");
      // For active statuses, fetch the live order so the refreshed 🎯 is anchored
      // to the real delivery slot (slot − stage offset), not an entered-relative
      // "now + limit" target — the latter re-introduces false urgency for advance
      // orders whose slot is hours away. Fall back to the entered-relative target
      // only if the fetch fails; gated on isActiveStatus so terminal taps
      // (delivered/cancelled) skip the Apps Script round-trip. The cron, which
      // reads the live delivery_slot, still owns the slot-anchored breach timing.
      let tgt = "";
      if (isActiveStatus(status)) {
        let slotInstant: Date | null = null;
        try {
          const detail = await getOrderStatus(token);
          if (detail.success && detail.order)
            slotInstant = cairoSlotInstant(detail.order.deliveryDate || "", detail.order.deliverySlot || "");
        } catch (e) {
          console.error("[webhook] status-advance slot fetch failed (non-fatal):", e);
        }
        tgt = `\n${targetLine(status, new Date(), slotInstant)}`;
      }
      await editMessageText(
        cb.message.chat.id,
        cb.message.message_id,
        `${base}\n\n— ${STATUS_LABEL[status] || status}${tgt}`,
        keyboardForStatus(status, token),
      );
      await answerCallbackQuery(cb.id, STATUS_LABEL[status] || status);

      // Customer email via Vercel/Resend (deferred, non-fatal). preparing /
      // out_for_delivery / delivered → status email; declined → decline email;
      // pending_approval → confirmed (owner Approve) → confirmation email.
      // Apps Script can't send mail (missing OAuth scopes), so Vercel owns it.
      if (EMAIL_STATUSES.has(status)) {
        after(() => sendStatusEmailByToken(token, status as StatusEmailStatus));
      } else if (status === "declined") {
        after(() => sendDeclineEmailByToken(token));
      }

      // Confirmation email on the genuine pending_approval → confirmed transition.
      // Uses the same previousStatus guard as the Loyverse push to prevent
      // double-sends on re-taps or Telegram webhook redeliveries.
      if (action === "approve" && status === "confirmed" && r.previousStatus === "pending_approval") {
        after(() => sendConfirmationEmailByToken(token));
      }

      // Part 2: push the now-confirmed order to Loyverse (non-fatal). Gate on the
      // GENUINE pending_approval -> confirmed transition (r.previousStatus) so a
      // double-tap or a Telegram webhook redelivery can't create a second
      // receipt — the second call sees previousStatus === "confirmed".
      if (
        action === "approve" &&
        status === "confirmed" &&
        r.previousStatus === "pending_approval" &&
        loyverseConfigured()
      ) {
        // Defer the Loyverse push (cold-fetches a ~300-item catalog) so the
        // owner's Approve tap is acknowledged immediately. Non-fatal either way.
        const chatId = cb.message.chat.id;
        after(() => pushApprovedOrderToLoyverse(token, chatId));
      }
    } else {
      await answerCallbackQuery(cb.id, r.error || "Update failed");
    }
  } catch (err) {
    console.error("[webhook] status update failed:", err);
    await answerCallbackQuery(cb.id, "Update failed").catch(() => {});
  }

  return new Response("ok", { status: 200 });
}
