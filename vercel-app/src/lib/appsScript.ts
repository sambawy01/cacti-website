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
