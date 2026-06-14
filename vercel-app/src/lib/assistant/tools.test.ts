import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// NOTE: every mocked client returns the REAL deployed-Apps-Script response shape
// (verified against apps-script/admin-api.gs): getCRMOrders/getContacts use
// `items`, getAvailability returns `{ availability: { slots:[{time,status}] } }`,
// menu/pantry rows carry `_rowIndex` + `status`, stock rows carry `qty_on_hand`.
const NOW_ISO = new Date().toISOString();
vi.mock("@/lib/appsScript", () => ({
  slaListActiveOrders: vi.fn(async () => ({ success: true, orders: [{ tracking_token: "t1", status: "preparing", name: "A", order_summary: "x", delivery_slot: "14:00", delivery_date: "2026-06-14", phone: "" }] })),
  getOrderStatus: vi.fn(async () => ({ success: true, order: { name: "A", status: "preparing", deliveryDate: "2026-06-14", deliverySlot: "14:00", orderSummary: "x", orderTotal: 500 } })),
  getCrmOrdersList: vi.fn(async () => ({ success: true, items: [
    { order_total: 500, status: "confirmed", delivery_date: "", timestamp: NOW_ISO },
    { order_total: "300", status: "delivered", delivery_date: "", timestamp: NOW_ISO },
    { order_total: 999, status: "cancelled", delivery_date: "", timestamp: NOW_ISO }, // excluded from revenue
  ] })),
  setOrderStatusByToken: vi.fn(async () => ({ success: true, status: "confirmed", previousStatus: "pending_approval" })),
  delayOrder: vi.fn(async () => ({ success: true, newLabel: "14:30" })),
  logExpense: vi.fn(async () => ({ success: true, id: "exp-1" })),
  getMenuList: vi.fn(async () => ({ success: true, items: [{ _rowIndex: 2, id: 1, name: "Bone Broth", status: "available" }] })),
  getStockList: vi.fn(async () => ({ success: true, items: [{ _rowIndex: 2, id: 1, name: "Chicken", qty_on_hand: 12, unit: "kg" }] })),
  getPantryList: vi.fn(async () => ({ success: true, items: [{ _rowIndex: 2, id: 1, name: "Granola", status: "hidden" }] })),
  getAvailabilitySummary: vi.fn(async () => ({ success: true, availability: { date: "2026-06-14", slots: [{ time: "14:00", status: "open" }, { time: "15:00", status: "busy" }] } })),
  getContactsList: vi.fn(async () => ({ success: true, items: [{ _rowIndex: 2, id: 1, name: "Sara Ali", phone: "+201001234567", email: "sara@e.com" }] })),
  toggleMenuVisibility: vi.fn(async () => ({ success: true })),
  togglePantryVisibility: vi.fn(async () => ({ success: true })),
  decideRequisition: vi.fn(async () => ({ success: true })),
  orderFinalize: vi.fn(async () => ({ success: true })),
}));
vi.mock("@/lib/telegram", () => ({ sendMessage: vi.fn(async () => ({ ok: true, status: 200 })) }));

import { TOOLS, requiresConfirmation, validateMutationArgs, describeMutation, executeTool } from "./tools";
import {
  setOrderStatusByToken, getCrmOrdersList,
  toggleMenuVisibility, togglePantryVisibility, decideRequisition,
} from "@/lib/appsScript";
// IMPORTANT: the real broadcast_group imports sendMessage from @/lib/telegram,
// so the broadcast assertion must use the telegram mock (not appsScript).
import { sendMessage } from "@/lib/telegram";

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
  it("coerces a numeric string for log_expense amountEgp", () => {
    const r = validateMutationArgs("log_expense", { vendor: "M", amountEgp: "250" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.args.amountEgp).toBe(250);
  });
  it("rejects a missing required field", () => {
    const r = validateMutationArgs("order_set_status", { status: "confirmed" });
    expect(r.ok).toBe(false);
  });
  it("previews the SANITIZED broadcast text on the confirm card", () => {
    const summary = describeMutation("broadcast_group", { text: "Closed today‮evil" });
    expect(summary).not.toContain("‮"); // bidi stripped in the preview too
  });
  it("provides a human summary for every mutating tool", () => {
    expect(describeMutation("order_delay", { token: "t1", minutes: 15 })).toMatch(/t1/);
    expect(describeMutation("order_set_status", { token: "t1", status: "confirmed" }).length).toBeGreaterThan(0);
    expect(describeMutation("broadcast_group", { text: "hi" }).length).toBeGreaterThan(0);
    expect(describeMutation("log_expense", { vendor: "M", amountEgp: 10 }).length).toBeGreaterThan(0);
    expect(describeMutation("order_finalize", { token: "t1" }).length).toBeGreaterThan(0);
    expect(describeMutation("menu_set_out_of_stock", { rowIndex: 5, outOfStock: true })).toMatch(/row 5/);
    expect(describeMutation("requisition_decide", { rowIndex: 9, decision: "approve" })).toMatch(/row 9/);
  });
  it("coerces a numeric-string rowIndex for menu_set_out_of_stock", () => {
    const r = validateMutationArgs("menu_set_out_of_stock", { rowIndex: "5", outOfStock: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.args.rowIndex).toBe(5);
  });
  it("rejects menu_set_out_of_stock without a rowIndex", () => {
    expect(validateMutationArgs("menu_set_out_of_stock", { outOfStock: true }).ok).toBe(false);
  });
  it("rejects requisition_decide without a rowIndex", () => {
    expect(validateMutationArgs("requisition_decide", { decision: "approve" }).ok).toBe(false);
  });
});

