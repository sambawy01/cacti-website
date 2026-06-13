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
    paymentMethod: input.paymentMethod,
    instapayDetails: input.instapayDetails || "",
  });
}

export type OrderStatus =
  | "pending_approval" | "confirmed" | "preparing" | "out_for_delivery" | "delivered" | "declined" | "cancelled";

export async function setOrderStatusByToken(token: string, status: OrderStatus): Promise<{ success: boolean; status?: string; error?: string }> {
  const password = process.env.APPS_SCRIPT_ADMIN_PASSWORD;
  if (!password) throw new Error("APPS_SCRIPT_ADMIN_PASSWORD is not configured");
  return appsScriptGet({ action: "setOrderStatusByToken", password, token, status });
}
