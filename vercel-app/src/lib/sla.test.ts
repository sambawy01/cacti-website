import { describe, it, expect } from "vitest";
import {
  STAGE_LIMITS_MIN,
  SLA_ACTIVE_STATUSES,
  APPROVAL_LIMIT_MIN,
  PREP_MIN,
  DRIVE_MIN,
  isActiveStatus,
  cairoSlotInstant,
  stageDeadline,
  stageActionLabel,
  targetLine,
  overdueMinutes,
  overdueMinutesDisplay,
  shouldAlert,
  withinOperatingHours,
} from "./sla";

const at = (iso: string) => new Date(iso);

describe("STAGE_LIMITS_MIN", () => {
  it("matches the agreed per-stage limits (floor clamp + null-slot fallback)", () => {
    expect(STAGE_LIMITS_MIN).toEqual({
      pending_approval: 3, confirmed: 5, preparing: 15, out_for_delivery: 10,
    });
  });
});

describe("timing constants", () => {
  it("exposes the slot-anchored constants", () => {
    expect(APPROVAL_LIMIT_MIN).toBe(3);
    expect(PREP_MIN).toBe(15);
    expect(DRIVE_MIN).toBe(10);
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

describe("cairoSlotInstant", () => {
  it("builds the correct UTC instant for a summer (EEST = UTC+3) slot", () => {
    // 2026-06-14 19:00 Cairo (DST) → 16:00 UTC.
    expect(cairoSlotInstant("2026-06-14", "19:00")?.toISOString()).toBe("2026-06-14T16:00:00.000Z");
  });
  it("builds the correct UTC instant for a winter (EET = UTC+2) slot — DST handled, not hardcoded", () => {
    // 2026-01-15 19:00 Cairo (no DST) → 17:00 UTC.
    expect(cairoSlotInstant("2026-01-15", "19:00")?.toISOString()).toBe("2026-01-15T17:00:00.000Z");
  });
  it("accepts H:mm without a leading zero", () => {
    expect(cairoSlotInstant("2026-06-14", "9:30")?.toISOString()).toBe("2026-06-14T06:30:00.000Z");
  });
  it("returns null on blank or malformed input", () => {
    expect(cairoSlotInstant("", "19:00")).toBeNull();
    expect(cairoSlotInstant("2026-06-14", "")).toBeNull();
    expect(cairoSlotInstant("not-a-date", "19:00")).toBeNull();
    expect(cairoSlotInstant("2026-06-14", "99:99")).toBeNull();
    expect(cairoSlotInstant("2026-13-40", "19:00")).toBeNull();
  });
  it("rejects an impossible calendar date that passes the range guard but rolls over", () => {
    // Feb 30 / Apr 31 pass the 1–31 day guard but Date.UTC silently rolls them
    // into the next month — must be rejected, not accepted.
    expect(cairoSlotInstant("2026-02-30", "19:00")).toBeNull();
    expect(cairoSlotInstant("2026-04-31", "19:00")).toBeNull();
    // A genuinely valid date still works (round-trip guard is not over-eager).
    expect(cairoSlotInstant("2026-06-14", "19:00")?.toISOString()).toBe("2026-06-14T16:00:00.000Z");
  });
});

describe("stageDeadline (slot-anchored)", () => {
  // Slot 19:00 Cairo (summer) → 16:00 UTC.
  const slot = cairoSlotInstant("2026-06-14", "19:00")!;

  it("pending_approval is slot-INDEPENDENT: entered + APPROVAL_LIMIT_MIN", () => {
    const entered = at("2026-06-14T10:00:00.000Z");
    expect(stageDeadline("pending_approval", entered, slot).toISOString())
      .toBe(at("2026-06-14T10:03:00.000Z").toISOString());
  });

  it("confirmed = slot − 25 min (PREP + DRIVE) when not clamped", () => {
    const entered = at("2026-06-14T12:00:00.000Z"); // floor = 12:05, far below anchor
    // 16:00 UTC − 25 min = 15:35 UTC
    expect(stageDeadline("confirmed", entered, slot).toISOString())
      .toBe(at("2026-06-14T15:35:00.000Z").toISOString());
  });

  it("preparing = slot − 10 min (DRIVE) when not clamped", () => {
    const entered = at("2026-06-14T12:00:00.000Z");
    // 16:00 UTC − 10 min = 15:50 UTC
    expect(stageDeadline("preparing", entered, slot).toISOString())
      .toBe(at("2026-06-14T15:50:00.000Z").toISOString());
  });

  it("out_for_delivery = the slot instant itself when not clamped", () => {
    const entered = at("2026-06-14T12:00:00.000Z");
    expect(stageDeadline("out_for_delivery", entered, slot).toISOString())
      .toBe(at("2026-06-14T16:00:00.000Z").toISOString());
  });

  it("FLOOR CLAMP: a late/rush order gets at least the stage work-time from entry", () => {
    // Entered 15:40 UTC for a 16:00 UTC slot. Confirmed anchor = 15:35 (already past).
    // Floor = entered + 5 min = 15:45 UTC → clamp wins.
    const entered = at("2026-06-14T15:40:00.000Z");
    expect(stageDeadline("confirmed", entered, slot).toISOString())
      .toBe(at("2026-06-14T15:45:00.000Z").toISOString());
  });
});

describe("stageDeadline (null-slot fallback)", () => {
  it("falls back to entered + per-stage limit when the slot can't be parsed", () => {
    const entered = at("2026-06-14T14:00:00.000Z");
    expect(stageDeadline("confirmed", entered, null).toISOString())
      .toBe(at("2026-06-14T14:05:00.000Z").toISOString());
    expect(stageDeadline("preparing", entered, null).toISOString())
      .toBe(at("2026-06-14T14:15:00.000Z").toISOString());
    expect(stageDeadline("out_for_delivery", entered, null).toISOString())
      .toBe(at("2026-06-14T14:10:00.000Z").toISOString());
    expect(stageDeadline("pending_approval", entered, null).toISOString())
      .toBe(at("2026-06-14T14:03:00.000Z").toISOString());
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
  it("renders the 🎯 line with a 12h Cairo time anchored to the slot", () => {
    // Slot 19:00 Cairo summer. preparing target = slot − 10 min = 18:50 Cairo = 6:50 PM.
    const slot = cairoSlotInstant("2026-06-14", "19:00")!;
    const entered = at("2026-06-14T12:00:00.000Z");
    expect(targetLine("preparing", entered, slot)).toBe("🎯 Out for delivery by 6:50 PM");
  });
  it("falls back to entered-relative when slot is null", () => {
    // 14:30 Cairo summer = 11:30 UTC; confirmed + 5 = 14:35 Cairo = 2:35 PM.
    expect(targetLine("confirmed", at("2026-06-14T11:30:00.000Z"), null))
      .toBe("🎯 Start preparing by 2:35 PM");
  });
});

describe("overdueMinutes", () => {
  it("is whole minutes past the deadline (0 if not past), slot-anchored", () => {
    const slot = cairoSlotInstant("2026-06-14", "16:00")!; // 13:00 UTC
    const entered = at("2026-06-14T10:00:00.000Z"); // floor far below anchor
    // out_for_delivery deadline = slot = 13:00 UTC.
    expect(overdueMinutes("out_for_delivery", entered, at("2026-06-14T13:04:30.000Z"), slot)).toBe(4);
    expect(overdueMinutes("out_for_delivery", entered, at("2026-06-14T12:59:00.000Z"), slot)).toBe(0);
  });
});

describe("overdueMinutesDisplay", () => {
  it("never reads 0 once breached — ceil with a floor of 1", () => {
    const entered = at("2026-06-14T14:00:00.000Z"); // confirmed null-slot deadline 14:05
    // 10s past the deadline → display 1, not 0.
    expect(overdueMinutesDisplay("confirmed", entered, at("2026-06-14T14:05:10.000Z"), null)).toBe(1);
    // 3m10s past → ceil to 4.
    expect(overdueMinutesDisplay("confirmed", entered, at("2026-06-14T14:08:10.000Z"), null)).toBe(4);
    // not past → 0.
    expect(overdueMinutesDisplay("confirmed", entered, at("2026-06-14T14:04:00.000Z"), null)).toBe(0);
  });
});

describe("shouldAlert", () => {
  // Slot hours away, placed early. Confirmed anchor = slot − 25 min.
  const farSlot = cairoSlotInstant("2026-06-14", "20:00")!; // 17:00 UTC → anchor 16:35 UTC
  const nearSlot = cairoSlotInstant("2026-06-14", "16:00")!; // 13:00 UTC → anchor 12:35 UTC

  it("REGRESSION: an advance order (slot hours away) is NOT breached though entered long ago", () => {
    // Placed at 10:00 UTC for a 20:00 Cairo (17:00 UTC) slot; now 14:00 UTC.
    expect(shouldAlert({
      status: "confirmed",
      stageEnteredAt: at("2026-06-14T10:00:00.000Z"),
      lastAlertedAt: null,
      now: at("2026-06-14T14:00:00.000Z"),
      slotInstant: farSlot,
    })).toBe(false);
  });

  it("alerts when the slot is imminent and the anchored deadline has passed", () => {
    // Confirmed anchor for the 16:00 slot = 12:35 UTC; now 13:00 UTC → breached.
    expect(shouldAlert({
      status: "confirmed",
      stageEnteredAt: at("2026-06-14T10:00:00.000Z"),
      lastAlertedAt: null,
      now: at("2026-06-14T13:00:00.000Z"),
      slotInstant: nearSlot,
    })).toBe(true);
  });

  it("does not alert before the (slot-anchored) deadline", () => {
    expect(shouldAlert({
      status: "confirmed",
      stageEnteredAt: at("2026-06-14T10:00:00.000Z"),
      lastAlertedAt: null,
      now: at("2026-06-14T12:30:00.000Z"),
      slotInstant: nearSlot,
    })).toBe(false);
  });

  it("suppresses a re-nag within 5 min of the last alert", () => {
    expect(shouldAlert({
      status: "confirmed",
      stageEnteredAt: at("2026-06-14T10:00:00.000Z"),
      lastAlertedAt: at("2026-06-14T13:00:00.000Z"),
      now: at("2026-06-14T13:02:00.000Z"),
      slotInstant: nearSlot,
    })).toBe(false);
  });

  it("re-nags once 5 min have passed since the last alert", () => {
    expect(shouldAlert({
      status: "confirmed",
      stageEnteredAt: at("2026-06-14T10:00:00.000Z"),
      lastAlertedAt: at("2026-06-14T13:00:00.000Z"),
      now: at("2026-06-14T13:06:00.000Z"),
      slotInstant: nearSlot,
    })).toBe(true);
  });

  it("treats a lastAlertedAt older than the stage as a new stage (alerts)", () => {
    expect(shouldAlert({
      status: "confirmed",
      stageEnteredAt: at("2026-06-14T12:50:00.000Z"),
      lastAlertedAt: at("2026-06-14T12:40:00.000Z"),
      now: at("2026-06-14T13:00:00.000Z"),
      slotInstant: nearSlot,
    })).toBe(true);
  });

  it("uses the null-slot fallback when slotInstant is null", () => {
    const entered = at("2026-06-14T14:00:00.000Z"); // confirmed fallback deadline 14:05
    expect(shouldAlert({ status: "confirmed", stageEnteredAt: entered, lastAlertedAt: null, now: at("2026-06-14T14:04:00.000Z"), slotInstant: null })).toBe(false);
    expect(shouldAlert({ status: "confirmed", stageEnteredAt: entered, lastAlertedAt: null, now: at("2026-06-14T14:06:00.000Z"), slotInstant: null })).toBe(true);
  });

  it("never alerts for a terminal status", () => {
    expect(shouldAlert({
      status: "delivered" as any,
      stageEnteredAt: at("2026-06-14T10:00:00.000Z"),
      lastAlertedAt: null,
      now: at("2026-06-14T20:00:00.000Z"),
      slotInstant: nearSlot,
    })).toBe(false);
  });
});

describe("withinOperatingHours", () => {
  it("is true at 16:00 Cairo and false at 03:00 Cairo", () => {
    expect(withinOperatingHours(at("2026-06-14T16:00:00+02:00"))).toBe(true);
    expect(withinOperatingHours(at("2026-06-14T03:00:00+02:00"))).toBe(false);
  });
});
