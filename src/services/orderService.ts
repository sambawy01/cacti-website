/**
 * Customer-facing order API — availability, capacity-checked placement,
 * and tracking. Same fetch-GET pattern as adminService.ts: GET only,
 * because POST bodies are lost in Google's 302 redirect.
 */
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

export interface PlaceOrderInput {
  name: string;
  phone: string;
  email: string;
  address: string;
  deliveryArea: string;
  orderTotal: number;
  orderSummary: string;
  itemCount: number;
  deliverySlot: string; // 'HH:mm'
  expectedStatus: 'open' | 'busy';
}

export type PlaceOrderResult =
  | { success: true; status: 'confirmed' | 'pending_approval'; trackingToken: string; deliverySlot: string; deliveryDate: string }
  | { success: false; code: 'slot_full' | 'slot_unavailable' | 'busy_retry' | 'daily_limit'; availability?: Availability };

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

/** Throws on network error so callers can fall back to the legacy flow. */
export async function placeOrderLive(input: PlaceOrderInput): Promise<PlaceOrderResult> {
  return apiGet<PlaceOrderResult>({
    action: 'placeOrder',
    name: input.name,
    phone: input.phone,
    email: input.email,
    address: input.address,
    deliveryArea: input.deliveryArea,
    orderTotal: String(input.orderTotal),
    orderSummary: input.orderSummary,
    itemCount: String(input.itemCount),
    deliverySlot: input.deliverySlot,
    expectedStatus: input.expectedStatus,
  });
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