describe("executeTool", () => {
  it("revenue_summary sums CRM order_total in the period and EXCLUDES declined/cancelled", async () => {
    const out = await executeTool("revenue_summary", { period: "today" }, { chatId: 1 });
    expect(out).toMatch(/800/);      // 500 + 300 (the 999 cancelled order is excluded)
    expect(out).not.toMatch(/1799/); // would be the total if cancelled leaked in
    expect(out).toMatch(/2 orders/);
  });
  it("revenue_summary reports unavailable when the CRM source fails (never a fabricated 0)", async () => {
    vi.mocked(getCrmOrdersList).mockResolvedValueOnce({ success: false } as never);
    const out = await executeTool("revenue_summary", { period: "today" }, { chatId: 1 });
    expect(out).toMatch(/unavailable/i);
    expect(out).not.toMatch(/0 EGP/);
  });
  it("capacity_today reads availability.slots ({time,status}) and can filter to one slot", async () => {
    const all = await executeTool("capacity_today", {}, { chatId: 1 });
    expect(all).toMatch(/14:00: open/);
    expect(all).toMatch(/15:00: full\/busy/);
    const one = await executeTool("capacity_today", { slot: "14:00" }, { chatId: 1 });
    expect(one).toContain("14:00: open");
    expect(one).not.toContain("15:00");
  });
  it("customer_lookup reads `items` and filters client-side by name/phone", async () => {
    const hit = await executeTool("customer_lookup", { query: "sara" }, { chatId: 1 });
    expect(hit).toContain("Sara Ali");
    expect(hit).toContain("+201001234567");
    const miss = await executeTool("customer_lookup", { query: "nobody" }, { chatId: 1 });
    expect(miss).toMatch(/No matching customer/i);
  });
  it("menu_list leads each line with the row number the toggle needs", async () => {
    const out = await executeTool("menu_list", {}, { chatId: 1 });
    expect(out).toContain("#2 Bone Broth");
  });
  it("menu_set_out_of_stock calls toggleMenuVisibility with rowIndex + 'hidden'", async () => {
    await executeTool("menu_set_out_of_stock", { rowIndex: 2, outOfStock: true }, { chatId: 1 });
    expect(toggleMenuVisibility).toHaveBeenCalledWith(2, "hidden");
  });
  it("menu_set_out_of_stock with pantry=true and outOfStock=false toggles pantry to 'available'", async () => {
    await executeTool("menu_set_out_of_stock", { rowIndex: 3, outOfStock: false, pantry: true }, { chatId: 1 });
    expect(togglePantryVisibility).toHaveBeenCalledWith(3, "available");
  });
  it("requisition_decide calls decideRequisition with the rowIndex and decision", async () => {
    await executeTool("requisition_decide", { rowIndex: 5, decision: "reject" }, { chatId: 1 });
    expect(decideRequisition).toHaveBeenCalledWith(5, "reject");
  });
  it("order_delay rejects a non-positive duration before calling the backend", async () => {
    const out = await executeTool("order_delay", { token: "t1", minutes: 0 }, { chatId: 1 });
    expect(out).toMatch(/positive/i);
  });
  it("order_set_status calls the apps script client", async () => {
    await executeTool("order_set_status", { token: "t1", status: "confirmed" }, { chatId: 1 });
    expect(setOrderStatusByToken).toHaveBeenCalledWith("t1", "confirmed");
  });
  it("broadcast_group sanitizes and sends to the group chat id", async () => {
    await executeTool("broadcast_group", { text: "Closed today‮evil" }, { chatId: 1 });
    expect(sendMessage).toHaveBeenCalled();
    const sent = (sendMessage as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(sent[0]).toBe("555");
    expect(sent[1]).not.toContain("‮"); // bidi stripped
  });
});
