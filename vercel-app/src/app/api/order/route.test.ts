import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/appsScript", () => ({ placeOrder: vi.fn() }));
vi.mock("@/lib/telegram", () => ({ telegramConfigured: vi.fn(() => true), sendMessage: vi.fn(async () => ({ ok: true, status: 200 })) }));

import { POST, OPTIONS } from "./route";
import { placeOrder } from "@/lib/appsScript";
import { sendMessage } from "@/lib/telegram";

function req(body: unknown): Request {
  return new Request("https://api.test/api/order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  items: [{ name: "Grilled Chicken", quantity: 2, price: 200 }],
  name: "Sara Ali", phone: "+201001234567", email: "sara@example.com",
  address: "12 West Golf, El Gouna", deliverySlot: "14:30", expectedStatus: "open", paymentMethod: "instapay",
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TELEGRAM_OWNER_CHAT_ID = "999";
  process.env.INSTAPAY_DETAILS = "Bank: CIB, Acct: 100012345678";
});

describe("POST /api/order", () => {
  it("rejects a payload without email (mandatory) and never calls Apps Script", async () => {
    const res = await POST(req({ ...validBody, email: "" }));
    expect(res.status).toBe(400);
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it("places a confirmed order, fires Telegram; instapay not returned to browser; placeOrder called with paymentMethod+instapayDetails", async () => {
    (placeOrder as any).mockResolvedValue({ success: true, status: "confirmed", trackingToken: "tok-9", deliverySlot: "14:30", deliveryDate: "2026-06-13", id: 1 });
    const res = await POST(req(validBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.status).toBe("confirmed");
    expect(json.trackingToken).toBe("tok-9");
    expect(json.instapay).toBeUndefined();
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(placeOrder).toHaveBeenCalledWith(expect.objectContaining({ paymentMethod: "instapay", instapayDetails: "Bank: CIB, Acct: 100012345678" }));
  });

  it("cod order: instapay never in response; placeOrder called with paymentMethod cod", async () => {
    (placeOrder as any).mockResolvedValue({ success: true, status: "confirmed", trackingToken: "t", deliverySlot: "14:30", deliveryDate: "2026-06-13" });
    const res = await POST(req({ ...validBody, paymentMethod: "cod" }));
    const json = await res.json();
    expect(json.instapay).toBeUndefined();
    expect(placeOrder).toHaveBeenCalledWith(expect.objectContaining({ paymentMethod: "cod", instapayDetails: undefined }));
  });

  it("relays a capacity failure code as 409 and does not fire Telegram", async () => {
    (placeOrder as any).mockResolvedValue({ success: false, code: "slot_full" });
    const res = await POST(req(validBody));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe("slot_full");
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("survives a Telegram failure (order already placed → still 200)", async () => {
    (placeOrder as any).mockResolvedValue({ success: true, status: "confirmed", trackingToken: "t", deliverySlot: "14:30", deliveryDate: "2026-06-13" });
    (sendMessage as any).mockRejectedValue(new Error("telegram down"));
    const res = await POST(req(validBody));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("returns 502 if Apps Script throws", async () => {
    (placeOrder as any).mockRejectedValue(new Error("network"));
    const res = await POST(req(validBody));
    expect(res.status).toBe(502);
  });

  it("forwards note to placeOrder", async () => {
    (placeOrder as any).mockResolvedValue({ success: true, status: "confirmed", trackingToken: "t", deliverySlot: "14:30", deliveryDate: "2026-06-13" });
    const res = await POST(req({ ...validBody, note: "No nuts please" }));
    expect(res.status).toBe(200);
    expect(placeOrder).toHaveBeenCalledWith(expect.objectContaining({ note: "No nuts please" }));
  });

  it("answers OPTIONS preflight with CORS", async () => {
    const res = await OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeTruthy();
  });
});
