/**
 * Pure SLA engine for order-stage timers. No I/O — every "now" is injected, so the
 * whole module is deterministically unit-testable. Times are formatted/checked in
 * the Africa/Cairo timezone (the business runs in El Gouna, Egypt).
 *
 * Stage deadlines work BACKWARD from the delivery slot (not from when the stage
 * was entered), so an order placed early for a later slot is not spammed with
 * breach alerts for hours before the food is actually due. pending_approval is
 * the one exception — it chases the owner to approve and is slot-INDEPENDENT.
 */

const CAIRO_TZ = "Africa/Cairo";

/** Statuses that have an SLA (a deadline to leave the stage). */
export type ActiveStatus = "pending_approval" | "confirmed" | "preparing" | "out_for_delivery";

export const SLA_ACTIVE_STATUSES: ActiveStatus[] = [
  "pending_approval", "confirmed", "preparing", "out_for_delivery",
];

/** pending_approval limit (slot-independent) and the slot-anchored buffers. */
export const APPROVAL_LIMIT_MIN = 3;
export const PREP_MIN = 15;
export const DRIVE_MIN = 10;

/**
 * Per-stage minimum work-time from stage entry. Serves two roles:
 *  - the FLOOR CLAMP for the three slot-anchored stages (a rush/already-late
 *    order still gets at least this much time from when the stage was entered);
 *  - the null-slot FALLBACK deadline (entered + limit) when the delivery slot
 *    can't be parsed, so a malformed slot never crashes the cron or goes
 *    un-tracked.
 */
export const STAGE_LIMITS_MIN: Record<ActiveStatus, number> = {
  pending_approval: 3,
  confirmed: 5,
  preparing: 15,
  out_for_delivery: 10,
};

/** Re-nag interval once a stage is breached. */
export const RENAG_MIN = 5;

/** Operating window (Cairo hour, inclusive start, exclusive end). */
export const OPEN_HOUR = 13;
export const CLOSE_HOUR = 23;

export function isActiveStatus(status: string): status is ActiveStatus {
  return (SLA_ACTIVE_STATUSES as string[]).includes(status);
}

/**
 * Africa/Cairo UTC offset (in minutes, positive = east of UTC) at a given
 * instant, derived via Intl so Egypt's DST is honoured automatically (EEST
 * = UTC+3 in summer, EET = UTC+2 in winter) — never hardcoded.
 */
function cairoOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CAIRO_TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  let hour = get("hour");
  if (hour === 24) hour = 0; // some engines emit "24" for midnight
  const asIfUTC = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  return Math.round((asIfUTC - at.getTime()) / 60_000);
}

/**
 * Build the correct UTC instant for a Cairo wall-clock slot from a date
 * (yyyy-MM-dd) and time (HH:mm or H:mm). Returns null on blank/invalid input so
 * callers can fall back gracefully. DST-correct (offset is Intl-derived, not
 * hardcoded), including the rare DST-boundary case where the naive guess lands
 * on the other side of the transition.
 */
export function cairoSlotInstant(dateYmd: string, hhmm: string): Date | null {
  if (!dateYmd || !hhmm) return null;
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateYmd.trim());
  const tm = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!dm || !tm) return null;
  const y = Number(dm[1]), mo = Number(dm[2]), d = Number(dm[3]);
  const h = Number(tm[1]), mi = Number(tm[2]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;

  // Treat the wall-clock as if it were UTC, then subtract the Cairo offset at
  // that instant: utc = wall − offset.
  const wallAsUTC = Date.UTC(y, mo - 1, d, h, mi);
  // Reject impossible calendar dates (e.g. 2026-02-30, 2026-04-31): they pass the
  // 1–31 range guard above but Date.UTC silently rolls them into the next month.
  // Round-trip the constructed instant and require the components to match.
  const probe = new Date(wallAsUTC);
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    return null;
  }
  const offset1 = cairoOffsetMinutes(new Date(wallAsUTC));
  const utc1 = wallAsUTC - offset1 * 60_000;
  // Re-derive the offset at the corrected instant; if it differs (DST edge),
  // recompute once with that offset. A single re-correction suffices because
  // Cairo has exactly two offsets exactly 60 min apart (EET +2 / EEST +3), so a
  // naive guess can be off by at most one transition's worth.
  const offset2 = cairoOffsetMinutes(new Date(utc1));
  if (offset2 !== offset1) return new Date(wallAsUTC - offset2 * 60_000);
  return new Date(utc1);
}

