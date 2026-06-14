import type { InlineKeyboard } from "./telegram";
import type { OrderStatus } from "./appsScript";
import { isActiveStatus, stageActionLabel, targetLine } from "./sla";

export interface OrderForMessage {
  name: string;
  phone: string;
  email: string;
  address: string;
  note?: string;
  location?: string;
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
  if (o.location) lines.push(`📍 ${o.location}`);
  if (o.note) lines.push(`📝 ${o.note}`);
  lines.push(
    `🕒 ${slotLabel(o.deliverySlot)} today`,
    `💳 ${PAYMENT_LABEL[o.paymentMethod]}`,
    "",
    o.orderSummary,
    "",
    `Total: ${o.orderTotal} EGP  ·  ${o.itemCount} item(s)`,
  );
  if (isActiveStatus(o.status)) {
    lines.push("", targetLine(o.status, new Date()));
  }
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

/**
 * The "Running late" delay actions are NOT status changes. delay15/30/60 map to
 * a minute amount; delay (open sub-keyboard) and delayback (restore keyboard)
 * are control actions that return null here. These never collide with the
 * ACTION_STATUS map, so actionToStatus stays null for all of them.
 */
const DELAY_MINUTES: Record<string, number> = {
  delay15: 15,
  delay30: 30,
  delay60: 60,
};

export function delayActionMinutes(action: string): number | null {
  return DELAY_MINUTES[action] ?? null;
}

function btn(text: string, action: string, token: string) {
  return { text, callback_data: `${action}:${token}` };
}

export function keyboardForStatus(status: OrderStatus, token: string): InlineKeyboard {
  switch (status) {
    case "pending_approval":
      return { inline_keyboard: [[btn("✅ Approve", "approve", token), btn("❌ Decline", "decline", token)]] };
    case "confirmed":
      return { inline_keyboard: [
        [btn("👨‍🍳 Preparing", "preparing", token), btn("🚫 Cancel", "cancel", token)],
        [btn("⏰ Running late", "delay", token)],
      ] };
    case "preparing":
      return { inline_keyboard: [
        [btn("🛵 Out for delivery", "otd", token), btn("🚫 Cancel", "cancel", token)],
        [btn("⏰ Running late", "delay", token)],
      ] };
    case "out_for_delivery":
      return { inline_keyboard: [[btn("📦 Delivered", "delivered", token)]] };
    default:
      return { inline_keyboard: [] };
  }
}

/** The sub-keyboard shown after the owner taps "⏰ Running late". */
export function delayKeyboard(token: string): InlineKeyboard {
  return { inline_keyboard: [
    [btn("+15 min", "delay15", token), btn("+30 min", "delay30", token), btn("+60 min", "delay60", token)],
    [btn("⬅ Back", "delayback", token)],
  ] };
}

export interface SlaAlertInput {
  id: number | string;
  name: string;
  phone: string;
  status: "pending_approval" | "confirmed" | "preparing" | "out_for_delivery";
  overdueMin: number;
  limitMin: number;
}

/** A self-contained, actionable overdue alert for the sales group. Pair it with
 * keyboardForStatus(status, token) so a tap advances the order like the ticket. */
export function buildSlaAlertMessage(o: SlaAlertInput): string {
  // Collapse any newline/control chars so a crafted customer name/phone can't
  // distort the alert layout (e.g. inject fake header lines).
  const oneLine = (s: string): string => s.replace(/[\r\n\t]+/g, " ").trim();
  return [
    `⏰ OVERDUE — Order #${o.id}`,
    `👤 ${oneLine(o.name)}  ·  ${oneLine(o.phone)}`,
    `"${stageActionLabel(o.status)}" is ${o.overdueMin} min late (target ${o.limitMin} min)`,
    "👇 tap to act",
  ].join("\n");
}
