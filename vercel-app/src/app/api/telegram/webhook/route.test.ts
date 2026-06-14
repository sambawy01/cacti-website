import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The approve-path Loyverse push is deferred via after(); capture + run on demand.
const deferred: Array<() => unknown> = [];
vi.mock("next/server", () => ({
  after: (cb: () => unknown) => {
    deferred.push(cb);
  },
}));
async function flushAfter(): Promise<void> {
  const cbs = deferred.splice(0);
  for (const cb of cbs) await cb();
}

vi.mock("@/lib/appsScript", () => ({
  setOrderStatusByToken: vi.fn(async () => ({ success: true, status: "confirmed", previousStatus: "pending_approval" })),
  getOrderStatus: vi.fn(async () => ({
    success: true,
    order: {
      name: "Sara Ali", status: "confirmed", deliveryDate: "2026-06-13", deliverySlot: "14:30",
      orderSummary: "2x Grilled Chicken (400 EGP)", orderTotal: 400,
      email: "sara@example.com",
      phone: "+201001234567", address: "12 West Golf", note: "Instapay (bank transfer)", paymentMethod: "instapay",
    },
  })),
  delayOrder: vi.fn(async () => ({ success: true, oldLabel: "2:30 PM", newLabel: "3:00 PM" })),
}));
vi.mock("@/lib/email", () => ({
  confirmationEmail: vi.fn(() => ({ subject: "confirm-subject", html: "<p>confirm</p>" })),
  statusEmail: vi.fn(() => ({ subject: "status-subject", html: "<p>status</p>" })),
  declineEmail: vi.fn(() => ({ subject: "decline-subject", html: "<p>decline</p>" })),
  delayEmail: vi.fn(() => ({ subject: "delay-subject", html: "<p>delay</p>" })),
  sendEmail: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/telegram", () => ({
  answerCallbackQuery: vi.fn(async () => ({ ok: true, status: 200 })),
  editMessageText: vi.fn(async () => ({ ok: true, status: 200 })),
  editMessageReplyMarkup: vi.fn(async () => ({ ok: true, status: 200 })),
  sendMessage: vi.fn(async () => ({ ok: true, status: 200 })),
  sendChatAction: vi.fn(async () => ({ ok: true, status: 200 })),
  getFile: vi.fn(async () => ({ ok: true, filePath: "voice/file_1.oga", fileSize: 10 })),
  downloadFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
}));
vi.mock("@/lib/loyverse", () => ({
  loyverseConfigured: vi.fn(() => true),
  pushReceipt: vi.fn(async () => ({ ok: true, receiptNumber: "1-1001" })),
  parseOrderSummary: vi.fn((s: string) =>
    s === "2x Grilled Chicken (400 EGP)" ? [{ name: "Grilled Chicken", quantity: 2, price: 200 }] : []),
}));

// ── Owner-DM agent surface (new in Task 10) ──
vi.mock("@/lib/assistant/agent", () => ({
  runAgent: vi.fn(async () => ({ kind: "text", text: "Here is your answer." })),
}));
vi.mock("@/lib/assistant/state", () => ({
  getOwnerChatId: vi.fn(async () => 777),
  bindOwner: vi.fn(async () => {}),
  shouldAlertOwner: vi.fn(async () => true),
  takePendingAction: vi.fn(async () => ({
    ok: true,
    action: { tool: "order_delay", args: { token: "t", minutes: 15 }, summary: "Delay order t by 15 min" },
  })),
  retirePendingAction: vi.fn(async () => {}),
  appendHistory: vi.fn(async () => {}),
  appendAudit: vi.fn(async () => {}),
  confirmCancelKeyboard: (id: string) => ({
    inline_keyboard: [[
      { text: "✅ Confirm", callback_data: `confirm:${id}` },
      { text: "❌ Cancel", callback_data: `cancel:${id}` },
    ]],
  }),
}));
vi.mock("@/lib/assistant/tools", () => ({ executeTool: vi.fn(async () => "Delayed to 14:30.") }));
vi.mock("@/lib/assistant/voice", () => ({
  MAX_VOICE_SECONDS: 300,
  MAX_VOICE_BYTES: 20 * 1024 * 1024,
  transcribeVoice: vi.fn(async () => ({ ok: true, text: "what is on the menu" })),
}));
vi.mock("@/lib/assistant/vision", () => ({
  analyzePhoto: vi.fn(async () => ({ kind: "reply", text: "That looks like a plate of food." })),
}));
vi.mock("@/lib/assistant/docs", () => ({
  extractPdfText: vi.fn(async () => ({ ok: true, text: "PDF body text" })),
}));

