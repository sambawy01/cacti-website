import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { placeOrder, setOrderStatusByToken, slaListActiveOrders, markSlaAlerted } from "./appsScript";
import {
  getAvailabilitySummary, getOrdersList, getMenuList, getPantryList, getStockList,
  getCrmOrdersList, getContactsList, toggleMenuVisibility, togglePantryVisibility,
  decideRequisition, logExpense,
} from "./appsScript";

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
      orderTotal: 400, orderSummary: "2x X", itemCount: 2, deliverySlot: "14:30", expectedStatus: "open", note: "", location: "", paymentMethod: "cod",
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
      orderTotal: 1, orderSummary: "x", itemCount: 1, deliverySlot: "14:30", expectedStatus: "open", note: "", location: "", paymentMethod: "cod",
    });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.code).toBe("slot_full");
  });

  it("includes paymentMethod=instapay and instapayDetails in the URL", async () => {
    const spy = mockFetchOnce({ success: true, status: "confirmed", trackingToken: "t", deliverySlot: "14:30", deliveryDate: "2026-06-13", id: 1 });
    await placeOrder({
      name: "Sara", phone: "+201001234567", email: "s@e.com", address: "12 West Golf",
      orderTotal: 400, orderSummary: "2x X", itemCount: 2, deliverySlot: "14:30",
      expectedStatus: "open", note: "", location: "", paymentMethod: "instapay",
      instapayDetails: "Bank: CIB, Acct: 100012345678",
    });
    const calledUrl = (spy.mock.calls[0][0] as string);
    expect(calledUrl).toContain("paymentMethod=instapay");
    expect(calledUrl).toContain("instapayDetails=Bank");
  });

  it("sends the location param when provided", async () => {
    const spy = mockFetchOnce({ success: true, status: "confirmed", trackingToken: "t", deliverySlot: "14:30", deliveryDate: "2026-06-13", id: 1 });
    await placeOrder({
      name: "Sara", phone: "+201001234567", email: "s@e.com", address: "12 West Golf",
      orderTotal: 400, orderSummary: "2x X", itemCount: 2, deliverySlot: "14:30",
      expectedStatus: "open", note: "", location: "https://maps.app.goo.gl/abc", paymentMethod: "cod",
    });
    const calledUrl = (spy.mock.calls[0][0] as string);
    expect(calledUrl).toContain("location=https");
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

describe("slaListActiveOrders", () => {
  it("GETs the admin-gated action and returns the orders array", async () => {
    const spy = mockFetchOnce({ success: true, orders: [{ tracking_token: "t1" }] });
    const r = await slaListActiveOrders();
    expect(r.success).toBe(true);
    expect(r.orders?.[0].tracking_token).toBe("t1");
    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain("action=slaListActiveOrders");
    expect(url).toContain("password=secret");
  });
});

describe("markSlaAlerted", () => {
  it("GETs the admin-gated action with the token", async () => {
    const spy = mockFetchOnce({ success: true });
    const r = await markSlaAlerted("tok-9");
    expect(r.success).toBe(true);
    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain("action=markSlaAlerted");
    expect(url).toContain("token=tok-9");
  });
});

describe("agent read clients", () => {
  beforeEach(() => {
    process.env.APPS_SCRIPT_URL = "https://script.example/exec";
    process.env.APPS_SCRIPT_ADMIN_PASSWORD = "secret";
  });
  afterEach(() => vi.restoreAllMocks());

  it("getMenuList calls action=getMenu WITH the admin password (getMenu is admin-gated) and returns items", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, items: [{ _rowIndex: 2, id: 1, name: "Bone Broth", status: "available" }] }), { status: 200 }),
    );
    const r = await getMenuList();
    expect(r.success).toBe(true);
    expect(r.items?.[0]._rowIndex).toBe(2);
    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain("action=getMenu");
    expect(url).toContain("password=secret");
  });

  it("getPantryList is admin-gated and returns items", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, items: [{ _rowIndex: 2, id: 1, name: "Granola", status: "hidden" }] }), { status: 200 }),
    );
    const r = await getPantryList();
    expect(r.items?.[0].status).toBe("hidden");
    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain("action=getPantry");
    expect(url).toContain("password=secret");
  });

  it("getStockList reads qty_on_hand/unit under items (action=getStock, admin-gated)", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, items: [{ _rowIndex: 2, id: 1, name: "Chicken", qty_on_hand: 12, unit: "kg" }] }), { status: 200 }),
    );
    const r = await getStockList();
    expect(r.items?.[0].qty_on_hand).toBe(12);
    expect(r.items?.[0].unit).toBe("kg");
    expect(spy.mock.calls[0][0] as string).toContain("action=getStock");
  });

  it("getOrdersList (LEGACY People sheet) sends password and does NOT send a range param (server ignores it), returns `orders`", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, orders: [{ _rowIndex: 2, Name: "Old" }] }), { status: 200 }),
    );
    const r = await getOrdersList();
    expect(r.success).toBe(true);
    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain("action=getOrders");
    expect(url).toContain("password=secret");
    expect(url).not.toContain("range="); // server ignores range — don't pretend to filter
  });

  it("getCrmOrdersList reads rows under `items` (NOT `orders`) and sends no range", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, items: [{ _rowIndex: 2, id: 1, order_total: 400, status: "confirmed", delivery_date: "2026-06-14" }] }), { status: 200 }),
    );
    const r = await getCrmOrdersList();
    expect(r.success).toBe(true);
    expect(r.items?.[0].order_total).toBe(400);
    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain("action=getCRMOrders");
    expect(url).toContain("password=secret");
    expect(url).not.toContain("range=");
  });

  it("getContactsList reads rows under `items` (NOT `contacts`) and sends no q", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, items: [{ _rowIndex: 2, id: 1, name: "Sara", phone: "+2010" }] }), { status: 200 }),
    );
    const r = await getContactsList();
    expect(r.success).toBe(true);
    expect(r.items?.[0].name).toBe("Sara");
    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain("action=getContacts");
    expect(url).toContain("password=secret");
    expect(url).not.toContain("q=");
  });

  it("getAvailabilitySummary is PUBLIC (no password), sends no slot param, and returns { availability }", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, availability: { date: "2026-06-14", slots: [{ time: "14:00", status: "open" }] } }), { status: 200 }),
    );
    const r = await getAvailabilitySummary();
    expect(r.availability?.slots[0].time).toBe("14:00");
    expect(r.availability?.slots[0].status).toBe("open");
    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain("action=getAvailability");
    expect(url).not.toContain("password="); // public action
    expect(url).not.toContain("slot=");
  });
});

