import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/appsScript", () => ({
  setOrderStatusByToken: vi.fn(async () => ({ success: true, status: "confirmed", previousStatus: "pending_approval" })),
  getOrderStatus: vi.fn(async () => ({
    success: true,
    order: {
      name: "Sara Ali", status: "confirmed", deliveryDate: "2026-06-13", deliverySlot: "14:30",
      orderSummary: "2x Grilled Chicken (400 EGP)", orderTotal: 400,
      phone: "+201001234567", address: "12 West Golf", note: "Instapay (bank transfer)", paymentMethod: "instapay",
    },
  })),
  delayOrder: vi.fn(async () => ({ success: true, oldLabel: "2:30 PM", newLabel: "3:00 PM" })),
}));
vi.mock("@/lib/telegram", () => ({
  answerCallbackQuery: vi.fn(async () => ({ ok: true, status: 200 })),
  editMessageText: vi.fn(async () => ({ ok: true, status: 200 })),
  editMessageReplyMarkup: vi.fn(async () => ({ ok: true, status: 200 })),
  sendMessage: vi.fn(async () => ({ ok: true, status: 200 })),
}));
vi.mock("@/lib/loyverse", () => ({
  loyverseConfigured: vi.fn(() => true),
  pushReceipt: vi.fn(async () => ({ ok: true, receiptNumber: "1-1001" })),
  parseOrderSummary: vi.fn((s: string) =>
    s === "2x Grilled Chicken (400 EGP)" ? [{ name: "Grilled Chicken", quantity: 2, price: 200 }] : []),
}));

import { POST } from "./route";
import { setOrderStatusByToken, getOrderStatus, delayOrder } from "@/lib/appsScript";
import { answerCallbackQuery, editMessageText, editMessageReplyMarkup, sendMessage } from "@/lib/telegram";
import { pushReceipt } from "@/lib/loyverse";

const SECRET = "hook-secret";

function update(data: string) {
  return {
    update_id: 1,
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
  process.env.TELEGRAM_BOT_TOKEN = "tok";
  process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
  process.env.TELEGRAM_OWNER_CHAT_ID = "999";
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

  it("on Approve, pushes the now-confirmed order to Loyverse (fetched by token)", async () => {
    const res = await POST(req(update("approve:tok-abc")));
    expect(res.status).toBe(200);
    expect(getOrderStatus).toHaveBeenCalledWith("tok-abc", true);
    expect(pushReceipt).toHaveBeenCalledOnce();
    expect(pushReceipt).toHaveBeenCalledWith(expect.objectContaining({
      items: [{ name: "Grilled Chicken", quantity: 2, price: 200 }],
      paymentMethod: "instapay",
      orderTotal: 400,
      trackingToken: "tok-abc",
    }));
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

  it("a Loyverse push failure on Approve warns the owner but still answers 200", async () => {
    (pushReceipt as any).mockResolvedValueOnce({ ok: false, error: "Loyverse HTTP 500" });
    const res = await POST(req(update("approve:tok-x")));
    expect(res.status).toBe(200);
    expect(sendMessage).toHaveBeenCalledOnce();
    expect((sendMessage as any).mock.calls[0][1]).toContain("didn't sync to Loyverse");
  });

  it("a thrown getOrderStatus during the push never breaks the 200", async () => {
    (getOrderStatus as any).mockRejectedValueOnce(new Error("apps script down"));
    const res = await POST(req(update("approve:tok-y")));
    expect(res.status).toBe(200);
    expect(setOrderStatusByToken).toHaveBeenCalled();
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
