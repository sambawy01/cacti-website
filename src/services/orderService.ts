/**
 * Customer-facing order API — availability, capacity-checked placement,
 * and tracking. Same fetch-GET pattern as adminService.ts: GET only,
 * because POST bodies are lost in Google's 302 redirect.
 */
import { ORDERS_API_BASE } from "../config";

const CRM_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzN-s2iKeyjIC_k-wyNzj6QHOO5eoW14EqWo7fC4kYzYzqyMOygZpCDPpyqPVxhFA/exec';

export interface SlotInfo {
  time: string; // 'HH:mm' 24h
  status: 'open' | 'busy';
}

export interface Availability {
  paused: boolean;
  date: string; // 'yyyy-MM-dd'
  slots: SlotInfo[];
  asap: string | null; // earliest open slot, or null if none
}

export interface TrackedOrder {
  name: string;
  status: string;
  deliveryDate: string;
  deliverySlot: string;
  orderSummary: string;
  orderTotal: number | string;
}

/** '14:30' → '2:30 PM' (mirror of slotLabel12h in apps-script/capacity.gs) */
export function slotLabel(time: string): string {
  const [hStr, mStr] = String(time).split(':');
  const h = Number(hStr);
  const ampm = h >= 12 ? 'PM' : 'AM';
  let hr = h % 12;
  if (hr === 0) hr = 12;
  return `${hr}:${mStr} ${ampm}`;
}

async function apiGet<T>(params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${CRM_ENDPOINT}?${qs}`, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Returns null on any failure — callers fail open (show all slots). */
export async function getAvailability(): Promise<Availability | null> {
  try {
    const res = await apiGet<{ success: boolean; availability?: Availability }>({
      action: 'getAvailability',
    });
    return res.success && res.availability ? res.availability : null;
  } catch {
    return null;
  }
}

export async function getOrderStatus(token: string): Promise<TrackedOrder | null> {
  try {
    const res = await apiGet<{ success: boolean; order?: TrackedOrder }>({
      action: 'getOrderStatus',
      token,
    });
    return res.success && res.order ? res.order : null;
  } catch {
    return null;
  }
}

export type OnSitePaymentMethod = "cod" | "card_on_delivery" | "instapay";

export interface OnSiteOrderInput {
  items: { name: string; quantity: number; price: number }[];
  name: string;
  phone: string;
  email: string;
  address: string;
  note?: string;
  deliverySlot: string; // 'HH:mm'
  expectedStatus: "open" | "busy";
  paymentMethod: OnSitePaymentMethod;
}

export type OnSiteOrderResult =
  | { ok: true; status: "confirmed" | "pending_approval"; trackingToken: string; deliverySlot: string; paymentMethod: OnSitePaymentMethod }
  | { ok: false; code?: "slot_full" | "slot_unavailable" | "busy_retry" | "daily_limit"; error?: string };

/** POST the order to the Vercel backend (the on-site confirmed-sale flow). */
export async function placeOrderOnSite(input: OnSiteOrderInput): Promise<OnSiteOrderResult> {
  try {
    const res = await fetch(`${ORDERS_API_BASE}/api/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const json = (await res.json().catch(() => ({}))) as OnSiteOrderResult;
    if (res.ok && (json as { ok?: boolean }).ok) return json;
    // 400/409/502 → carry the structured error/code if present
    const fail = json as { code?: 'slot_full' | 'slot_unavailable' | 'busy_retry' | 'daily_limit'; error?: string };
    return { ok: false, code: fail.code, error: fail.error };
  } catch {
    return { ok: false, error: "Network error. Please try again." };
  }
}
