import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture every callback registered with after() so tests can run them on demand.
// This lets us assert (a) the 200 response is returned WITHOUT waiting on the
// side-effects, and (b) the deferred work behaves correctly once it does run.
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

vi.mock("@/lib/appsScript", () => ({ placeOrder: vi.fn(), orderFinalize: vi.fn(async () => ({ success: true })) }));
vi.mock("@/lib/telegram", () => ({ telegramConfigured: vi.fn(() => true), sendMessage: vi.fn(async () => ({ ok: true, status: 200 })) }));
vi.mock("@/lib/loyverse", () => ({ loyverseConfigured: vi.fn(() => true), pushReceipt: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/email", () => ({
  confirmationEmail: vi.fn(() => ({ subject: "Bistro Cloud — order confirmed", html: "<p>confirm</p>" })),
  sendEmail: vi.fn(async () => ({ ok: true })),
}));

import { POST, OPTIONS, runOrderSideEffects } from "./route";
import { placeOrder, orderFinalize } from "@/lib/appsScript";
import { sendMessage } from "@/lib/telegram";
import { pushReceipt } from "@/lib/loyverse";
import { confirmationEmail, sendEmail } from "@/lib/email";
import type { ValidatedOrder } from "@/lib/validation";

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
  deferred.length = 0;
  process.env.TELEGRAM_OWNER_CHAT_ID = "999";
  process.env.INSTAPAY_DETAILS = "Bank: CIB, Acct: 100012345678";
  (pushReceipt as any).mockResolvedValue({ ok: true });
  (orderFinalize as any).mockResolvedValue({ success: true });
  process.env.RESEND_API_KEY = "re_test";
  (sendEmail as any).mockResolvedValue({ ok: true });
  (confirmationEmail as any).mockReturnValue({ subject: "Bistro Cloud — order confirmed", html: "<p>confirm</p>" });
});

