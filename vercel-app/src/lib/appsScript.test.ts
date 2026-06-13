import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { placeOrder, setOrderStatusByToken } from "./appsScript";

const ORIG = { ...process.env };

beforeEach(() => {
  process.env.APPS_SCRIPT_URL = "https://script.example/exec";
  process.env.APPS_SCRIPT_ADMIN_PASSWORD = "secret";
});
afterEach(() => {
  process.env = { ...ORIG };
  vi.restoreAllMocks();
});

function mockFetchOnce(json: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(json), { status: 200, headers: { "content-type": "application/json" } }),
  );
}

describe("placeOrder", () => {
  it("calls Apps Script with channel=web and returns the parsed result", async () => {
    const spy = mockFetchOnce({ success: true, status: "confirmed", trackingToken: "tok-1", deliverySlot: "14:30", deliveryDate: "2026-06-13", id: 123 });
    const res = await placeOrder({
      name: "Sara", phone: "+201001234567", email: "s@e.com", address: "12 West Golf",
      orderTotal: 400, orderSummary: "2x X", itemCount: 2, deliverySlot: "14:30", expectedStatus: "open", note: "", paymentMethod: "cod",
    });
    expect(res.success).toBe(true);
    const calledUrl = (spy.mock.calls[0][0] as string);
    expect(calledUrl).toContain("action=placeOrder");
    expect(calledUrl).toContain("channel=web");
    expect(calledUrl).toContain("deliverySlot=14%3A30");
    expect(calledUrl).toContain("paymentMethod=cod");
  });

  it("passes through a failure code", async () => {
    mockFetchOnce({ success: false, code: "slot_full" });
    const res = await placeOrder({
      name: "S", phone: "+201001234567", email: "s@e.com", address: "addr addr",
      orderTotal: 1, orderSummary: "x", itemCount: 1, deliverySlot: "14:30", expectedStatus: "open", note: "", paymentMethod: "cod",
    });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.code).toBe("slot_full");
  });

  it("includes paymentMethod=instapay and instapayDetails in the URL", async () => {
    const spy = mockFetchOnce({ success: true, status: "confirmed", trackingToken: "t", deliverySlot: "14:30", deliveryDate: "2026-06-13", id: 1 });
    await placeOrder({
      name: "Sara", phone: "+201001234567", email: "s@e.com", address: "12 West Golf",
      orderTotal: 400, orderSummary: "2x X", itemCount: 2, deliverySlot: "14:30",
      expectedStatus: "open", note: "", paymentMethod: "instapay",
      instapayDetails: "Bank: CIB, Acct: 100012345678",
    });
    const calledUrl = (spy.mock.calls[0][0] as string);
    expect(calledUrl).toContain("paymentMethod=instapay");
    expect(calledUrl).toContain("instapayDetails=Bank");
  });
});

describe("setOrderStatusByToken", () => {
  it("calls the gated action with password, token and status", async () => {
    const spy = mockFetchOnce({ success: true, status: "confirmed" });
    const res = await setOrderStatusByToken("tok-1", "confirmed");
    expect(res.success).toBe(true);
    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain("action=setOrderStatusByToken");
    expect(url).toContain("token=tok-1");
    expect(url).toContain("status=confirmed");
    expect(url).toContain("password=secret");
  });
});
