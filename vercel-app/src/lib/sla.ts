/**
 * Pure SLA engine for order-stage timers. No I/O — every "now" is injected, so the
 * whole module is deterministically unit-testable. Times are formatted/checked in
 * the Africa/Cairo timezone (the business runs in El Gouna, Egypt).
 */
import type { OrderStatus } from "./appsScript";

const CAIRO_TZ = "Africa/Cairo";

/** Statuses that have an SLA (a deadline to leave the stage). */
export type ActiveStatus = "pending_approval" | "confirmed" | "preparing" | "out_for_delivery";

export const SLA_ACTIVE_STATUSES: ActiveStatus[] = [
  "pending_approval", "confirmed", "preparing", "out_for_delivery",
];

/** Minutes allowed in each stage before a breach alert fires. */
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

export function stageDeadline(status: ActiveStatus, stageEnteredAt: Date): Date {
  return new Date(stageEnteredAt.getTime() + STAGE_LIMITS_MIN[status] * 60_000);
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
export function targetLine(status: ActiveStatus, stageEnteredAt: Date): string {
  return `🎯 ${stageActionLabel(status)} by ${formatCairoTime(stageDeadline(status, stageEnteredAt))}`;
}

/** Whole minutes the order is past its stage deadline (0 if not past). */
export function overdueMinutes(status: ActiveStatus, stageEnteredAt: Date, now: Date): number {
  const ms = now.getTime() - stageDeadline(status, stageEnteredAt).getTime();
  return ms <= 0 ? 0 : Math.floor(ms / 60_000);
}

export interface ShouldAlertInput {
  status: string;
  stageEnteredAt: Date;
  lastAlertedAt: Date | null;
  now: Date;
}

/**
 * True when the group should be alerted right now. First alert: breached and
 * (never alerted, or the last alert predates this stage). Re-nag: breached and
 * >= RENAG_MIN since the last alert for this stage.
 */
export function shouldAlert({ status, stageEnteredAt, lastAlertedAt, now }: ShouldAlertInput): boolean {
  if (!isActiveStatus(status)) return false;
  if (now.getTime() <= stageDeadline(status, stageEnteredAt).getTime()) return false;
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
