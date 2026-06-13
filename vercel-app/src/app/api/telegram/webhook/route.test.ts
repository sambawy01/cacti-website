import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/appsScript", () => ({ setOrderStatusByToken: vi.fn(async () => ({ success: true, status: "confirmed" })) }));
vi.mock("@/lib/telegram", () => ({
  answerCallbackQuery: vi.fn(async () => ({ ok: true, status: 200 })),
  editMessageText: vi.fn(async () => ({ ok: true, status: 200 })),
}));

import { POST } from "./route";
import { setOrderStatusByToken } from "@/lib/appsScript";
import { answerCallbackQuery, editMessageText } from "@/lib/telegram";

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
});

describe("POST /api/telegram/webhook", () => {
  it("rejects a bad secret with 401 and changes nothing", async () => {
    const res = await POST(req(update("approve:tok-1"), "wrong-secret"));
    expect(res.status).toBe(401);
    expect(setOrderStatusByToken).not.toHaveBeenCalled();
  });

  it("maps an Approve tap to setOrderStatusByToken(confirmed) and edits the message", async () => {
    const res = await POST(req(update("approve:tok-abc")));
    expect(res.status).toBe(200);
    expect(setOrderStatusByToken).toHaveBeenCalledWith("tok-abc", "confirmed");
    expect(editMessageText).toHaveBeenCalled();
    expect(answerCallbackQuery).toHaveBeenCalled();
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
});
