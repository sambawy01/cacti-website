import { describe, it, expect } from "vitest";
import {
  STAGE_LIMITS_MIN,
  SLA_ACTIVE_STATUSES,
  isActiveStatus,
  stageDeadline,
  stageActionLabel,
  targetLine,
  overdueMinutes,
  shouldAlert,
  withinOperatingHours,
} from "./sla";

const at = (iso: string) => new Date(iso);

describe("STAGE_LIMITS_MIN", () => {
  it("matches the agreed per-stage limits", () => {
    expect(STAGE_LIMITS_MIN).toEqual({
      pending_approval: 3, confirmed: 5, preparing: 15, out_for_delivery: 10,
    });
  });
});

describe("isActiveStatus", () => {
  it("accepts the 4 active statuses and rejects terminal ones", () => {
    expect(SLA_ACTIVE_STATUSES).toEqual(["pending_approval", "confirmed", "preparing", "out_for_delivery"]);
    expect(isActiveStatus("preparing")).toBe(true);
    expect(isActiveStatus("delivered")).toBe(false);
    expect(isActiveStatus("declined")).toBe(false);
  });
});

describe("stageDeadline", () => {
  it("adds the stage limit to the stage-entered time", () => {
    expect(stageDeadline("confirmed", at("2026-06-14T14:30:00+02:00")).toISOString())
      .toBe(new Date("2026-06-14T14:35:00+02:00").toISOString());
  });
});

describe("stageActionLabel", () => {
  it("gives the imperative verb per stage", () => {
    expect(stageActionLabel("pending_approval")).toBe("Approve/decline");
    expect(stageActionLabel("confirmed")).toBe("Start preparing");
    expect(stageActionLabel("preparing")).toBe("Out for delivery");
    expect(stageActionLabel("out_for_delivery")).toBe("Deliver");
  });
});

describe("targetLine", () => {
  it("renders the 🎯 line with a 12h Cairo time", () => {
    // 14:30 Cairo + 5 min = 14:35 Cairo = 2:35 PM
    // Cairo is UTC+3 (EEST) in June 2026, so use +03:00 to represent a Cairo-local time
    expect(targetLine("confirmed", at("2026-06-14T14:30:00+03:00")))
      .toBe("🎯 Start preparing by 2:35 PM");
  });
});

describe("overdueMinutes", () => {
  it("is whole minutes past the deadline (0 if not past)", () => {
    const entered = at("2026-06-14T14:00:00+02:00"); // confirmed, deadline 14:05
    expect(overdueMinutes("confirmed", entered, at("2026-06-14T14:09:30+02:00"))).toBe(4);
    expect(overdueMinutes("confirmed", entered, at("2026-06-14T14:04:00+02:00"))).toBe(0);
  });
});

describe("shouldAlert", () => {
  const entered = at("2026-06-14T14:00:00+02:00"); // confirmed → deadline 14:05

  it("does not alert before the deadline", () => {
    expect(shouldAlert({ status: "confirmed", stageEnteredAt: entered, lastAlertedAt: null, now: at("2026-06-14T14:04:00+02:00") })).toBe(false);
  });
  it("first alert: breached and never alerted this stage", () => {
    expect(shouldAlert({ status: "confirmed", stageEnteredAt: entered, lastAlertedAt: null, now: at("2026-06-14T14:06:00+02:00") })).toBe(true);
  });
  it("suppresses a re-nag within 5 min of the last alert", () => {
    expect(shouldAlert({ status: "confirmed", stageEnteredAt: entered, lastAlertedAt: at("2026-06-14T14:06:00+02:00"), now: at("2026-06-14T14:08:00+02:00") })).toBe(false);
  });
  it("re-nags once 5 min have passed since the last alert", () => {
    expect(shouldAlert({ status: "confirmed", stageEnteredAt: entered, lastAlertedAt: at("2026-06-14T14:06:00+02:00"), now: at("2026-06-14T14:11:00+02:00") })).toBe(true);
  });
  it("treats a lastAlertedAt older than the stage as a new stage (alerts)", () => {
    // alert marker from the previous stage (13:50) — new stage started 14:00
    expect(shouldAlert({ status: "confirmed", stageEnteredAt: entered, lastAlertedAt: at("2026-06-14T13:50:00+02:00"), now: at("2026-06-14T14:06:00+02:00") })).toBe(true);
  });
  it("never alerts for a terminal status", () => {
    expect(shouldAlert({ status: "delivered" as any, stageEnteredAt: entered, lastAlertedAt: null, now: at("2026-06-14T20:00:00+02:00") })).toBe(false);
  });
});

describe("withinOperatingHours", () => {
  it("is true at 16:00 Cairo and false at 03:00 Cairo", () => {
    expect(withinOperatingHours(at("2026-06-14T16:00:00+02:00"))).toBe(true);
    expect(withinOperatingHours(at("2026-06-14T03:00:00+02:00"))).toBe(false);
  });
});