import { POST, __resetSeenUpdatesForTest } from "./route";
import { setOrderStatusByToken, getOrderStatus, delayOrder } from "@/lib/appsScript";
import { answerCallbackQuery, editMessageText, editMessageReplyMarkup, sendMessage } from "@/lib/telegram";
import { pushReceipt } from "@/lib/loyverse";
import { confirmationEmail, statusEmail, declineEmail, delayEmail, sendEmail } from "@/lib/email";

const SECRET = "hook-secret";

// Unique update_id per call so the in-memory dedupe (added in Task 10) never
// collapses two distinct order-button taps issued within one test.
let __updateSeq = 1000;
function update(data: string) {
  return {
    update_id: __updateSeq++,
    callback_query: { id: "cb1", data, message: { message_id: 55, chat: { id: 999 }, text: "NEW ORDER" } },
  };
}

function req(body: unknown, secret = SECRET): Request {
  return new Request("https://api.test/api/telegram/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": secret },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  deferred.length = 0;
  __resetSeenUpdatesForTest(); // clear the in-memory update_id dedupe between tests
  process.env.TELEGRAM_BOT_TOKEN = "tok";
  process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
  process.env.TELEGRAM_OWNER_CHAT_ID = "999";
  process.env.ADMIN_PASS = "owner-pass";
  process.env.RESEND_API_KEY = "re_test";
  (sendEmail as any).mockResolvedValue({ ok: true });
});

