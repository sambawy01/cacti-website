# Telegram SLA Timers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a per-stage deadline on every Telegram order ticket and auto-escalate to the sales group when a stage runs over its time limit, driven by a 1-minute Vercel Cron.

**Architecture:** A pure, fully-unit-tested SLA engine (`vercel-app/src/lib/sla.ts`) computes deadlines and decides when to alert. A new cron endpoint (`/api/cron/sla-check`) runs every minute (Vercel Cron, Pro plan), reads today's active orders from Apps Script, and posts self-contained actionable breach alerts. Two new Orders-sheet columns (`status_changed_at`, `sla_alerted_at`) persist the deadline anchor + throttle marker; Apps Script writes them on order creation and every status transition.

**Tech Stack:** TypeScript, Next.js (Vercel serverless + Cron), Vitest, Google Apps Script (`.gs`).

**Spec:** `docs/superpowers/specs/2026-06-14-telegram-sla-timers-design.md`

**Repo note:** repo root = website (Vite SPA); `vercel-app/` = the Next.js backend (its own `package.json`, Vitest); `apps-script/` = the Google Apps Script (NOT unit-tested here — verified by `clasp` deploy + `curl`). Run vercel tests with `cd vercel-app && ...`.

**Status vocabulary (existing `OrderStatus`):** `pending_approval | confirmed | preparing | out_for_delivery | delivered | declined | cancelled`. The four **active** (SLA-tracked) statuses are `pending_approval`, `confirmed`, `preparing`, `out_for_delivery`.

---

## Task 1: Pure SLA engine (`sla.ts`)

