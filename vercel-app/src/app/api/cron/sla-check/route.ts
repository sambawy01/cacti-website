import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { slaListActiveOrders, markSlaAlerted, type SlaActiveOrder } from "@/lib/appsScript";
import { sendMessage } from "@/lib/telegram";
import { buildSlaAlertMessage, keyboardForStatus } from "@/lib/orderMessage";
import {
  isActiveStatus, shouldAlert, overdueMinutesDisplay, STAGE_LIMITS_MIN, withinOperatingHours,
  cairoSlotInstant, type ActiveStatus,
} from "@/lib/sla";
import type { OrderStatus } from "@/lib/appsScript";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const received = request.headers.get("authorization");
  if (!secret || !received) return false;
  const a = Buffer.from(received, "utf8");
  const b = Buffer.from(`Bearer ${secret}`, "utf8");
  if (a.length !== b.length) {
    timingSafeEqual(a, a); // constant-time even on length mismatch
    return false;
  }
  return timingSafeEqual(a, b);
}

/** Parse an ISO string to Date, or null if blank/invalid. */
function parseDate(s: string | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export async function GET(request: Request): Promise<Response> {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const now = new Date();
  if (!withinOperatingHours(now)) return NextResponse.json({ ok: true, skipped: "closed" });

  let list: { success: boolean; orders?: SlaActiveOrder[]; error?: string };
  try {
    list = await slaListActiveOrders();
  } catch (err) {
    console.error("[sla-check] read failed:", err);
    return NextResponse.json({ ok: false, error: "read failed" }, { status: 200 });
  }
  if (!list.success || !list.orders) return NextResponse.json({ ok: false, error: list.error || "no orders" });

  const chatId = process.env.TELEGRAM_OWNER_CHAT_ID;
  let alerted = 0;
  for (const o of list.orders) {
    if (!isActiveStatus(o.status)) continue;
    const stageEnteredAt = parseDate(o.status_changed_at);
    if (!stageEnteredAt) continue; // can't compute a deadline without an anchor
    const lastAlertedAt = parseDate(o.sla_alerted_at);
    // Deadlines work BACKWARD from the delivery slot. Build the Cairo slot
    // instant from date + slot; a null (unparseable) slot makes the engine fall
    // back to the entered-relative deadline so nothing goes un-tracked.
    const slotInstant = cairoSlotInstant(o.delivery_date, o.delivery_slot);
    if (!shouldAlert({ status: o.status, stageEnteredAt, lastAlertedAt, now, slotInstant })) continue;

    const status = o.status as ActiveStatus;
    const text = buildSlaAlertMessage({
      token: o.tracking_token, name: o.name, phone: o.phone, slot: o.delivery_slot, status,
      overdueMin: overdueMinutesDisplay(status, stageEnteredAt, now, slotInstant),
      limitMin: STAGE_LIMITS_MIN[status],
    });
    try {
      if (!chatId) {
        console.error("[sla-check] TELEGRAM_OWNER_CHAT_ID unset; cannot alert");
        break; // none can be sent — stop scanning the rest of the list
      }
      const res = await sendMessage(chatId, text, keyboardForStatus(o.status as OrderStatus, o.tracking_token));
      if (!res.ok) {
        // Telegram rejected (429/403/400…). Do NOT mark — let it retry next run.
        console.error("[sla-check] send rejected", o.tracking_token, res.status, res.description);
        continue;
      }
      // The alert went out. Persist the throttle marker; if the WRITE fails,
      // log it and do NOT count it as throttled — leaving sla_alerted_at stale
      // means it retries next run (per-minute) rather than silently succeeding.
      const mark = await markSlaAlerted(o.tracking_token);
      if (!mark.success) {
        console.error("[sla-check] markSlaAlerted failed (will retry next run)", o.tracking_token, mark.error);
        continue;
      }
      alerted += 1;
    } catch (err) {
      console.error("[sla-check] alert failed for", o.tracking_token, err);
    }
  }
  return NextResponse.json({ ok: true, checked: list.orders.length, alerted });
}