// Safety net: any test that pins the clock with fake timers must not leak it.
afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/telegram/webhook", () => {
  it("rejects a bad secret with 401 and changes nothing", async () => {
    const res = await POST(req(update("approve:tok-1"), "wrong-secret"));
    expect(res.status).toBe(401);
    expect(setOrderStatusByToken).not.toHaveBeenCalled();
  });

  it("maps an Approve tap to setOrderStatusByToken(confirmed) and edits the message with next-status keyboard", async () => {
    const res = await POST(req(update("approve:tok-abc")));
    expect(res.status).toBe(200);
    expect(setOrderStatusByToken).toHaveBeenCalledWith("tok-abc", "confirmed");
    expect(editMessageText).toHaveBeenCalled();
    const keyboard = (editMessageText as any).mock.calls[0][3];
    expect(keyboard).toBeDefined();
    expect(keyboard.inline_keyboard.flat().length).toBeGreaterThan(0);
    expect(answerCallbackQuery).toHaveBeenCalled();
  });

  it("on Approve, pushes the now-confirmed order to Loyverse (fetched by token, deferred)", async () => {
    const res = await POST(req(update("approve:tok-abc")));
    expect(res.status).toBe(200);
    expect(pushReceipt).not.toHaveBeenCalled(); // deferred until after the response
    await flushAfter();
    expect(getOrderStatus).toHaveBeenCalledWith("tok-abc", true);
    expect(pushReceipt).toHaveBeenCalledOnce();
    expect(pushReceipt).toHaveBeenCalledWith(expect.objectContaining({
      items: [{ name: "Grilled Chicken", quantity: 2, price: 200 }],
      paymentMethod: "instapay",
      orderTotal: 400,
      trackingToken: "tok-abc",
    }));
  });

  it("a 'preparing' advance refreshes the 🎯 target line on the ticket", async () => {
    // The tap moves the order to preparing; the edited ticket should carry the
    // new stage's target and drop any prior stage's 🎯 line.
    (setOrderStatusByToken as any).mockResolvedValueOnce({ success: true, status: "preparing", previousStatus: "confirmed" });
    await POST(req(update("preparing:tok-p")));
    const editText = (editMessageText as any).mock.calls[0][2] as string;
    expect(editText).toContain("🎯 Out for delivery by");
    // the old confirmed-stage target line must not linger
    expect(editText).not.toContain("Start preparing by");
  });

  it("a status advance renders a SLOT-ANCHORED 🎯 (not entered-relative) and strips the stale one", async () => {
    // Pin the clock to the afternoon so the slot-anchored target (slot−10 = 19:50)
    // always beats the floor clamp (now + stage limit). Without this the test is
    // flaky in the evening (Cairo): after ~19:35 local, now+15 > 19:50 and the
    // floor clamp wins, so the rendered time stops being 7:50 PM.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-14T14:00:00+03:00"));
    // Advancing to 'preparing' for an order whose slot is hours away must anchor
    // the refreshed 🎯 to the slot (slot − DRIVE_MIN), not to now + stage limit.
    // Slot 20:00 Cairo (summer EEST) → preparing target = 19:50 Cairo = 7:50 PM.
    (setOrderStatusByToken as any).mockResolvedValueOnce({ success: true, status: "preparing", previousStatus: "confirmed" });
    // mockResolvedValueOnce so ONLY the synchronous status-advance slot fetch
    // consumes it (we don't flushAfter, so the deferred preparing email's fetch
    // is never reached).
    (getOrderStatus as any).mockResolvedValueOnce({
      success: true,
      order: { name: "Sara Ali", status: "preparing", deliveryDate: "2026-06-14", deliverySlot: "20:00" },
    });
    const withStaleTarget = {
      update_id: 1,
      callback_query: {
        id: "cb1",
        data: "preparing:tok-adv",
        message: { message_id: 55, chat: { id: 999 }, text: "NEW ORDER\n\n🎯 Start preparing by 1:00 PM" },
      },
    };
    const res = await POST(req(withStaleTarget));
    expect(res.status).toBe(200);
    const text = (editMessageText as any).mock.calls[0][2] as string;
    expect(text).toContain("🎯 Out for delivery by 7:50 PM"); // slot-anchored target
    expect(text).not.toContain("Start preparing by 1:00 PM");  // stale target stripped
    expect((text.match(/🎯/g) || []).length).toBe(1);          // exactly one target line
  });

  it("does NOT push to Loyverse for non-approve transitions (e.g. preparing)", async () => {
    await POST(req(update("preparing:t")));
    expect(pushReceipt).not.toHaveBeenCalled();
  });

  it("does NOT push again when the order was already confirmed (re-tap / redelivery)", async () => {
    (setOrderStatusByToken as any).mockResolvedValueOnce({ success: true, status: "confirmed", previousStatus: "confirmed" });
    const res = await POST(req(update("approve:tok-dup")));
    expect(res.status).toBe(200);
    expect(pushReceipt).not.toHaveBeenCalled();
  });

  it("a deferred Loyverse push failure on Approve warns the owner but still answers 200", async () => {
    (pushReceipt as any).mockResolvedValueOnce({ ok: false, error: "Loyverse HTTP 500" });
    const res = await POST(req(update("approve:tok-x")));
    expect(res.status).toBe(200);
    await flushAfter();
    expect(sendMessage).toHaveBeenCalledOnce();
    expect((sendMessage as any).mock.calls[0][1]).toContain("didn't sync to Loyverse");
  });

  it("a thrown getOrderStatus during the deferred push never breaks the 200", async () => {
    // Three getOrderStatus calls happen on an approve: (1) the synchronous
    // slot fetch that refreshes the 🎯 target, (2) the deferred confirmation
    // email, (3) the deferred Loyverse push. Let the first two resolve so the
    // throw lands specifically on the DEFERRED PUSH this test is about.
    const okOrder = {
      success: true,
      order: {
        name: "Sara Ali", status: "confirmed", deliveryDate: "2026-06-13", deliverySlot: "14:30",
        orderSummary: "2x Grilled Chicken (400 EGP)", orderTotal: 400,
        email: "sara@example.com", paymentMethod: "instapay",
      },
    };
    (getOrderStatus as any)
      .mockResolvedValueOnce(okOrder) // synchronous slot fetch
      .mockResolvedValueOnce(okOrder) // deferred confirmation email
      .mockRejectedValueOnce(new Error("apps script down")); // deferred Loyverse push
    const res = await POST(req(update("approve:tok-y")));
    expect(res.status).toBe(200);
    expect(setOrderStatusByToken).toHaveBeenCalled();
    // The deferred push swallows the error without throwing.
    await expect(flushAfter()).resolves.toBeUndefined();
  });

  it("passes terminal (no-button) keyboard when delivered", async () => {
    await POST(req(update("delivered:t")));
    expect(editMessageText).toHaveBeenCalled();
    const keyboard = (editMessageText as any).mock.calls[0][3];
    expect(keyboard).toEqual({ inline_keyboard: [] });
  });

  it("maps cancel and delivered actions", async () => {
    await POST(req(update("cancel:t1")));
    expect(setOrderStatusByToken).toHaveBeenCalledWith("t1", "cancelled");
    await POST(req(update("delivered:t2")));
    expect(setOrderStatusByToken).toHaveBeenCalledWith("t2", "delivered");
  });

  it("ignores an unknown action but still answers 200 (no redelivery)", async () => {
    const res = await POST(req(update("bogus:t1")));
    expect(res.status).toBe(200);
    expect(setOrderStatusByToken).not.toHaveBeenCalled();
  });

  it("answers 200 for a non-callback update (e.g. a plain message)", async () => {
    const res = await POST(req({ update_id: 2, message: { message_id: 1, chat: { id: 1 }, text: "hi" } }));
    expect(res.status).toBe(200);
    expect(setOrderStatusByToken).not.toHaveBeenCalled();
  });

  it("ignores callbacks not from the owner chat (owner-id check)", async () => {
    const foreignUpdate = {
      update_id: 1,
      callback_query: { id: "cb1", data: "approve:tok-1", message: { message_id: 55, chat: { id: 12345 }, text: "NEW ORDER" } },
    };
    const res = await POST(req(foreignUpdate));
    expect(res.status).toBe(200);
    expect(setOrderStatusByToken).not.toHaveBeenCalled();
  });

  // ── "Running late" / delay flow ──

  it("a 'delay' tap shows the +15/+30/+60 sub-keyboard without changing state", async () => {
    const res = await POST(req(update("delay:tok-d")));
    expect(res.status).toBe(200);
    expect(editMessageReplyMarkup).toHaveBeenCalledOnce();
    const kb = (editMessageReplyMarkup as any).mock.calls[0][2];
    const flat = kb.inline_keyboard.flat();
    expect(flat.some((b: any) => b.callback_data === "delay15:tok-d")).toBe(true);
    expect(flat.some((b: any) => b.callback_data === "delay30:tok-d")).toBe(true);
    expect(flat.some((b: any) => b.callback_data === "delay60:tok-d")).toBe(true);
    expect(flat.some((b: any) => b.callback_data === "delayback:tok-d")).toBe(true);
    // No state change and no slot move.
    expect(setOrderStatusByToken).not.toHaveBeenCalled();
    expect(delayOrder).not.toHaveBeenCalled();
    expect(answerCallbackQuery).toHaveBeenCalled();
  });

  it("a 'delay30' tap calls delayOrder(token, 30), appends the new ETA, and restores the status keyboard", async () => {
    const res = await POST(req(update("delay30:tok-d")));
    expect(res.status).toBe(200);
    expect(delayOrder).toHaveBeenCalledWith("tok-d", 30);
    expect(setOrderStatusByToken).not.toHaveBeenCalled();
    // Message text edited with the new-ETA line.
    expect(editMessageText).toHaveBeenCalledOnce();
    const text = (editMessageText as any).mock.calls[0][2];
    expect(text).toContain("new ETA 3:00 PM");
    // Restored to the order's current-status keyboard (confirmed → has delay button).
    const kb = (editMessageText as any).mock.calls[0][3];
    expect(kb.inline_keyboard.flat().some((b: any) => b.callback_data === "preparing:tok-d")).toBe(true);
    expect(answerCallbackQuery).toHaveBeenCalledWith("cb1", "ETA +30 min");
  });

  it("H2: a delay strips any stale 🎯 line and re-appends a fresh one (slot-anchored target moves)", async () => {
    // The fetched order is 'confirmed' → its fresh target is "Start preparing by".
    // A stale 'Deliver by' line (from a different stage) must be dropped, leaving
    // exactly one 🎯 line.
    const withStaleTarget = {
      update_id: 1,
      callback_query: {
        id: "cb1",
        data: "delay30:tok-d",
        message: { message_id: 55, chat: { id: 999 }, text: "NEW ORDER\n\n🎯 Deliver by 1:00 PM" },
      },
    };
    const res = await POST(req(withStaleTarget));
    expect(res.status).toBe(200);
    const text = (editMessageText as any).mock.calls[0][2] as string;
    expect(text).not.toContain("Deliver by 1:00 PM"); // stale target stripped
    expect(text).toContain("🎯 Start preparing by");    // fresh target re-appended
    expect((text.match(/🎯/g) || []).length).toBe(1);   // exactly one target line
    expect(text).toContain("new ETA 3:00 PM");
  });

  it("a second delay replaces the prior ETA line instead of stacking duplicates", async () => {
    const already = {
      update_id: 1,
      callback_query: {
        id: "cb1",
        data: "delay30:tok-d",
        message: { message_id: 55, chat: { id: 999 }, text: "NEW ORDER\n\n⏰ Delayed → new ETA 2:45 PM" },
      },
    };
    const res = await POST(req(already));
    expect(res.status).toBe(200);
    const text = (editMessageText as any).mock.calls[0][2] as string;
    // Exactly one "⏰ Delayed" line, carrying the latest ETA.
    expect(text.match(/⏰ Delayed/g)).toHaveLength(1);
    expect(text).toContain("new ETA 3:00 PM");
    expect(text).not.toContain("2:45 PM");
  });

  it("a delayOrder failure still answers 200 and does not throw or edit the message", async () => {
    (delayOrder as any).mockResolvedValueOnce({ success: false, error: "Order not found" });
    const res = await POST(req(update("delay60:tok-x")));
    expect(res.status).toBe(200);
    expect(delayOrder).toHaveBeenCalledWith("tok-x", 60);
    expect(editMessageText).not.toHaveBeenCalled();
    expect(answerCallbackQuery).toHaveBeenCalledWith("cb1", "Couldn't update");
  });

  it("a thrown delayOrder never breaks the 200", async () => {
    (delayOrder as any).mockRejectedValueOnce(new Error("apps script down"));
    const res = await POST(req(update("delay15:tok-y")));
    expect(res.status).toBe(200);
    expect(answerCallbackQuery).toHaveBeenCalledWith("cb1", "Couldn't update");
  });

  it("a 'delayback' tap restores the status keyboard without changing state", async () => {
    const res = await POST(req(update("delayback:tok-d")));
    expect(res.status).toBe(200);
    expect(getOrderStatus).toHaveBeenCalledWith("tok-d");
    expect(editMessageReplyMarkup).toHaveBeenCalledOnce();
    const kb = (editMessageReplyMarkup as any).mock.calls[0][2];
    expect(kb.inline_keyboard.flat().some((b: any) => b.callback_data === "preparing:tok-d")).toBe(true);
    expect(delayOrder).not.toHaveBeenCalled();
    expect(setOrderStatusByToken).not.toHaveBeenCalled();
    expect(answerCallbackQuery).toHaveBeenCalled();
  });
});

