import type { InlineKeyboard } from "./telegram";
import type { OrderStatus } from "./appsScript";

export interface OrderForMessage {
  name: string;
  phone: string;
  email: string;
  address: string;
  note?: string;
  orderSummary: string;
  orderTotal: number;
  itemCount: number;
  deliverySlot: string;
  paymentMethod: "cod" | "card_on_delivery" | "instapay";
  trackingToken: string;
  status: OrderStatus;
}

const PAYMENT_LABEL: Record<OrderForMessage["paymentMethod"], string> = {
  cod: "Cash on delivery",
  card_on_delivery: "Card on delivery (POS)",
  instapay: "Instapay (bank transfer)",
};

export function slotLabel(slot: string): string {
  const [hStr, mStr] = slot.split(":");
  const h = Number(hStr);
  const ampm = h >= 12 ? "PM" : "AM";
  let hr = h % 12;
  if (hr === 0) hr = 12;
  return `${hr}:${mStr} ${ampm}`;
}

export function buildOrderMessage(o: OrderForMessage): string {
  const header = o.status === "pending_approval"
    ? "🟠 NEW ORDER (busy slot — needs approval)"
    : "🟢 NEW ORDER (confirmed)";
  const lines: string[] = [
    header,
    "",
    `👤 ${o.name}  ·  ${o.phone}`,
    `✉️ ${o.email}`,
    `📍 ${o.address}`,
  ];
  if (o.note) lines.push(`📝 ${o.note}`);
  lines.push(
    `🕒 ${slotLabel(o.deliverySlot)} today`,
    `💳 ${PAYMENT_LABEL[o.paymentMethod]}`,
    "",
    o.orderSummary,
    "",
    `Total: ${o.orderTotal} EGP  ·  ${o.itemCount} item(s)`,
  );
  return lines.join("\n");
}

const ACTION_STATUS: Record<string, OrderStatus> = {
  approve: "confirmed",
  decline: "declined",
  preparing: "preparing",
  otd: "out_for_delivery",
  delivered: "delivered",
  cancel: "cancelled",
};

export function actionToStatus(action: string): OrderStatus | null {
  return ACTION_STATUS[action] ?? null;
}

function btn(text: string, action: string, token: string) {
  return { text, callback_data: `${action}:${token}` };
}

export function keyboardForStatus(status: OrderStatus, token: string): InlineKeyboard {
  switch (status) {
    case "pending_approval":
      return { inline_keyboard: [[btn("✅ Approve", "approve", token), btn("❌ Decline", "decline", token)]] };
    case "confirmed":
      return { inline_keyboard: [[btn("👨‍🍳 Preparing", "preparing", token), btn("🚫 Cancel", "cancel", token)]] };
    case "preparing":
      return { inline_keyboard: [[btn("🛵 Out for delivery", "otd", token), btn("🚫 Cancel", "cancel", token)]] };
    case "out_for_delivery":
      return { inline_keyboard: [[btn("📦 Delivered", "delivered", token)]] };
    default:
      return { inline_keyboard: [] };
  }
}