describe("agent mutate clients", () => {
  beforeEach(() => {
    process.env.APPS_SCRIPT_URL = "https://script.example/exec";
    process.env.APPS_SCRIPT_ADMIN_PASSWORD = "secret";
  });
  afterEach(() => vi.restoreAllMocks());

  it("toggleMenuVisibility sends rowIndex + status (NOT id/visible)", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    await toggleMenuVisibility(7, "hidden");
    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain("action=toggleVisibility");
    expect(url).toContain("rowIndex=7");
    expect(url).toContain("status=hidden");
    expect(url).toContain("password=secret");
    expect(url).not.toContain("id=");
    expect(url).not.toContain("visible=");
  });

  it("togglePantryVisibility sends rowIndex + status", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    await togglePantryVisibility(4, "available");
    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain("action=togglePantryVisibility");
    expect(url).toContain("rowIndex=4");
    expect(url).toContain("status=available");
  });

  it("decideRequisition encodes the decision in the action name and sends ONLY rowIndex (no decision param)", async () => {
    // Fresh Response per call — a single Response body can only be read once.
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    await decideRequisition(5, "approve");
    const approveUrl = spy.mock.calls[0][0] as string;
    expect(approveUrl).toContain("action=approveRequisition");
    expect(approveUrl).toContain("rowIndex=5");
    expect(approveUrl).not.toContain("decision=");
    expect(approveUrl).not.toContain("id=");

    await decideRequisition(6, "reject");
    const rejectUrl = spy.mock.calls[1][0] as string;
    expect(rejectUrl).toContain("action=rejectRequisition");
    expect(rejectUrl).toContain("rowIndex=6");
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
