/**
 * Loyverse POS order-push (Part 2 of the Loyverse integration).
 *
 * When an order is CONFIRMED we post it to Loyverse as a completed receipt.
 * A Loyverse failure must NEVER fail the order (it is already in Sheets +
 * Telegram + email) — every exported function here is wrapped and returns a
 * result object instead of throwing.
 *
 * The store / device / payment-type IDs are NOT secrets (they are
 * account-scoped configuration), so they live here as constants. Only
 * LOYVERSE_TOKEN is a secret and is read from the environment; when it is
 * absent the whole feature is dormant (loyverseConfigured() === false).
 */

const LOYVERSE_BASE = "https://api.loyverse.com/v1.0";

// Account-scoped (non-secret) configuration for the Bistro Cloud Loyverse account.
const STORE_ID = "39af263c-0119-49b8-9dc0-4fe99d35acba";
const POS_DEVICE_ID = "d565e82e-52c5-48c6-83f1-b20e437d50bc";
const RECEIPT_SOURCE = "Website";

type PaymentMethod = "cod" | "card_on_delivery" | "instapay";

const PAYMENT_TYPE_IDS: Record<PaymentMethod, string> = {
  cod: "1252b529-b628-4408-aaa6-1bfb7a0c5d43", // Cash
  card_on_delivery: "77c7ac0a-f82b-46c1-a2e7-c39810bb88fd", // Card
  instapay: "a2b2d5bb-10e9-4842-9850-7993c0d2dcde", // Instapay
};

const ITEMS_PAGE_LIMIT = 250;
const MAP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const HTTP_TIMEOUT_MS = 15_000;

export interface LoyverseOrderItem {
  name: string;
  quantity: number;
  price: number; // per-unit price
}

export interface LoyverseOrder {
  items: LoyverseOrderItem[];
  name: string;
  phone: string;
  address: string;
  deliverySlot: string;
  paymentMethod: PaymentMethod;
  orderTotal: number;
  trackingToken: string;
  location?: string;
}

export type VariantMap = Record<string, string>; // normalizedName -> variant_id

export interface PushReceiptResult {
  ok: boolean;
  receiptNumber?: string;
  error?: string;
}

export function loyverseConfigured(): boolean {
  return Boolean(process.env.LOYVERSE_TOKEN);
}

/**
 * Normalize a name for MATCHING: lowercase, strip every non-alphanumeric char.
 * MUST stay byte-for-byte identical to scripts/loyverse-sync.mjs so the catalog
 * synced there lines up with the lookups here.
 */