// ── Customer emails via Vercel/Resend (deferred, non-fatal) ──
describe("POST /api/telegram/webhook — customer emails", () => {
  it("a 'preparing' advance sends a preparing status email (deferred)", async () => {
    const res = await POST(req(update("preparing:tok-p")));
    expect(res.status).toBe(200);
    expect(sendEmail).not.toHaveBeenCalled(); // deferred until after the response
    await flushAfter();
    expect(getOrderStatus).toHaveBeenCalledWith("tok-p", true);
    expect(statusEmail).toHaveBeenCalledWith(
      "preparing",
      expect.objectContaining({ name: "Sara Ali", deliverySlot: "14:30", trackingToken: "tok-p" }),
    );
    expect(sendEmail).toHaveBeenCalledWith("sara@example.com", "status-subject", "<p>status</p>");
  });

  it("an 'otd' advance sends an out_for_delivery status email", async () => {
    await POST(req(update("otd:tok-o")));
    await flushAfter();
    expect(statusEmail).toHaveBeenCalledWith(
      "out_for_delivery",
      expect.objectContaining({ trackingToken: "tok-o" }),
    );
    expect(sendEmail).toHaveBeenCalledOnce();
  });

  it("a 'delivered' advance sends a delivered status email", async () => {
    await POST(req(update("delivered:tok-dv")));
    await flushAfter();
    expect(statusEmail).toHaveBeenCalledWith("delivered", expect.objectContaining({ trackingToken: "tok-dv" }));
    expect(sendEmail).toHaveBeenCalledOnce();
  });

  it("an 'approve' (confirmed) advance sends NO status/decline email", async () => {
    await POST(req(update("approve:tok-a")));
    await flushAfter(); // runs only the Loyverse push
    expect(statusEmail).not.toHaveBeenCalled();
    expect(declineEmail).not.toHaveBeenCalled();
  });

  it("a 'decline' sends a decline email (deferred)", async () => {
    await POST(req(update("decline:tok-x")));
    await flushAfter();
    expect(declineEmail).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Sara Ali", deliverySlot: "14:30" }),
    );
    expect(sendEmail).toHaveBeenCalledWith("sara@example.com", "decline-subject", "<p>decline</p>");
  });

  it("a 'delay30' sends a delay email with old/new labels (deferred)", async () => {
    await POST(req(update("delay30:tok-d")));
    expect(sendEmail).not.toHaveBeenCalled(); // deferred
    await flushAfter();
    expect(delayEmail).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Sara Ali", oldLabel: "2:30 PM", newLabel: "3:00 PM", trackingToken: "tok-d" }),
    );
    expect(sendEmail).toHaveBeenCalledWith("sara@example.com", "delay-subject", "<p>delay</p>");
  });

  it("a failed delayOrder sends NO delay email", async () => {
    (delayOrder as any).mockResolvedValueOnce({ success: false, error: "Order not found" });
    await POST(req(update("delay30:tok-nf")));
    await flushAfter();
    expect(delayEmail).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("email failures are non-fatal — a thrown sendEmail never breaks the flush or the 200", async () => {
    (sendEmail as any).mockRejectedValue(new Error("resend down"));
    const res = await POST(req(update("preparing:tok-f")));
    expect(res.status).toBe(200);
    await expect(flushAfter()).resolves.toBeUndefined();
  });

  it("does not send any email when the order has no email on file", async () => {
    // The order is now fetched twice (synchronous status-advance slot fetch +
    // deferred email fetch), so queue the no-email order for BOTH fetches. Two
    // `Once` mocks (not a persistent one) so the override can't leak into the
    // next test — vi.clearAllMocks() clears call history but not implementations.
    const noEmailOrder = {
      success: true,
      order: { name: "X", status: "preparing", deliveryDate: "", deliverySlot: "14:30", orderSummary: "", orderTotal: 0 },
    };
    (getOrderStatus as any).mockResolvedValueOnce(noEmailOrder).mockResolvedValueOnce(noEmailOrder);
    await POST(req(update("preparing:tok-noemail")));
    await flushAfter();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  // ── Confirmation email on pending_approval → confirmed ──

  it("an Approve (pending_approval → confirmed) sends a confirmation email (deferred)", async () => {
    const res = await POST(req(update("approve:tok-conf")));
    expect(res.status).toBe(200);
    expect(sendEmail).not.toHaveBeenCalled(); // deferred until after the response
    await flushAfter();
    expect(getOrderStatus).toHaveBeenCalledWith("tok-conf", true);
    expect(confirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Sara Ali",
        orderSummary: "2x Grilled Chicken (400 EGP)",
        orderTotal: 400,
        deliverySlot: "14:30",
        paymentMethod: "instapay",
        trackingToken: "tok-conf",
      }),
    );
    expect(sendEmail).toHaveBeenCalledWith("sara@example.com", "confirm-subject", "<p>confirm</p>");
  });

  it("a re-tap (previousStatus already 'confirmed') does NOT resend the confirmation email", async () => {
    (setOrderStatusByToken as any).mockResolvedValueOnce({
      success: true,
      status: "confirmed",
      previousStatus: "confirmed",
    });
    await POST(req(update("approve:tok-retap")));
    await flushAfter();
    expect(confirmationEmail).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

// ── Owner-DM agent routing (Task 10) ──
const PENDING_ID = "11111111-1111-1111-1111-111111111111";

function ownerDm(text: string) {
  return {
    update_id: __updateSeq++,
    message: { message_id: 1, chat: { id: 777, type: "private" }, from: { id: 777 }, text },
  };
}
function strangerDm(text: string) {
  return {
    update_id: __updateSeq++,
    message: { message_id: 1, chat: { id: 999, type: "private" }, from: { id: 999 }, text },
  };
}
function groupMsg(text: string) {
  return {
    update_id: __updateSeq++,
    message: { message_id: 1, chat: { id: -100, type: "group" }, from: { id: 5 }, text },
  };
}

describe("owner-DM agent routing", () => {
  it("runs the agent for the bound owner's text and replies", async () => {
    const res = await POST(req(ownerDm("any active orders?")));
    expect(res.status).toBe(200);
    await flushAfter();
    const { runAgent } = await import("@/lib/assistant/agent");
    expect(runAgent).toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalled();
  });

  it("ignores group messages (never runs the agent)", async () => {
    const { runAgent } = await import("@/lib/assistant/agent");
    (runAgent as any).mockClear();
    const res = await POST(req(groupMsg("delete everything")));
    expect(res.status).toBe(200);
    await flushAfter();
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("refuses a non-owner DM without running the agent", async () => {
    const { runAgent } = await import("@/lib/assistant/agent");
    (runAgent as any).mockClear();
    const res = await POST(req(strangerDm("hi")));
    expect(res.status).toBe(200);
    await flushAfter();
    expect(runAgent).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalled(); // generic refusal
  });

  it("a thrown getOwnerChatId (corrupt owner record) degrades to a graceful 200, not a 500 that drops the message", async () => {
    // The update_id is already marked seen by the time the owner gate runs, so an
    // unguarded throw would 500 → Telegram redelivers → dedupe no-ops → the
    // message is lost. The gate must catch the throw, reply gracefully, and 200.
    const { getOwnerChatId } = await import("@/lib/assistant/state");
    const { runAgent } = await import("@/lib/assistant/agent");
    (runAgent as any).mockClear();
    (getOwnerChatId as any).mockRejectedValueOnce(new Error("Owner record is corrupt (ill-shaped chatId)"));
    const res = await POST(req(ownerDm("any active orders?")));
    expect(res.status).toBe(200);
    await flushAfter();
    expect(runAgent).not.toHaveBeenCalled();   // never reaches the agent
    expect(sendMessage).toHaveBeenCalled();     // owner gets a graceful error, not silence
    const text = (sendMessage as any).mock.calls.at(-1)?.[1] as string;
    expect(text).not.toMatch(/private assistant/i); // not the non-owner refusal
    expect(text).toMatch(/went wrong/i);
  });

  it("a confirm tap executes the pending action exactly once", async () => {
    const data = `confirm:${PENDING_ID}`;
    const res = await POST(
      req({ update_id: __updateSeq++, callback_query: { id: "c", data, message: { message_id: 9, chat: { id: 777 } } } }),
    );
    expect(res.status).toBe(200);
    await flushAfter();
    const { executeTool } = await import("@/lib/assistant/tools");
    expect(executeTool).toHaveBeenCalledWith(
      "order_delay",
      { token: "t", minutes: 15 },
      expect.objectContaining({ chatId: 777 }),
    );
    expect(executeTool).toHaveBeenCalledTimes(1);
  });

  it("a cancel tap retires the pending action and does not execute", async () => {
    const { executeTool } = await import("@/lib/assistant/tools");
    const { retirePendingAction } = await import("@/lib/assistant/state");
    (executeTool as any).mockClear();
    const data = `cancel:${PENDING_ID}`;
    const res = await POST(
      req({ update_id: __updateSeq++, callback_query: { id: "c", data, message: { message_id: 9, chat: { id: 777 } } } }),
    );
    expect(res.status).toBe(200);
    await flushAfter();
    expect(retirePendingAction).toHaveBeenCalledWith(PENDING_ID);
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("a confirm tap from a NON-owner chat is dropped (never executes)", async () => {
    const { executeTool } = await import("@/lib/assistant/tools");
    const { takePendingAction } = await import("@/lib/assistant/state");
    (executeTool as any).mockClear();
    (takePendingAction as any).mockClear();
    const data = `confirm:${PENDING_ID}`;
    // owner is 777 (state mock); this tap comes from chat 999.
    const res = await POST(
      req({ update_id: __updateSeq++, callback_query: { id: "c", data, message: { message_id: 9, chat: { id: 999 } } } }),
    );
    expect(res.status).toBe(200);
    await flushAfter();
    expect(takePendingAction).not.toHaveBeenCalled();
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("a confirm reply that the agent gates shows the Confirm/Cancel keyboard", async () => {
    const { runAgent } = await import("@/lib/assistant/agent");
    (runAgent as any).mockResolvedValueOnce({ kind: "confirm", text: "Delay order t by 15 min — confirm?", pendingId: PENDING_ID });
    await POST(req(ownerDm("delay order t by 15")));
    await flushAfter();
    const lastCall = (sendMessage as any).mock.calls.at(-1);
    expect(lastCall[2]).toBeDefined(); // keyboard arg
    expect(lastCall[2].inline_keyboard.flat().some((b: any) => b.callback_data === `confirm:${PENDING_ID}`)).toBe(true);
  });
});

// ── Intrusion alert on non-owner contact (Task 3) ──
describe("intrusion alert on non-owner contact", () => {
  it("alerts the bound owner when a stranger DMs, but still refuses the stranger", async () => {
    const { shouldAlertOwner } = await import("@/lib/assistant/state");
    const { runAgent } = await import("@/lib/assistant/agent");
    (shouldAlertOwner as any).mockResolvedValueOnce(true);
    (runAgent as any).mockClear();
    const res = await POST(req(strangerDm("hello bot please help")));
    expect(res.status).toBe(200);
    await flushAfter();
    // The agent never runs for a stranger.
    expect(runAgent).not.toHaveBeenCalled();
    // The stranger (999) still gets the generic refusal.
    const refusal = (sendMessage as any).mock.calls.find((c: any[]) => c[0] === 999);
    expect(refusal).toBeDefined();
    expect(refusal[1]).toMatch(/private assistant/i);
    // The bound owner (777) gets a PII-light intrusion alert — never the message text.
    expect(shouldAlertOwner).toHaveBeenCalled();
    const alert = (sendMessage as any).mock.calls.find((c: any[]) => c[0] === 777);
    expect(alert).toBeDefined();
    expect(alert[1]).toMatch(/tried to use the bot/i);
    expect(alert[1]).not.toContain("hello bot please help");
  });

  it("does NOT alert again when shouldAlertOwner says no (rate-limited)", async () => {
    const { shouldAlertOwner } = await import("@/lib/assistant/state");
    (shouldAlertOwner as any).mockResolvedValueOnce(false);
    const res = await POST(req(strangerDm("second time")));
    expect(res.status).toBe(200);
    await flushAfter();
    // No alert reaches the owner.
    const alert = (sendMessage as any).mock.calls.find((c: any[]) => c[0] === 777);
    expect(alert).toBeUndefined();
    // The stranger is still refused.
    const refusal = (sendMessage as any).mock.calls.find((c: any[]) => c[0] === 999);
    expect(refusal).toBeDefined();
  });

  it("never alerts when no owner is bound (unbound = no one to alert)", async () => {
    const { getOwnerChatId, shouldAlertOwner } = await import("@/lib/assistant/state");
    (getOwnerChatId as any).mockResolvedValueOnce(null);
    const res = await POST(req(strangerDm("anyone home?")));
    expect(res.status).toBe(200);
    await flushAfter();
    expect(shouldAlertOwner).not.toHaveBeenCalled();
  });
});

describe("existing order buttons still work (not shadowed by confirm/cancel)", () => {
  it("an approve tap still maps to setOrderStatusByToken(confirmed)", async () => {
    await POST(req(update("approve:tok-xyz")));
    expect(setOrderStatusByToken).toHaveBeenCalledWith("tok-xyz", "confirmed");
  });

  it("an order cancel:<token> tap still maps to setOrderStatusByToken(cancelled) — uuid gate doesn't shadow it", async () => {
    await POST(req(update("cancel:tok-not-a-uuid")));
    expect(setOrderStatusByToken).toHaveBeenCalledWith("tok-not-a-uuid", "cancelled");
  });
});

describe("update_id dedupe", () => {
  it("returns 200 and skips reprocessing a redelivered update_id", async () => {
    const u = update("approve:tok-dedupe");
    await POST(req(u));
    expect(setOrderStatusByToken).toHaveBeenCalledTimes(1);
    (setOrderStatusByToken as any).mockClear();
    // Same update_id redelivered → deduped, no second processing.
    const res = await POST(req(u));
    expect(res.status).toBe(200);
    expect(setOrderStatusByToken).not.toHaveBeenCalled();
  });
});