**Files:**
- Create: `vercel-app/src/lib/sla.ts`
- Test: `vercel-app/src/lib/sla.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `vercel-app/src/lib/sla.test.ts`:

```ts
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
    expect(targetLine("confirmed", at("2026-06-14T14:30:00+02:00")))
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
```

- [ ] **Step 2: Run, verify it fails**

Run: `cd vercel-app && npx vitest run src/lib/sla.test.ts`
Expected: FAIL — `./sla` cannot be resolved.

- [ ] **Step 3: Implement `sla.ts`**

Create `vercel-app/src/lib/sla.ts`:

```ts
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
```

Note on the `withinOperatingHours` hour parse: `hour: "2-digit", hour12: false` yields "00".."23"; `Number("03")` → 3. (Some runtimes render midnight as "24" — not relevant here since CLOSE_HOUR is 23.)

- [ ] **Step 4: Run, verify it passes**

Run: `cd vercel-app && npx vitest run src/lib/sla.test.ts`
Expected: PASS (all describes).

- [ ] **Step 5: Commit**

```bash
git add vercel-app/src/lib/sla.ts vercel-app/src/lib/sla.test.ts
git commit -m "feat(sla): pure SLA engine — deadlines, target line, shouldAlert, hours gate"
```

---

## Task 2: Ticket target line + breach-alert message builders

**Files:**
- Modify: `vercel-app/src/lib/orderMessage.ts`
- Test: `vercel-app/src/lib/orderMessage.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `vercel-app/src/lib/orderMessage.test.ts` (import `buildOrderMessage`, `buildSlaAlertMessage` from `./orderMessage`; if the file doesn't exist, create it with these tests):

```ts
import { describe, it, expect } from "vitest";
import { buildOrderMessage, buildSlaAlertMessage } from "./orderMessage";

const baseOrder = {
  name: "Sara Ali", phone: "+201001234567", email: "sara@example.com",
  address: "12 West Golf", orderSummary: "2x Grilled Chicken", orderTotal: 400,
  itemCount: 2, deliverySlot: "14:30", paymentMethod: "cod" as const, trackingToken: "tok-1",
};

describe("buildOrderMessage target line", () => {
  it("includes a 🎯 target line for a confirmed order", () => {
    const msg = buildOrderMessage({ ...baseOrder, status: "confirmed" });
    expect(msg).toContain("🎯 Start preparing by");
  });
  it("includes an approval 🎯 target line for a pending_approval order", () => {
    const msg = buildOrderMessage({ ...baseOrder, status: "pending_approval" });
    expect(msg).toContain("🎯 Approve/decline by");
  });
});

describe("buildSlaAlertMessage", () => {
  it("names the order, customer, late stage, overdue + target minutes", () => {
    const msg = buildSlaAlertMessage({
      id: 123, name: "Sara Ali", phone: "+201001234567",
      status: "pending_approval", overdueMin: 4, limitMin: 3,
    });
    expect(msg).toContain("OVERDUE");
    expect(msg).toContain("#123");
    expect(msg).toContain("Sara Ali");
    expect(msg).toContain("Approve/decline");
    expect(msg).toContain("4 min late");
    expect(msg).toContain("target 3 min");
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `cd vercel-app && npx vitest run src/lib/orderMessage.test.ts`
Expected: FAIL — `buildSlaAlertMessage` is not exported and `buildOrderMessage` has no 🎯 line.

- [ ] **Step 3: Implement**

In `vercel-app/src/lib/orderMessage.ts`:

(a) Add the import at the top (alongside the existing imports):
```ts
import { isActiveStatus, stageActionLabel, targetLine } from "./sla";
```

(b) In `buildOrderMessage`, before the final `return lines.join("\n");`, append the target line for active statuses:
```ts
  if (isActiveStatus(o.status)) {
    lines.push("", targetLine(o.status, new Date()));
  }
```

(c) Add the alert builder at the end of the file:
```ts
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
  return [
    `⏰ OVERDUE — Order #${o.id}`,
    `👤 ${o.name}  ·  ${o.phone}`,
    `"${stageActionLabel(o.status)}" is ${o.overdueMin} min late (target ${o.limitMin} min)`,
    "👇 tap to act",
  ].join("\n");
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `cd vercel-app && npx vitest run src/lib/orderMessage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add vercel-app/src/lib/orderMessage.ts vercel-app/src/lib/orderMessage.test.ts
git commit -m "feat(sla): ticket 🎯 target line + actionable breach-alert message"
```

---

## Task 3: Apps Script client — `slaListActiveOrders` + `markSlaAlerted`

**Files:**
- Modify: `vercel-app/src/lib/appsScript.ts`
- Test: `vercel-app/src/lib/appsScript.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `vercel-app/src/lib/appsScript.test.ts` (import `slaListActiveOrders`, `markSlaAlerted`):

```ts
describe("slaListActiveOrders", () => {
  it("GETs the admin-gated action and returns the orders array", async () => {
    process.env.APPS_SCRIPT_URL = "https://script.test/exec";
    process.env.APPS_SCRIPT_ADMIN_PASSWORD = "pw";
    const spy = vi.fn(async () => new Response(JSON.stringify({ success: true, orders: [{ tracking_token: "t1" }] }), { status: 200 }));
    globalThis.fetch = spy as unknown as typeof fetch;
    const r = await slaListActiveOrders();
    expect(r.success).toBe(true);
    expect(r.orders?.[0].tracking_token).toBe("t1");
    const url = (spy.mock.calls[0] as any)[0] as string;
    expect(url).toContain("action=slaListActiveOrders");
    expect(url).toContain("password=pw");
  });
});

describe("markSlaAlerted", () => {
  it("GETs the admin-gated action with the token", async () => {
    process.env.APPS_SCRIPT_URL = "https://script.test/exec";
    process.env.APPS_SCRIPT_ADMIN_PASSWORD = "pw";
    const spy = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    globalThis.fetch = spy as unknown as typeof fetch;
    const r = await markSlaAlerted("tok-9");
    expect(r.success).toBe(true);
    const url = (spy.mock.calls[0] as any)[0] as string;
    expect(url).toContain("action=markSlaAlerted");
    expect(url).toContain("token=tok-9");
  });
});
```

If `appsScript.test.ts` doesn't already set up `vi`/`fetch` mocking and restore, mirror the existing pattern in that file (check its top for `beforeEach`/`afterEach` and `vi` import). If the file does not exist, create it importing `{ describe, it, expect, vi, afterEach } from "vitest"` and restore `globalThis.fetch` in `afterEach`.

- [ ] **Step 2: Run, verify it fails**

Run: `cd vercel-app && npx vitest run src/lib/appsScript.test.ts -t "sla"`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement**

Append to `vercel-app/src/lib/appsScript.ts`:

```ts
export interface SlaActiveOrder {
  id: number | string;
  tracking_token: string;
  status: string;
  status_changed_at: string; // ISO; Apps Script falls back to creation timestamp
  sla_alerted_at: string;     // ISO or "" (never alerted)
  name: string;
  phone: string;
  delivery_slot: string;
  order_summary: string;
}

/** Today's (Cairo) active orders with the fields the SLA cron needs. Admin-gated. */
export async function slaListActiveOrders(): Promise<{ success: boolean; orders?: SlaActiveOrder[]; error?: string }> {
  const password = process.env.APPS_SCRIPT_ADMIN_PASSWORD;
  if (!password) throw new Error("APPS_SCRIPT_ADMIN_PASSWORD is not configured");
  return appsScriptGet({ action: "slaListActiveOrders", password });
}

/** Record that an SLA breach alert was just sent for this order. Admin-gated. */
export async function markSlaAlerted(token: string): Promise<{ success: boolean; error?: string }> {
  const password = process.env.APPS_SCRIPT_ADMIN_PASSWORD;
  if (!password) throw new Error("APPS_SCRIPT_ADMIN_PASSWORD is not configured");
  return appsScriptGet({ action: "markSlaAlerted", password, token });
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `cd vercel-app && npx vitest run src/lib/appsScript.test.ts`
Expected: PASS (whole file).

- [ ] **Step 5: Commit**

```bash
git add vercel-app/src/lib/appsScript.ts vercel-app/src/lib/appsScript.test.ts
git commit -m "feat(sla): appsScript client for slaListActiveOrders + markSlaAlerted"
```

---

## Task 4: Cron endpoint `/api/cron/sla-check`

**Files:**
- Create: `vercel-app/src/app/api/cron/sla-check/route.ts`
- Test: `vercel-app/src/app/api/cron/sla-check/route.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `vercel-app/src/app/api/cron/sla-check/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/server", () => ({ NextResponse: { json: (b: unknown, i?: { status?: number }) => new Response(JSON.stringify(b), { status: i?.status ?? 200 }) } }));
vi.mock("@/lib/appsScript", () => ({ slaListActiveOrders: vi.fn(), markSlaAlerted: vi.fn(async () => ({ success: true })) }));
vi.mock("@/lib/telegram", () => ({ telegramConfigured: vi.fn(() => true), sendMessage: vi.fn(async () => ({ ok: true, status: 200 })) }));

import { GET } from "./route";
import { slaListActiveOrders, markSlaAlerted } from "@/lib/appsScript";
import { sendMessage } from "@/lib/telegram";

const SECRET = "cron-secret";
function req(auth?: string): Request {
  const headers: Record<string, string> = {};
  if (auth) headers.authorization = auth;
  return new Request("https://app.test/api/cron/sla-check", { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  // Cairo 16:00 (open). 14:00 UTC == 16:00 Cairo.
  vi.setSystemTime(new Date("2026-06-14T14:00:00.000Z"));
  process.env.CRON_SECRET = SECRET;
  process.env.TELEGRAM_OWNER_CHAT_ID = "999";
  (slaListActiveOrders as any).mockResolvedValue({ success: true, orders: [] });
});
afterEach(() => { vi.useRealTimers(); });

it("rejects a missing/wrong CRON_SECRET with 401", async () => {
  expect((await GET(req())).status).toBe(401);
  expect((await GET(req("Bearer nope"))).status).toBe(401);
  expect(slaListActiveOrders).not.toHaveBeenCalled();
});

it("skips work outside operating hours", async () => {
  vi.setSystemTime(new Date("2026-06-14T01:00:00.000Z")); // 03:00 Cairo (closed)
  const res = await GET(req(`Bearer ${SECRET}`));
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, skipped: "closed" });
  expect(slaListActiveOrders).not.toHaveBeenCalled();
});

it("alerts only breached orders and marks them", async () => {
  // confirmed entered 15:50 Cairo (deadline 15:55) → breached at 16:00.
  // preparing entered 15:58 Cairo (deadline 16:13) → not breached.
  (slaListActiveOrders as any).mockResolvedValue({ success: true, orders: [
    { id: 1, tracking_token: "t-breach", status: "confirmed", status_changed_at: "2026-06-14T13:50:00.000Z", sla_alerted_at: "", name: "A", phone: "p", delivery_slot: "16:00", order_summary: "x" },
    { id: 2, tracking_token: "t-ok", status: "preparing", status_changed_at: "2026-06-14T13:58:00.000Z", sla_alerted_at: "", name: "B", phone: "p", delivery_slot: "16:30", order_summary: "y" },
  ]});
  const res = await GET(req(`Bearer ${SECRET}`));
  expect(res.status).toBe(200);
  expect(sendMessage).toHaveBeenCalledOnce();
  expect((sendMessage as any).mock.calls[0][0]).toBe("999");
  expect((sendMessage as any).mock.calls[0][1]).toContain("OVERDUE");
  expect(markSlaAlerted).toHaveBeenCalledWith("t-breach");
  expect(markSlaAlerted).not.toHaveBeenCalledWith("t-ok");
});

it("is non-fatal when one order's send throws — still 200, still marks others", async () => {
  (slaListActiveOrders as any).mockResolvedValue({ success: true, orders: [
    { id: 1, tracking_token: "t1", status: "confirmed", status_changed_at: "2026-06-14T13:50:00.000Z", sla_alerted_at: "", name: "A", phone: "p", delivery_slot: "16:00", order_summary: "x" },
  ]});
  (sendMessage as any).mockRejectedValue(new Error("telegram down"));
  const res = await GET(req(`Bearer ${SECRET}`));
  expect(res.status).toBe(200);
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `cd vercel-app && npx vitest run src/app/api/cron/sla-check/route.test.ts`
Expected: FAIL — `./route` does not exist.

- [ ] **Step 3: Implement the endpoint**

Create `vercel-app/src/app/api/cron/sla-check/route.ts`:

```ts
import { NextResponse } from "next/server";
import { slaListActiveOrders, markSlaAlerted, type SlaActiveOrder } from "@/lib/appsScript";
import { sendMessage } from "@/lib/telegram";
import { buildSlaAlertMessage, keyboardForStatus } from "@/lib/orderMessage";
import {
  isActiveStatus, shouldAlert, overdueMinutes, STAGE_LIMITS_MIN, withinOperatingHours, type ActiveStatus,
} from "@/lib/sla";
import type { OrderStatus } from "@/lib/appsScript";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
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
    if (!shouldAlert({ status: o.status, stageEnteredAt, lastAlertedAt, now })) continue;

    const status = o.status as ActiveStatus;
    const text = buildSlaAlertMessage({
      id: o.id, name: o.name, phone: o.phone, status,
      overdueMin: overdueMinutes(status, stageEnteredAt, now),
      limitMin: STAGE_LIMITS_MIN[status],
    });
    try {
      if (chatId) await sendMessage(chatId, text, keyboardForStatus(o.status as OrderStatus, o.tracking_token));
      await markSlaAlerted(o.tracking_token);
      alerted += 1;
    } catch (err) {
      console.error("[sla-check] alert failed for", o.tracking_token, err);
    }
  }
  return NextResponse.json({ ok: true, checked: list.orders.length, alerted });
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `cd vercel-app && npx vitest run src/app/api/cron/sla-check/route.test.ts`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Commit**

```bash
git add vercel-app/src/app/api/cron/sla-check/
git commit -m "feat(sla): /api/cron/sla-check — auth, hours gate, breach alerts"
```

---

## Task 5: Update the ticket target line on status transitions (webhook)

**Files:**
- Modify: `vercel-app/src/app/api/telegram/webhook/route.ts:294-298`
- Test: `vercel-app/src/app/api/telegram/webhook/route.test.ts`

- [ ] **Step 1: Write the failing test**

In `vercel-app/src/app/api/telegram/webhook/route.test.ts`, find the test that asserts a status advance edits the message (the one around `editMessageText` for e.g. a `preparing` tap). Add an assertion that the edited text contains a refreshed target line. Add this new test near the existing status-advance tests:

```ts
it("a 'preparing' advance refreshes the 🎯 target line on the ticket", async () => {
  // getOrderStatus mock returns status confirmed; the tap moves it to preparing.
  (setOrderStatusByToken as any).mockResolvedValue({ success: true, status: "preparing", previousStatus: "confirmed" });
  await POST(req(update("preparing:tok-p")));
  const editText = (editMessageText as any).mock.calls[0][2] as string;
  expect(editText).toContain("🎯 Out for delivery by");
  // the old confirmed-stage target line must not linger
  expect(editText).not.toContain("Start preparing by");
});
```

If the existing webhook test's `update(...)` helper sets `message.text`, ensure this test's prior text could contain an old 🎯 line; if not, this still verifies the new line is appended and no stale `Start preparing` line remains. (The `editMessageText` mock already exists in this file.)

- [ ] **Step 2: Run, verify it fails**

Run: `cd vercel-app && npx vitest run src/app/api/telegram/webhook/route.test.ts -t "target line"`
Expected: FAIL — the edited text has no 🎯 line.

- [ ] **Step 3: Implement**

In `vercel-app/src/app/api/telegram/webhook/route.ts`:

(a) Extend the `@/lib/sla` usage — add this import near the other `@/lib/...` imports at the top of the file:
```ts
import { isActiveStatus, targetLine } from "@/lib/sla";
```

(b) Replace the status-edit block (currently lines ~296-298):
```ts
      const original = cb.message.text || "Order";
      await editMessageText(cb.message.chat.id, cb.message.message_id, `${original}\n\n— ${STATUS_LABEL[status] || status}`, keyboardForStatus(status, token));
```
with a version that strips any prior 🎯 line and appends the new stage's target (active statuses only):
```ts
      const base = (cb.message.text || "Order")
        .split("\n")
        .filter((line) => !line.startsWith("🎯"))
        .join("\n")
        .replace(/\n+$/, "");
      const tgt = isActiveStatus(status) ? `\n${targetLine(status, new Date())}` : "";
      await editMessageText(
        cb.message.chat.id,
        cb.message.message_id,
        `${base}\n\n— ${STATUS_LABEL[status] || status}${tgt}`,
        keyboardForStatus(status, token),
      );
```

- [ ] **Step 4: Run, verify it passes (and the whole webhook file is green)**

Run: `cd vercel-app && npx vitest run src/app/api/telegram/webhook/route.test.ts`
Expected: PASS (new test + all existing).

- [ ] **Step 5: Commit**

```bash
git add vercel-app/src/app/api/telegram/webhook/route.ts vercel-app/src/app/api/telegram/webhook/route.test.ts
git commit -m "feat(sla): refresh the 🎯 target line when a ticket advances stage"
```

---

## Task 6: Register the Vercel Cron

**Files:**
- Create: `vercel-app/vercel.json`

- [ ] **Step 1: Create `vercel-app/vercel.json`**

```json
{
  "crons": [
    { "path": "/api/cron/sla-check", "schedule": "* * * * *" }
  ]
}
```

- [ ] **Step 2: Validate it parses**

Run: `cd vercel-app && node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8')); console.log('vercel.json OK')"`
Expected: `vercel.json OK`

- [ ] **Step 3: Confirm the cron path resolves to the endpoint**

The cron `path` `/api/cron/sla-check` must match the route created in Task 4 (`src/app/api/cron/sla-check/route.ts`). No code change — just verify the directory exists:
Run: `ls vercel-app/src/app/api/cron/sla-check/route.ts`
Expected: the file is listed.

- [ ] **Step 4: Commit**

```bash
git add vercel-app/vercel.json
git commit -m "feat(sla): register 1-minute Vercel Cron for /api/cron/sla-check"
```

---

## Task 7: Apps Script — timestamp columns + new actions

**Files:**
- Modify: `apps-script/admin-api.gs`

> Apps Script runs in Google's environment and is NOT unit-tested in this repo. Make the exact edits below, then verify by `clasp` deploy + `curl` in Task 8. Read each target line in the current file before editing (line numbers drift).

- [ ] **Step 1: Add the two columns to the Orders schema**

Find `CRM_TABS` (the `Orders:` array near line 474). Append the two new columns to the Orders array so it ends:
```js
  Orders:   ['id', 'timestamp', 'name', 'phone', 'email', 'delivery_area', 'address', 'order_total', 'order_summary', 'item_count', 'delivery_date', 'delivery_slot', 'tracking_token', 'status', 'notes', 'status_changed_at', 'sla_alerted_at'],
```
(`migrateOrdersTab` reads `CRM_TABS.Orders`, so it will add these headers automatically.)

- [ ] **Step 2: Treat the new columns as text in migration**

In `migrateOrdersTab` (near line 576), add the two new columns to the `textCols` array so ISO timestamps are stored as plain text (not coerced to Sheets dates):
```js
  var textCols = ['delivery_date', 'delivery_slot', 'tracking_token', 'status_changed_at', 'sla_alerted_at'];
```

- [ ] **Step 3: Write the columns at order creation**

In `orderPlace`, in the `crmAppendRow('Orders', { ... })` call (near line 720), add two fields after `status: outcome,` (and before/after `notes`):
```js
      status_changed_at: ts,
      sla_alerted_at: '',
```
(`ts` is the creation `new Date().toISOString()` already computed above.)

- [ ] **Step 4: Stamp `status_changed_at` on every transition**

In `orderSetStatus` (near line 1120), right after the line that writes the new status:
```js
  sheet.getRange(rowIndex, statusCol + 1).setValue(newStatus);
```
add:
```js
  var scaCol = headers.indexOf('status_changed_at');
  if (scaCol >= 0) {
    var scaCell = sheet.getRange(rowIndex, scaCol + 1);
    scaCell.setNumberFormat('@');
    scaCell.setValue(new Date().toISOString());
  }
```
(`orderSetStatusByToken` delegates to `orderSetStatus`, so this single edit covers both the admin panel and the Telegram webhook paths.)

- [ ] **Step 5: Add the `slaListActiveOrders` and `markSlaAlerted` functions**

Add these two functions (place them just after `orderSetStatusByToken`, near line 1193):
```js
/**
 * Today's (Cairo) active orders for the SLA cron. Active = pending_approval,
 * confirmed, preparing, out_for_delivery. status_changed_at falls back to the
 * creation timestamp for rows that predate the column.
 */
function slaListActiveOrders() {
  var active = { pending_approval: 1, confirmed: 1, preparing: 1, out_for_delivery: 1 };
  var today = cairoToday();
  var rows = crmReadRows('Orders');
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!active[String(r.status)]) continue;
    if (normalizeDateString(r.delivery_date) !== today) continue;
    out.push({
      id: r.id,
      tracking_token: String(r.tracking_token || ''),
      status: String(r.status),
      status_changed_at: String(r.status_changed_at || r.timestamp || ''),
      sla_alerted_at: String(r.sla_alerted_at || ''),
      name: String(r.name || ''),
      phone: String(r.phone || ''),
      delivery_slot: normalizeSlotString(r.delivery_slot),
      order_summary: String(r.order_summary || ''),
    });
  }
  return { success: true, orders: out };
}

/** Record the time of the latest SLA breach alert for an order (by token). */
function markSlaAlerted(token) {
  if (!token) return { success: false, error: 'Missing token' };
  var sheet = crmGetSheet('Orders');
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol === 0) return { success: false, error: 'No orders' };
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
    return String(h).trim().toLowerCase().replace(/ /g, '_');
  });
  var tokCol = headers.indexOf('tracking_token');
  var alertCol = headers.indexOf('sla_alerted_at');
  if (tokCol < 0 || alertCol < 0) return { success: false, error: 'Columns missing — run migrateOrdersTab' };
  var tokens = sheet.getRange(2, tokCol + 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < tokens.length; i++) {
    if (String(tokens[i][0]) === String(token)) {
      var cell = sheet.getRange(i + 2, alertCol + 1);
      cell.setNumberFormat('@');
      cell.setValue(new Date().toISOString());
      return { success: true };
    }
  }
  return { success: false, error: 'Order not found' };
}
```

- [ ] **Step 6: Route the two new admin actions**

In the admin `switch (action)` block, add two cases next to `setOrderStatusByToken` (near line 151):
```js
      case 'slaListActiveOrders':
        return jsonpResponse(callback, slaListActiveOrders());
      case 'markSlaAlerted':
        return jsonpResponse(callback, markSlaAlerted(params.token));
```

- [ ] **Step 7: Commit (deploy happens in Task 8)**

```bash
git add apps-script/admin-api.gs
git commit -m "feat(sla): Orders status_changed_at + sla_alerted_at, slaListActiveOrders, markSlaAlerted"
```

---

## Task 8: Full verification + staged deploy

**Files:** none (verification + deploy; deploy steps need explicit owner approval)

- [ ] **Step 1: Full Vercel suite + type-check**

Run: `cd vercel-app && npm test`
Expected: all tests pass (previous baseline 131 + the new sla/orderMessage/appsScript/cron/webhook tests).
Run: `cd vercel-app && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Deploy Apps Script FIRST (columns + actions must exist before the cron reads them)**

From `apps-script/` (needs owner approval):
```bash
clasp push --force
clasp deploy -i AKfycbzN-s2iKeyjIC_k-wyNzj6QHOO5eoW14EqWo7fC4kYzYzqyMOygZpCDPpyqPVxhFA --description "V27: SLA timestamps + slaListActiveOrders/markSlaAlerted"
```
Then run `migrateOrdersTab` ONCE from the Apps Script editor (adds the two columns to the live sheet).
Verify the new read action works (replace `<APPS_SCRIPT_URL>`/`<PW>`):
```bash
curl -sL '<APPS_SCRIPT_URL>?action=slaListActiveOrders&password=<PW>' | head -c 400
```
Expected: `{"success":true,"orders":[...]}` (orders may be empty if none active today).

- [ ] **Step 3: Set `CRON_SECRET` in Vercel**

```bash
cd vercel-app && vercel env add CRON_SECRET production
```
(Enter a strong random value. Vercel injects `Authorization: Bearer <CRON_SECRET>` on cron invocations.)

- [ ] **Step 4: Deploy Vercel (registers the cron from vercel.json)**

Run (needs owner approval): `cd vercel-app && vercel --prod --yes`
Then sanity-check auth on the endpoint:
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://bistro-cloud-orders.vercel.app/api/cron/sla-check
```
Expected: `401` (no secret). With the secret header it should return `{"ok":true,...}`.

- [ ] **Step 5: Live verification**

During open hours, place a test order and leave it unactioned past its stage limit (or temporarily set an old `status_changed_at` on a test row). Confirm an `⏰ OVERDUE` alert with working buttons appears in the sales group within ~1–2 min, that tapping a button advances the order, and that a fresh order shows a `🎯` target line on its ticket. Confirm no overnight alerts (the hours gate). Refund/ignore any Loyverse test receipts.

- [ ] **Step 6: Clean tree**

Run: `git status` → expected clean (all task commits made). Update the batch memory note (sub-project B → built/in-PR).

---

## Self-Review (completed by plan author)

- **Spec coverage:** Scheduler/endpoint → Tasks 4, 6. Auth + hours gate → Tasks 1 (`withinOperatingHours`), 4. SLA model/config + engine → Task 1. Schema (`status_changed_at`, `sla_alerted_at`, migration, creation + transition writes, fallback) → Task 7. `slaListActiveOrders` read → Tasks 3 (client) + 7 (server). On-ticket target line (initial + transition) → Tasks 2 (`buildOrderMessage`) + 5 (webhook). Breach alert + re-nag (self-contained, actionable, 5-min throttle, stage-reset) → Tasks 1 (`shouldAlert`) + 2 (`buildSlaAlertMessage`) + 4. Testing → Tasks 1–5. Rollout (Apps Script first, CRON_SECRET, Vercel) → Task 8. All spec sections mapped. ✓
- **Placeholder scan:** No TBD/TODO; every code step shows full code. ✓
- **Type consistency:** `ActiveStatus`, `SLA_ACTIVE_STATUSES`, `STAGE_LIMITS_MIN`, `isActiveStatus`, `stageDeadline`, `stageActionLabel`, `targetLine`, `overdueMinutes`, `shouldAlert`, `withinOperatingHours` defined in Task 1 and reused with identical signatures in Tasks 2/4/5. `SlaActiveOrder` defined in Task 3, consumed in Task 4. `buildSlaAlertMessage`/`SlaAlertInput` defined in Task 2, used in Task 4. Apps Script action names `slaListActiveOrders`/`markSlaAlerted` match between Task 3 (client) and Task 7 (server). ✓
