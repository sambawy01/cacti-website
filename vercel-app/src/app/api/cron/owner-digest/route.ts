import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getCrmOrdersList, getExpensesList, slaListActiveOrders, type CrmOrder } from "@/lib/appsScript";
import { sendMessage } from "@/lib/telegram";
import { getOwnerChatId, wasDigestSent, markDigestSent } from "@/lib/assistant/state";

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

/** Cairo wall-clock hour (0–23) for `now`. en-US hour12:false yields "24" at
 * midnight in some ICU builds, so fold it back to 0. */
function cairoHour(now: Date): number {
  const s = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", hour: "numeric", hour12: false }).format(now);
  return parseInt(s, 10) % 24;
}

/** Cairo calendar date as yyyy-MM-dd. en-CA formats in that exact shape. */
function cairoDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** The two digest slots, by Cairo hour. */
const MORNING_HOUR = 9;
const EVENING_HOUR = 20;

/**
 * Twice-daily owner digest. CRON_SECRET-gated like sla-check. The crons fire at
 * the UTC hours covering 9AM & 8PM Cairo for BOTH DST offsets; this in-route
 * Cairo-hour gate + a once-per-slot Blob marker guarantee exactly one send per
 * slot regardless of DST. Always returns 200 with a short status; never throws.
 */
export async function GET(request: Request): Promise<Response> {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  try {
    const now = new Date();
    const hour = cairoHour(now);
    const slot = hour === MORNING_HOUR ? MORNING_HOUR : hour === EVENING_HOUR ? EVENING_HOUR : null;
    if (slot === null) return NextResponse.json({ ok: true, status: "skipped: not a slot" });

    const key = `${cairoDate(now)}:${slot}`;
    if (await wasDigestSent(key)) return NextResponse.json({ ok: true, status: "skipped: already sent" });

    // Only DM a bound owner. getOwnerChatId fails CLOSED; a throw here is not a
    // takeover vector (read-only), so treat any failure as "no owner".
    let ownerChatId: number | null = null;
    try {
      ownerChatId = await getOwnerChatId();
    } catch (err) {
      console.error("[owner-digest] owner lookup failed:", err);
    }
    if (ownerChatId === null) return NextResponse.json({ ok: true, status: "skipped: no owner" });

    // --- Gather today's figures (all best effort; never fabricate a 0) -------
    const today = cairoDate(now);

    // Revenue: getCRMOrders ignores range and returns the whole tab, so window
    // to today's Cairo orders here (mirrors the revenue_summary tool). Skip
    // declined/cancelled; fall back to the timestamp's Cairo date if a row has
    // no delivery_date.
    let revenue: number | null = null;
    let orderCount = 0;
    // Each source is independently fault-isolated: a throw (e.g. a transient
    // Apps Script error) degrades only that field to "unavailable" rather than
    // killing the whole digest — there's only one cron per slot, so an aborted
    // run means no digest at all that slot.
    const crm = await getCrmOrdersList().catch(
      () => ({ success: false }) as Awaited<ReturnType<typeof getCrmOrdersList>>,
    );
    if (crm.success && crm.items) {
      const realized = (o: CrmOrder) => {
        const st = String(o.status || "").toLowerCase();
        if (st === "declined" || st === "cancelled") return false;
        const d = String(o.delivery_date || "") || (o.timestamp ? cairoDate(new Date(o.timestamp)) : "");
        return d === today;
      };
      const rows = crm.items.filter(realized);
      orderCount = rows.length;
      revenue = rows.reduce((sum, o) => sum + (Number(o.order_total) || 0), 0);
    }

    let expenses: number | null = null;
    const exp = await getExpensesList("today").catch(
      () => ({ success: false }) as Awaited<ReturnType<typeof getExpensesList>>,
    );
    if (exp.success && exp.items) {
      expenses = exp.items.reduce((sum, e) => sum + (Number(e.amount_egp) || 0), 0);
    }

    const net = revenue !== null && expenses !== null ? revenue - expenses : null;

    let pending: number | null = null;
    const active = await slaListActiveOrders().catch(
      () => ({ success: false }) as Awaited<ReturnType<typeof slaListActiveOrders>>,
    );
    if (active.success && active.orders) {
      pending = active.orders.filter((o) => o.status === "pending_approval").length;
    }

    const egp = (n: number | null) => (n === null ? "unavailable" : `${n} EGP`);
    const head = slot === MORNING_HOUR ? `☀️ Morning briefing — ${today}` : `🌙 Daily wrap-up — ${today}`;
    const text = [
      head,
      `Orders: ${orderCount}`,
      `Revenue: ${egp(revenue)}`,
      `Expenses: ${egp(expenses)}`,
      `Net: ${egp(net)}`,
      `Pending approval: ${pending === null ? "unavailable" : pending}`,
    ].join("\n");

    const res = await sendMessage(ownerChatId, text);
    if (res.ok) {
      await markDigestSent(key);
      return NextResponse.json({ ok: true, status: "sent" });
    }
    // Telegram rejected — do NOT mark, so the next cron in this slot retries.
    return NextResponse.json({ ok: false, status: "send failed" });
  } catch (err) {
    console.error("[owner-digest] run failed:", err);
    return NextResponse.json({ ok: false, status: "error" });
  }
}