export function normalizeName(name: string): string {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// In-memory TTL cache of the normalized-name -> variant_id map.
let cachedMap: VariantMap | null = null;
let cacheExpires = 0;

/** Test hook: clear the in-memory variant-map cache. */
export function __resetCacheForTests(): void {
  cachedMap = null;
  cacheExpires = 0;
}

function lvHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.LOYVERSE_TOKEN}`,
    "Content-Type": "application/json",
  };
}

interface LoyverseVariant {
  variant_id?: string;
  item_name?: string;
}
interface LoyverseItem {
  item_name?: string;
  variants?: LoyverseVariant[];
}
interface ItemsPage {
  items?: LoyverseItem[];
  cursor?: string | null;
}

/** Fetch ALL items (paginating via `cursor`) and build the normalized-name -> variant_id map. */
async function fetchVariantMap(): Promise<VariantMap> {
  const map: VariantMap = {};
  let cursor: string | null = null;
  do {
    const qs: string = cursor
      ? `?limit=${ITEMS_PAGE_LIMIT}&cursor=${encodeURIComponent(cursor)}`
      : `?limit=${ITEMS_PAGE_LIMIT}`;
    const res = await fetch(`${LOYVERSE_BASE}/items${qs}`, {
      headers: lvHeaders(),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`GET /items HTTP ${res.status}`);
    const page = (await res.json()) as ItemsPage;
    for (const item of page.items ?? []) {
      const variant = item.variants?.[0];
      if (!variant?.variant_id) continue;
      // Prefer the item name; fall back to the variant's own name if present.
      const key = normalizeName(item.item_name || variant.item_name || "");
      if (key && !(key in map)) map[key] = variant.variant_id;
    }
    cursor = page.cursor ?? null;
  } while (cursor);
  return map;
}

/**
 * Return the normalized-name -> variant_id map, using a 5-minute TTL cache.
 * On a fetch failure, return the last good map (or {}), so callers fall back to
 * custom line items instead of throwing. Never rejects.
 */
export async function getVariantMap(): Promise<VariantMap> {
  const now = Date.now();
  if (cachedMap && now < cacheExpires) return cachedMap;
  try {
    const map = await fetchVariantMap();
    cachedMap = map;
    cacheExpires = now + MAP_TTL_MS;
    return map;
  } catch (err) {
    console.error("[loyverse] item map fetch failed (falling back to custom line items):", err);
    return cachedMap ?? {};
  }
}

interface CatalogLineItem {
  variant_id: string;
  quantity: number;
  price: number;
}
interface CustomLineItem {
  item_name: string;
  quantity: number;
  price: number;
}
type ReceiptLineItem = CatalogLineItem | CustomLineItem;

export interface ReceiptBody {
  store_id: string;
  pos_device_id: string;
  source: string;
  receipt_date: string;
  line_items: ReceiptLineItem[];
  payments: { payment_type_id: string; money_amount: number }[];
  note: string;
}

/**
 * Pure, unit-testable: map an order + variant map into a Loyverse receipt body.
 * Catalog items (found in the map) become `{ variant_id }` line items; anything
 * unmatched becomes a custom `{ item_name }` line item so the sale still records.
 */
export function buildReceiptBody(order: LoyverseOrder, variantMap: VariantMap): ReceiptBody {
  const line_items: ReceiptLineItem[] = order.items.map((it) => {
    const variantId = variantMap[normalizeName(it.name)];
    if (variantId) {
      // CATALOG line item.
      return { variant_id: variantId, quantity: it.quantity, price: it.price };
    }
    // CUSTOM line item (brand-new dish not yet synced, or a name mismatch).
    return { item_name: it.name, quantity: it.quantity, price: it.price };
  });

  const note =
    `Web order — ${order.name}, ${order.phone}\n` +
    `${order.address}\n` +
    `Delivery: ${order.deliverySlot} | Track: ${order.trackingToken}` +
    (order.location ? `\nLocation: ${order.location}` : "");

  return {
    store_id: STORE_ID,
    pos_device_id: POS_DEVICE_ID,
    source: RECEIPT_SOURCE,
    receipt_date: new Date().toISOString(),
    line_items,
    payments: [
      {
        payment_type_id: PAYMENT_TYPE_IDS[order.paymentMethod],
        money_amount: order.orderTotal,
      },
    ],
    note,
  };
}

/**
 * Parse an order_summary string (the `${qty}x ${name} (${lineTotal} EGP)`
 * format produced by validation.ts) back into structured line items. Used by
 * the Telegram approve path, which only has the stored summary string.
 * Lines that don't parse are skipped; the caller handles an empty result.
 */
export function parseOrderSummary(summary: string): LoyverseOrderItem[] {
  const items: LoyverseOrderItem[] = [];
  for (const rawLine of String(summary || "").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = line.match(/^(\d+)x\s+(.+?)\s+\((\d+(?:\.\d+)?)\s*EGP\)\s*$/i);
    if (!m) continue;
    const quantity = parseInt(m[1], 10);
    const name = m[2].trim();
    const lineTotal = Number(m[3]);
    if (!Number.isFinite(quantity) || quantity < 1 || !name || !Number.isFinite(lineTotal)) continue;
    items.push({ name, quantity, price: lineTotal / quantity });
  }
  return items;
}

/**
 * Build and POST a Loyverse receipt for a confirmed order. Never throws —
 * returns { ok, receiptNumber?, error? }. Dormant (returns ok:false) when the
 * token isn't configured.
 */
export async function pushReceipt(order: LoyverseOrder): Promise<PushReceiptResult> {
  if (!loyverseConfigured()) {
    return { ok: false, error: "Loyverse not configured" };
  }
  try {
    const variantMap = await getVariantMap();
    const body = buildReceiptBody(order, variantMap);
    const res = await fetch(`${LOYVERSE_BASE}/receipts`, {
      method: "POST",
      headers: lvHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `Loyverse HTTP ${res.status}: ${detail.slice(0, 300)}` };
    }
    const data = (await res.json().catch(() => ({}))) as { receipt_number?: string };
    return { ok: true, receiptNumber: data.receipt_number };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