describe("POST /api/order", () => {
  it("rejects a payload without email (mandatory) and never calls Apps Script", async () => {
    const res = await POST(req({ ...validBody, email: "" }));
    expect(res.status).toBe(400);
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it("places a confirmed order, defers Telegram; instapay not returned to browser; placeOrder called with paymentMethod+instapayDetails", async () => {
    (placeOrder as any).mockResolvedValue({ success: true, status: "confirmed", trackingToken: "tok-9", deliverySlot: "14:30", deliveryDate: "2026-06-13", id: 1 });
    const res = await POST(req(validBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.status).toBe("confirmed");
    expect(json.trackingToken).toBe("tok-9");
    expect(json.instapay).toBeUndefined();
    // Telegram is deferred — not yet fired when the response returns.
    expect(sendMessage).not.toHaveBeenCalled();
    await flushAfter();
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

  it("relays a capacity failure code as 409 and registers no deferred work", async () => {
    (placeOrder as any).mockResolvedValue({ success: false, code: "slot_full" });
    const res = await POST(req(validBody));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe("slot_full");
    expect(deferred.length).toBe(0);
    await flushAfter();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("responds 200 immediately even when the deferred side-effects are slow/reject (does NOT await them)", async () => {
    (placeOrder as any).mockResolvedValue({ success: true, status: "confirmed", trackingToken: "tok-slow", deliverySlot: "14:30", deliveryDate: "2026-06-13" });
    // Side-effects hang / reject — the response must not wait on them.
    (orderFinalize as any).mockImplementation(() => new Promise((_r, rej) => setTimeout(() => rej(new Error("slow finalize")), 10_000)));
    (sendMessage as any).mockRejectedValue(new Error("telegram down"));
    const res = await POST(req(validBody));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    // One deferred callback was registered but not awaited by the route.
    expect(deferred.length).toBe(1);
  });

  it("survives a Telegram failure (order already placed → still 200)", async () => {
    (placeOrder as any).mockResolvedValue({ success: true, status: "confirmed", trackingToken: "t", deliverySlot: "14:30", deliveryDate: "2026-06-13" });
    (sendMessage as any).mockRejectedValue(new Error("telegram down"));
    const res = await POST(req(validBody));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    // The deferred work swallows the Telegram error without throwing.
    await expect(flushAfter()).resolves.toBeUndefined();
  });

  it("returns 502 if Apps Script throws", async () => {
    (placeOrder as any).mockRejectedValue(new Error("network"));
    const res = await POST(req(validBody));
    expect(res.status).toBe(502);
    expect(deferred.length).toBe(0);
  });

  it("forwards note to placeOrder", async () => {
    (placeOrder as any).mockResolvedValue({ success: true, status: "confirmed", trackingToken: "t", deliverySlot: "14:30", deliveryDate: "2026-06-13" });
    const res = await POST(req({ ...validBody, note: "No nuts please" }));
    expect(res.status).toBe(200);
    expect(placeOrder).toHaveBeenCalledWith(expect.objectContaining({ note: "No nuts please" }));
  });

  it("defaults location to '' when the body omits it (placeOrder + deferred pushReceipt)", async () => {
    (placeOrder as any).mockResolvedValue({ success: true, status: "confirmed", trackingToken: "t", deliverySlot: "14:30", deliveryDate: "2026-06-13" });
    await POST(req(validBody));
    expect(placeOrder).toHaveBeenCalledWith(expect.objectContaining({ location: "" }));
    await flushAfter();
    expect(pushReceipt).toHaveBeenCalledWith(expect.objectContaining({ location: "" }));
  });

  it("threads a customer-supplied location to placeOrder and the deferred pushReceipt", async () => {
    (placeOrder as any).mockResolvedValue({ success: true, status: "confirmed", trackingToken: "t", deliverySlot: "14:30", deliveryDate: "2026-06-13" });
    const loc = "https://maps.app.goo.gl/abc";
    await POST(req({ ...validBody, location: loc }));
    expect(placeOrder).toHaveBeenCalledWith(expect.objectContaining({ location: loc }));
    await flushAfter();
    expect(pushReceipt).toHaveBeenCalledWith(expect.objectContaining({ location: loc }));
  });

  it("pushes a confirmed order to Loyverse with the structured cart items (deferred)", async () => {
    (placeOrder as any).mockResolvedValue({ success: true, status: "confirmed", trackingToken: "tok-7", deliverySlot: "14:30", deliveryDate: "2026-06-13" });
    const res = await POST(req(validBody));
    expect(res.status).toBe(200);
    expect(pushReceipt).not.toHaveBeenCalled(); // deferred
    await flushAfter();
    expect(pushReceipt).toHaveBeenCalledOnce();
    expect(pushReceipt).toHaveBeenCalledWith(expect.objectContaining({
      items: [{ name: "Grilled Chicken", quantity: 2, price: 200 }],
      paymentMethod: "instapay",
      orderTotal: 400,
      trackingToken: "tok-7",
    }));
  });

  it("a deferred Loyverse push failure warns the owner but keeps the 200 response", async () => {
    (placeOrder as any).mockResolvedValue({ success: true, status: "confirmed", trackingToken: "t", deliverySlot: "14:30", deliveryDate: "2026-06-13" });
    (pushReceipt as any).mockResolvedValue({ ok: false, error: "Loyverse HTTP 500" });
    const res = await POST(req(validBody));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    await flushAfter();
    // sendMessage fired twice: the order push + the Loyverse warning.
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect((sendMessage as any).mock.calls[1][1]).toContain("didn't sync to Loyverse");
  });

  it("a deferred Loyverse push that throws does not break the 200 response", async () => {
    (placeOrder as any).mockResolvedValue({ success: true, status: "confirmed", trackingToken: "t", deliverySlot: "14:30", deliveryDate: "2026-06-13" });
    (pushReceipt as any).mockRejectedValue(new Error("kaboom"));
    const res = await POST(req(validBody));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    await expect(flushAfter()).resolves.toBeUndefined();
  });

  it("answers OPTIONS preflight with CORS", async () => {
    const res = await OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeTruthy();
  });
});

describe("runOrderSideEffects (deferred work)", () => {
  const order: ValidatedOrder = {
    name: "Sara Ali", phone: "+201001234567", email: "sara@example.com", address: "12 West Golf",
    note: "", deliverySlot: "14:30", expectedStatus: "open", paymentMethod: "instapay",
    itemCount: 2, orderTotal: 400, orderSummary: "2x Grilled Chicken (400 EGP)", location: "",
    items: [{ name: "Grilled Chicken", quantity: 2, price: 200 }],
  };
  const confirmed = { success: true as const, status: "confirmed" as const, trackingToken: "tok-1", deliverySlot: "14:30", deliveryDate: "2026-06-13" };

  it("calls orderFinalize (with instapay details), Telegram, and Loyverse for a confirmed order", async () => {
    await runOrderSideEffects(order, confirmed);
    expect(orderFinalize).toHaveBeenCalledWith("tok-1", "Bank: CIB, Acct: 100012345678");
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(pushReceipt).toHaveBeenCalledOnce();
  });

  it("sends the confirmation email (deferred) for a confirmed order, with instapay details", async () => {
    await runOrderSideEffects(order, confirmed);
    expect(confirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Sara Ali",
        orderTotal: 400,
        deliverySlot: "14:30",
        paymentMethod: "instapay",
        instapayDetails: "Bank: CIB, Acct: 100012345678",
        trackingToken: "tok-1",
      }),
    );
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(sendEmail).toHaveBeenCalledWith("sara@example.com", "Bistro Cloud — order confirmed", "<p>confirm</p>");
  });

  it("does NOT send a confirmation email for a pending_approval order", async () => {
    await runOrderSideEffects(order, { ...confirmed, status: "pending_approval" });
    expect(confirmationEmail).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("confirmation email is non-fatal: a sendEmail {ok:false} doesn't stop Telegram/Loyverse", async () => {
    (sendEmail as any).mockResolvedValue({ ok: false, error: "Resend HTTP 500" });
    await expect(runOrderSideEffects(order, confirmed)).resolves.toBeUndefined();
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(pushReceipt).toHaveBeenCalledOnce();
  });

  it("confirmation email is non-fatal: a thrown sendEmail doesn't break the side-effects", async () => {
    (sendEmail as any).mockRejectedValue(new Error("kaboom"));
    await expect(runOrderSideEffects(order, confirmed)).resolves.toBeUndefined();
    expect(pushReceipt).toHaveBeenCalledOnce();
  });

  it("passes undefined instapay details for a non-instapay order", async () => {
    await runOrderSideEffects({ ...order, paymentMethod: "cod" }, confirmed);
    expect(orderFinalize).toHaveBeenCalledWith("tok-1", undefined);
  });

  it("skips Loyverse for a pending_approval order but still finalizes + pushes Telegram", async () => {
    await runOrderSideEffects(order, { ...confirmed, status: "pending_approval" });
    expect(orderFinalize).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(pushReceipt).not.toHaveBeenCalled();
  });

  it("does not throw when orderFinalize fails — Telegram + Loyverse still run", async () => {
    (orderFinalize as any).mockRejectedValue(new Error("finalize down"));
    await expect(runOrderSideEffects(order, confirmed)).resolves.toBeUndefined();
    expect(pushReceipt).toHaveBeenCalledOnce();
    // One finalize-failure owner warning + one order push.
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it("does not throw when Telegram fails — orderFinalize + Loyverse still run", async () => {
    (sendMessage as any).mockRejectedValue(new Error("telegram down"));
    await expect(runOrderSideEffects(order, confirmed)).resolves.toBeUndefined();
    expect(orderFinalize).toHaveBeenCalledOnce();
    expect(pushReceipt).toHaveBeenCalledOnce();
  });

  it("does not throw when Loyverse throws", async () => {
    (pushReceipt as any).mockRejectedValue(new Error("kaboom"));
    await expect(runOrderSideEffects(order, confirmed)).resolves.toBeUndefined();
    expect(orderFinalize).toHaveBeenCalledOnce();
  });
});