/**
 * The breach deadline for a stage.
 *  - pending_approval: slot-INDEPENDENT → entered + APPROVAL_LIMIT_MIN.
 *  - confirmed:        slot − (PREP_MIN + DRIVE_MIN)   ("start preparing by")
 *  - preparing:        slot − DRIVE_MIN                ("out for delivery by")
 *  - out_for_delivery: slot                            ("deliver by")
 * The three slot-anchored stages are floor-clamped to entered + STAGE_LIMITS_MIN
 * so an already-late/rush order still gets its minimum stage work-time. If the
 * slot can't be parsed (slotInstant === null) every stage falls back to the
 * entered-relative deadline.
 */
export function stageDeadline(status: ActiveStatus, stageEnteredAt: Date, slotInstant: Date | null): Date {
  if (status === "pending_approval") {
    return new Date(stageEnteredAt.getTime() + APPROVAL_LIMIT_MIN * 60_000);
  }
  const floorMs = stageEnteredAt.getTime() + STAGE_LIMITS_MIN[status] * 60_000;
  if (!slotInstant) return new Date(floorMs);

  let anchoredMs: number;
  switch (status) {
    case "confirmed":
      anchoredMs = slotInstant.getTime() - (PREP_MIN + DRIVE_MIN) * 60_000;
      break;
    case "preparing":
      anchoredMs = slotInstant.getTime() - DRIVE_MIN * 60_000;
      break;
    case "out_for_delivery":
    default:
      anchoredMs = slotInstant.getTime();
      break;
  }
  return new Date(Math.max(anchoredMs, floorMs));
}

const ACTION_LABEL: Record<ActiveStatus, string> = {
  pending_approval: "Approve/decline",
  confirmed: "Start preparing",
  preparing: "Out for delivery",
  out_for_delivery: "Deliver",
};

export function stageActionLabel(status: ActiveStatus): string {
  return ACTION_LABEL[status];
}

/** 12-hour Cairo time, e.g. "2:35 PM". */
export function formatCairoTime(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: CAIRO_TZ, hour: "numeric", minute: "2-digit", hour12: true,
  }).format(d);
}

/** The 🎯 target line shown on the ticket for the current stage. */
export function targetLine(status: ActiveStatus, stageEnteredAt: Date, slotInstant: Date | null): string {
  return `🎯 ${stageActionLabel(status)} by ${formatCairoTime(stageDeadline(status, stageEnteredAt, slotInstant))}`;
}

/** Whole minutes the order is past its stage deadline (0 if not past). */
export function overdueMinutes(status: ActiveStatus, stageEnteredAt: Date, now: Date, slotInstant: Date | null): number {
  const ms = now.getTime() - stageDeadline(status, stageEnteredAt, slotInstant).getTime();
  return ms <= 0 ? 0 : Math.floor(ms / 60_000);
}

/**
 * Overdue minutes for the ALERT TEXT. Once breached it never reads "0 min late":
 * ceil with a floor of 1. (overdueMinutes stays floor-honest for raw maths.)
 */
export function overdueMinutesDisplay(status: ActiveStatus, stageEnteredAt: Date, now: Date, slotInstant: Date | null): number {
  const ms = now.getTime() - stageDeadline(status, stageEnteredAt, slotInstant).getTime();
  if (ms <= 0) return 0;
  return Math.max(1, Math.ceil(ms / 60_000));
}

export interface ShouldAlertInput {
  status: string;
  stageEnteredAt: Date;
  lastAlertedAt: Date | null;
  now: Date;
  slotInstant: Date | null;
}

/**
 * True when the group should be alerted right now. First alert: breached and
 * (never alerted, or the last alert predates this stage). Re-nag: breached and
 * >= RENAG_MIN since the last alert for this stage.
 */
export function shouldAlert({ status, stageEnteredAt, lastAlertedAt, now, slotInstant }: ShouldAlertInput): boolean {
  if (!isActiveStatus(status)) return false;
  if (now.getTime() <= stageDeadline(status, stageEnteredAt, slotInstant).getTime()) return false;
  const alertedThisStage = lastAlertedAt !== null && lastAlertedAt.getTime() >= stageEnteredAt.getTime();
  if (!alertedThisStage) return true;
  return now.getTime() - (lastAlertedAt as Date).getTime() >= RENAG_MIN * 60_000;
}

/** Cairo-local hour within [OPEN_HOUR, CLOSE_HOUR). */
export function withinOperatingHours(now: Date): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: CAIRO_TZ, hour: "2-digit", hour12: false }).format(now),
  );
  return hour >= OPEN_HOUR && hour < CLOSE_HOUR;
}
