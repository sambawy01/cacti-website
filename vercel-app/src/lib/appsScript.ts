/**
 * Server-side client for the existing Bistro Cloud Apps Script web app.
 * GET-only (POST bodies are lost in Google's 302 redirect). The Apps Script
 * remains the capacity + storage + calendar + customer-email authority;
 * this client just drives it.
 */

export interface PlaceOrderInput {
  name: string;
  phone: string;
  email: string;
  address: string;
  orderTotal: number;
  orderSummary: string;
  itemCount: number;
  deliverySlot: string;
  expectedStatus: "open" | "busy";
  note: string;
  location: string;
  paymentMethod: string;
  instapayDetails?: string;
}

export type PlaceOrderResult =
  | { success: true; status: "confirmed" | "pending_approval"; trackingToken: string; deliverySlot: string; deliveryDate: string; id?: number }
  | { success: false; code: "slot_full" | "slot_unavailable" | "busy_retry" | "daily_limit"; error?: string };

function endpoint(): string {
  const url = process.env.APPS_SCRIPT_URL;
  if (!url) throw new Error("APPS_SCRIPT_URL is not configured");
  return url;
}

async function appsScriptGet<T>(params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${endpoint()}?${qs}`, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Apps Script HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
  return appsScriptGet<PlaceOrderResult>({
    action: "placeOrder",
    channel: "web",
    // Fast checkout: Apps Script skips the kitchen calendar, confirmation email,
    // and Customers upsert; the route runs orderFinalize() out-of-band afterwards.
    defer: "true",
    name: input.name,
    phone: input.phone,
    email: input.email,
    address: input.address,
    deliveryArea: "El Gouna",
    orderTotal: String(input.orderTotal),
    orderSummary: input.orderSummary,
    itemCount: String(input.itemCount),
    deliverySlot: input.deliverySlot,
    expectedStatus: input.expectedStatus,
    note: input.note,
    location: input.location || "",
    paymentMethod: input.paymentMethod,
    instapayDetails: input.instapayDetails || "",
  });
}

/**
 * Run the deferred side-effects for a fast-checkout order: kitchen calendar,
 * confirmation email, and Customers upsert. placeOrder (defer=true) skips these
 * so the customer gets an instant response; this is called out-of-band via
 * `after()`. Idempotent in Apps Script (ScriptCache flag), so a retry is safe.
 * `instapayDetails` isn't stored on the row, so we thread it through to keep the
 * instapay confirmation-email bank block intact.
 */
export async function orderFinalize(
  token: string,
  instapayDetails?: string,
): Promise<{ success: boolean; alreadyDone?: boolean; skipped?: string; error?: string }> {
  const password = process.env.APPS_SCRIPT_ADMIN_PASSWORD;
  if (!password) throw new Error("APPS_SCRIPT_ADMIN_PASSWORD is not configured");
  return appsScriptGet({ action: "orderFinalize", password, token, instapayDetails: instapayDetails || "" });
}

export type OrderStatus =
  | "pending_approval" | "confirmed" | "preparing" | "out_for_delivery" | "delivered" | "declined" | "cancelled";

export async function setOrderStatusByToken(token: string, status: OrderStatus): Promise<{ success: boolean; status?: string; previousStatus?: string; error?: string }> {
  const password = process.env.APPS_SCRIPT_ADMIN_PASSWORD;
  if (!password) throw new Error("APPS_SCRIPT_ADMIN_PASSWORD is not configured");
  return appsScriptGet({ action: "setOrderStatusByToken", password, token, status });
}

/**
 * Shift an order's delivery slot forward by N minutes (15/30/60) via the
 * admin-gated Apps Script `delayOrder` action. Apps Script also emails the
 * customer the new ETA. Returns the human labels for the Telegram confirmation.
 */
export async function delayOrder(token: string, minutes: number): Promise<{ success: boolean; newLabel?: string; oldLabel?: string; error?: string }> {
  const password = process.env.APPS_SCRIPT_ADMIN_PASSWORD;
  if (!password) throw new Error("APPS_SCRIPT_ADMIN_PASSWORD is not configured");
  return appsScriptGet({ action: "delayOrder", password, token, minutes: String(minutes) });
}

export interface OrderStatusDetail {
  success: boolean;
  order?: {
    name: string;
    status: string;
    deliveryDate: string;
    deliverySlot: string;
    orderSummary: string;
    orderTotal: number | string;
    // Private fields — only returned when a valid admin password is supplied.
    email?: string;
    phone?: string;
    address?: string;
    note?: string;
    paymentMethod?: string;
  };
  error?: string;
}

/**
 * Fetch an order by its tracking token. With `withPrivate` (admin password
 * present) the Apps Script also returns phone/address/note/paymentMethod, which
 * the Telegram approve path needs to build a Loyverse receipt. Without it, only
 * the public (customer-tracking) fields come back.
 */
export async function getOrderStatus(token: string, withPrivate = false): Promise<OrderStatusDetail> {
  const params: Record<string, string> = { action: "getOrderStatus", token };
  if (withPrivate) {
    const password = process.env.APPS_SCRIPT_ADMIN_PASSWORD;
    if (password) params.password = password;
  }
  return appsScriptGet<OrderStatusDetail>(params);
}

export interface SlaActiveOrder {
  id: number | string;
  tracking_token: string;
  status: string;
  status_changed_at: string; // ISO; Apps Script falls back to creation timestamp
  sla_alerted_at: string;     // ISO or "" (never alerted)
  name: string;
  phone: string;
  delivery_date: string;      // yyyy-MM-dd (Cairo wall-clock) — needed to build the slot instant
  delivery_slot: string;      // HH:mm (Cairo wall-clock)
  order_summary: string;
}

/** Today's (Cairo) active orders with the fields the SLA cron needs. Admin-gated. */
export async function slaListActiveOrders(): Promise<{ success: boolean; orders?: SlaActiveOrder[]; error?: string }> {
  const password = process.env.APPS_SCRIPT_ADMIN_PASSWORD;
  if (!password) throw new Error("APPS_SCRIPT_ADMIN_PASSWORD is not configured");
  return appsScriptGet({ action: "slaListActiveOrders", password });
}

/** Record that an SLA breach alert was just sent for this order. Admin-gated. */
export async function markSlaAlerted(token: string): Promise<{ success: boolean; error?: string }> {
  const password = process.env.APPS_SCRIPT_ADMIN_PASSWORD;
  if (!password) throw new Error("APPS_SCRIPT_ADMIN_PASSWORD is not configured");
  return appsScriptGet({ action: "markSlaAlerted", password, token });
}

/**
 * Owner-DM Telegram agent clients.
 *
 * Each wraps an Apps Script action via the same GET-only `appsScriptGet`
 * pattern as the order clients above. They return a discriminated
 * `{ success: boolean; ... }` so the agent's tools can treat a non-success
 * response as a tool error rather than throwing into the tool-calling loop.
 *
 * Each request param name and parsed response field below was verified against
 * the real deployed Apps Script (`apps-script/admin-api.gs`). Key contract facts
 * that callers must respect:
 *  - getMenu / getPantry / getStock / getCRMOrders / getContacts are ALL
 *    admin-gated (getRole(password) guard in doGet) → they require `password`.
 *  - getAvailability is PUBLIC (no password) and returns `{ availability }`
 *    (NOT a flat `slots` array). availability.slots = [{ time, status }].
 *  - getCRMOrders and getContacts return their rows under `items` (NOT `orders`
 *    / `contacts`) and IGNORE any `range`/`q` param — they read the whole tab.
 *  - getOrders (adminGetOrders) reads the LEGACY People spreadsheet, returns
 *    `orders`, and ALSO ignores `range`. It is not the CRM revenue source.
 *  - toggleVisibility / togglePantryVisibility expect `rowIndex` + `status`
 *    (the literal string written to the sheet's status column, e.g.
 *    'hidden' / 'available'), NOT `id` / `visible`.
 *  - approveRequisition / rejectRequisition take ONLY `rowIndex` (the decision
 *    is encoded in the action name); there is no `decision` param server-side.
 *  - logExpense reads vendor/amount/date/category/note/source and returns
 *    `{ success, id }`.
 */

function adminPassword(): string {
  const p = process.env.APPS_SCRIPT_ADMIN_PASSWORD;
  if (!p) throw new Error("APPS_SCRIPT_ADMIN_PASSWORD is not configured");
  return p;
}

// ---- Read clients (admin-gated where they expose PII) ----

// adminGetMenu returns each row with `_rowIndex` + the sheet headers (id, name,
// price, status, ...). The menu visibility lives in the `status` column
// ('available' | 'limited' | 'sold_out' | 'hidden'); `_rowIndex` is what the
// toggleVisibility mutation needs. getMenu is admin-gated → password required.
export interface MenuItem { _rowIndex: number; id: number | string; name: string; status?: string; price?: number | string; }
export async function getMenuList(): Promise<{ success: boolean; items?: MenuItem[]; error?: string }> {
  return appsScriptGet({ action: "getMenu", password: adminPassword() });
}

export interface PantryItem { _rowIndex: number; id: number | string; name: string; status?: string; }
export async function getPantryList(): Promise<{ success: boolean; items?: PantryItem[]; error?: string }> {
  return appsScriptGet({ action: "getPantry", password: adminPassword() });
}

// inventoryGetAll returns Stock rows with `_rowIndex` + headers. Numeric columns
// (qty_on_hand, min_level) come back as numbers; `unit` is the unit label.
export interface StockRow { _rowIndex: number; id: number | string; name: string; qty_on_hand?: number | string; unit?: string; min_level?: number | string; }
export async function getStockList(): Promise<{ success: boolean; items?: StockRow[]; error?: string }> {
  return appsScriptGet({ action: "getStock", password: adminPassword() });
}

// orderGetAvailability (PUBLIC — no password) returns `{ availability }` where
// availability = { paused?, date?, asap?, slots: [{ time, status }] }. There is
// NO per-slot count and NO server-side slot filter — callers filter client-side.
export interface AvailabilitySlot { time: string; status: "open" | "busy"; }
export interface Availability { paused?: boolean; date?: string; asap?: boolean; slots: AvailabilitySlot[]; }
export async function getAvailabilitySummary(): Promise<{ success: boolean; availability?: Availability; error?: string }> {
  return appsScriptGet({ action: "getAvailability" });
}

// adminGetOrders reads the LEGACY People spreadsheet (old form submissions), not
// the CRM Orders tab — it returns `orders` with arbitrary legacy headers and
// IGNORES any range. Not the revenue source; kept only as a faithful client.
export interface LegacyOrder { _rowIndex: number; [key: string]: string | number; }
export async function getOrdersList(): Promise<{ success: boolean; orders?: LegacyOrder[]; error?: string }> {
  return appsScriptGet({ action: "getOrders", password: adminPassword() });
}

// getCRMOrders returns the CRM Orders tab under `items` (NOT `orders`) and
// ignores any range. order_total comes back as a number (crmReadRows coerces
// it) — this is the correct source for real revenue.
export interface CrmOrder {
  _rowIndex: number; id: number | string; timestamp: string; name: string; phone: string;
  email: string; delivery_area: string; address: string; order_total: number | string;
  order_summary: string; item_count: number | string; delivery_date: string;
  delivery_slot: string; tracking_token: string; status: string; notes: string;
}
export async function getCrmOrdersList(): Promise<{ success: boolean; items?: CrmOrder[]; error?: string }> {
  return appsScriptGet({ action: "getCRMOrders", password: adminPassword() });
}

// getContacts returns the Contacts tab under `items` (NOT `contacts`) and
// ignores any `q` — it reads the whole tab, so callers filter client-side.
// Contacts rows have no order-count column.
export interface Contact { _rowIndex: number; id: number | string; name: string; phone?: string; email?: string; message?: string; status?: string; }
export async function getContactsList(): Promise<{ success: boolean; items?: Contact[]; error?: string }> {
  return appsScriptGet({ action: "getContacts", password: adminPassword() });
}

// ---- Mutate clients (always reached via the confirm gate) ----

// adminToggleVisibility(rowIndex, status) writes `status` into the Menu sheet's
// status column. Hide via 'hidden', show via 'available' (matches the admin UI).
export async function toggleMenuVisibility(rowIndex: number, status: string): Promise<{ success: boolean; error?: string }> {
  return appsScriptGet({ action: "toggleVisibility", password: adminPassword(), rowIndex: String(rowIndex), status });
}
export async function togglePantryVisibility(rowIndex: number, status: string): Promise<{ success: boolean; error?: string }> {
  return appsScriptGet({ action: "togglePantryVisibility", password: adminPassword(), rowIndex: String(rowIndex), status });
}
// requisitionApprove / requisitionReject take ONLY rowIndex (the decision is the
// action name). approve may return a non-fatal `warning` (stock item not found).
export async function decideRequisition(rowIndex: number, decision: "approve" | "reject"): Promise<{ success: boolean; warning?: string; error?: string }> {
  return appsScriptGet({
    action: decision === "approve" ? "approveRequisition" : "rejectRequisition",
    password: adminPassword(),
    rowIndex: String(rowIndex),
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
