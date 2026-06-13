/**
 * Pure validation for the on-site order payload. Mandatory email is the
 * headline Phase 1 rule. Mirrors the field rules from the Holistic Beauty
 * reference, adapted for restaurant orders + the 3 settle-on-delivery
 * payment methods. No payment gateway: paymentMethod is informational.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9\s\-()]{8,17}$/;
const SLOT_RE = /^\d{1,2}:\d{2}$/;
const MAX_DISTINCT_ITEMS = 50;
const MAX_EMAIL_LEN = 120;
const MAX_ITEM_COUNT = 200;

/** Collapse newlines/tabs/control chars and runs of whitespace into single spaces. */
function oneLine(s: string): string {
  return s.replace(/[\x00-\x1f\x7f]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

export type PaymentMethod = "cod" | "card_on_delivery" | "instapay";
const PAYMENT_METHODS: PaymentMethod[] = ["cod", "card_on_delivery", "instapay"];

export interface ValidatedOrder {
  name: string;
  phone: string;
  email: string;
  address: string;
  note: string;
  deliverySlot: string;
  expectedStatus: "open" | "busy";
  paymentMethod: PaymentMethod;
  itemCount: number;
  orderTotal: number;
  orderSummary: string;
}

export type ValidationResult =
  | { ok: true; value: ValidatedOrder }
  | { ok: false; error: string };

interface RawItem { name?: unknown; quantity?: unknown; price?: unknown }

export function validateOrderPayload(body: unknown): ValidationResult {
  const b = (body ?? {}) as Record<string, unknown>;

  const rawItems = b.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { ok: false, error: "Cart is empty." };
  }
  if (rawItems.length > MAX_DISTINCT_ITEMS) {
    return { ok: false, error: "Too many distinct items." };
  }
  let itemCount = 0;
  let orderTotal = 0;
  const summaryLines: string[] = [];
  for (const raw of rawItems as RawItem[]) {
    const name = typeof raw.name === "string" ? oneLine(raw.name) : "";
    const qty = Math.floor(Number(raw.quantity));
    const price = Number(raw.price);
    if (!name || !Number.isFinite(qty) || qty < 1 || !Number.isFinite(price) || price < 0) {
      return { ok: false, error: "Invalid cart item." };
    }
    itemCount += qty;
    orderTotal += qty * price;
    summaryLines.push(`${qty}x ${name} (${qty * price} EGP)`);
  }
  if (itemCount > MAX_ITEM_COUNT) itemCount = MAX_ITEM_COUNT;

  const name = typeof b.name === "string" ? oneLine(b.name) : "";
  if (name.length < 2 || name.length > 80) return { ok: false, error: "Name is required." };

  const phone = typeof b.phone === "string" ? b.phone.trim() : "";
  if (!PHONE_RE.test(phone)) return { ok: false, error: "A valid phone number is required." };

  // MANDATORY email — the Phase 1 rule.
  const email = typeof b.email === "string" ? b.email.trim() : "";
  if (!email || email.length > MAX_EMAIL_LEN || !EMAIL_RE.test(email)) {
    return { ok: false, error: "A valid email is required for order updates." };
  }

  const address = typeof b.address === "string" ? oneLine(b.address) : "";
  if (address.length < 5 || address.length > 400) return { ok: false, error: "A delivery address is required." };

  const note = typeof b.note === "string" ? oneLine(b.note).slice(0, 500) : "";

  const deliverySlot = typeof b.deliverySlot === "string" ? b.deliverySlot.trim() : "";
  if (!SLOT_RE.test(deliverySlot)) return { ok: false, error: "Pick a delivery time." };

  const expectedStatus = b.expectedStatus === "busy" ? "busy" : b.expectedStatus === "open" ? "open" : null;
  if (!expectedStatus) return { ok: false, error: "Invalid slot state." };

  const paymentMethod = b.paymentMethod as PaymentMethod;
  if (!PAYMENT_METHODS.includes(paymentMethod)) return { ok: false, error: "Pick a payment method." };

  return {
    ok: true,
    value: { name, phone, email, address, note, deliverySlot, expectedStatus, paymentMethod, itemCount, orderTotal, orderSummary: summaryLines.join("\n") },
  };
}
