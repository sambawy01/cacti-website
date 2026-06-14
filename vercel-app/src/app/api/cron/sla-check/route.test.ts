import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/server", () => ({ NextResponse: { json: (b: unknown, i?: { status?: number }) => new Response(JSON.stringify(b), { status: i?.status ?? 200 }) } }));
vi.mock("@/lib/appsScript", () => ({ slaListActiveOrders: vi.fn(), markSlaAlerted: vi.fn(async () => ({ success: true })) }));
vi.mock("@/lib/telegram", () => ({ telegramConfigured: vi.fn(() => true), sendMessage: vi.fn(async () => ({ ok: true, status: 200 })) }));

// Stateful owner-DM mocks. mockState is read-modify-written by the marker stubs
// so the pending-reminder cooldown can be exercised across two GET() calls in a
// single test. Default ownerChatId is null so the EXISTING group-alert tests see
// no owner and keep their single-sendMessage assertions unchanged.
const mockState = { ownerChatId: null as number | null, pendingRemindedAt: null as number | null };
vi.mock("@/lib/assistant/state", () => ({
  getOwnerChatId: vi.fn(async () => mockState.ownerChatId),
  getPendingRemindedAt: vi.fn(async () => mockState.pendingRemindedAt),
  markPendingReminded: vi.fn(async (at: number) => { mockState.pendingRemindedAt = at; }),
  PENDING_REMINDER_COOLDOWN_MS: 60 * 60 * 1000,
}));

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
  // Cairo 16:00 (open). 14:00 UTC == 16:00 Cairo (EEST, June).
  vi.setSystemTime(new Date("2026-06-14T14:00:00.000Z"));
  process.env.CRON_SECRET = SECRET;
  process.env.TELEGRAM_OWNER_CHAT_ID = "999";
  mockState.ownerChatId = null;
  mockState.pendingRemindedAt = null;
  (slaListActiveOrders as any).mockResolvedValue({ success: true, orders: [] });
  (markSlaAlerted as any).mockResolvedValue({ success: true });
  // clearAllMocks clears call data but NOT implementations/mockResolvedValue,
  // so reset the send default each test to avoid leaking a prior ok:false.
  (sendMessage as any).mockResolvedValue({ ok: true, status: 200 });
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

it("alerts a slot-imminent order and marks it; leaves a far-slot order alone", async () => {
  // Both confirmed, entered the same time. now = 14:00 UTC (16:00 Cairo).
  //  - t-breach: slot 16:00 Cairo (13:00 UTC) → confirmed anchor 12:35 UTC → breached.
  //  - t-ok:     slot 16:30 Cairo (13:30 UTC) → preparing anchor 13:20 UTC,
  //              floor = entered 13:58 + 15 = 14:13 UTC → not breached at 14:00.
  (slaListActiveOrders as any).mockResolvedValue({ success: true, orders: [
    { id: 1, tracking_token: "t-breach", status: "confirmed", status_changed_at: "2026-06-14T13:50:00.000Z", sla_alerted_at: "", name: "A", phone: "p", delivery_date: "2026-06-14", delivery_slot: "16:00", order_summary: "x" },
    { id: 2, tracking_token: "t-ok", status: "preparing", status_changed_at: "2026-06-14T13:58:00.000Z", sla_alerted_at: "", name: "B", phone: "p", delivery_date: "2026-06-14", delivery_slot: "16:30", order_summary: "y" },
  ]});
  const res = await GET(req(`Bearer ${SECRET}`));
  expect(res.status).toBe(200);
  expect(sendMessage).toHaveBeenCalledOnce();
  expect((sendMessage as any).mock.calls[0][0]).toBe("999");
  expect((sendMessage as any).mock.calls[0][1]).toContain("OVERDUE");
  expect(markSlaAlerted).toHaveBeenCalledWith("t-breach");
  expect(markSlaAlerted).not.toHaveBeenCalledWith("t-ok");
});

it("REGRESSION: an advance order (placed early, slot hours away) is NOT breached", async () => {
  // Entered 10:00 UTC (placed early) for a 20:00 Cairo (17:00 UTC) slot.
  // Confirmed anchor = 17:00 − 25 min = 16:35 UTC; now = 14:00 UTC → NOT due.
  // The OLD entered-relative engine would have breached this for ~4 hours.
  (slaListActiveOrders as any).mockResolvedValue({ success: true, orders: [
    { id: 99, tracking_token: "t-advance", status: "confirmed", status_changed_at: "2026-06-14T10:00:00.000Z", sla_alerted_at: "", name: "C", phone: "p", delivery_date: "2026-06-14", delivery_slot: "20:00", order_summary: "z" },
  ]});
  const res = await GET(req(`Bearer ${SECRET}`));
  expect(res.status).toBe(200);
  expect(sendMessage).not.toHaveBeenCalled();
  expect(markSlaAlerted).not.toHaveBeenCalled();
  expect(await res.json()).toMatchObject({ ok: true, alerted: 0 });
});

it("falls back to the entered-relative deadline when the slot can't be parsed", async () => {
  // No usable slot → confirmed fallback deadline = entered 13:50 + 5 = 13:55 UTC; now 14:00 → breached.
  (slaListActiveOrders as any).mockResolvedValue({ success: true, orders: [
    { id: 5, tracking_token: "t-noslot", status: "confirmed", status_changed_at: "2026-06-14T13:50:00.000Z", sla_alerted_at: "", name: "A", phone: "p", delivery_date: "", delivery_slot: "", order_summary: "x" },
  ]});
  const res = await GET(req(`Bearer ${SECRET}`));
  expect(res.status).toBe(200);
  expect(sendMessage).toHaveBeenCalledOnce();
  expect(markSlaAlerted).toHaveBeenCalledWith("t-noslot");
});

it("is non-fatal when one order's send throws — still 200", async () => {
  (slaListActiveOrders as any).mockResolvedValue({ success: true, orders: [
    { id: 1, tracking_token: "t1", status: "confirmed", status_changed_at: "2026-06-14T13:50:00.000Z", sla_alerted_at: "", name: "A", phone: "p", delivery_date: "2026-06-14", delivery_slot: "16:00", order_summary: "x" },
  ]});
  (sendMessage as any).mockRejectedValue(new Error("telegram down"));
  const res = await GET(req(`Bearer ${SECRET}`));
  expect(res.status).toBe(200);
});

it("does NOT mark when Telegram rejects (ok:false 429) — retries next run", async () => {
  (slaListActiveOrders as any).mockResolvedValue({ success: true, orders: [
    { id: 1, tracking_token: "t-breach", status: "confirmed", status_changed_at: "2026-06-14T13:50:00.000Z", sla_alerted_at: "", name: "A", phone: "p", delivery_date: "2026-06-14", delivery_slot: "16:00", order_summary: "x" },
  ]});
  (sendMessage as any).mockResolvedValue({ ok: false, status: 429 });
  const res = await GET(req(`Bearer ${SECRET}`));
  expect(res.status).toBe(200);
  expect(sendMessage).toHaveBeenCalledOnce();
  expect(markSlaAlerted).not.toHaveBeenCalled();
  expect(await res.json()).toMatchObject({ ok: true, alerted: 0 });
});

it("a FAILED markSlaAlerted does not silently succeed — it logs and is not counted as alerted", async () => {
  (slaListActiveOrders as any).mockResolvedValue({ success: true, orders: [
    { id: 1, tracking_token: "t-breach", status: "confirmed", status_changed_at: "2026-06-14T13:50:00.000Z", sla_alerted_at: "", name: "A", phone: "p", delivery_date: "2026-06-14", delivery_slot: "16:00", order_summary: "x" },
  ]});
  (markSlaAlerted as any).mockResolvedValue({ success: false, error: "Columns missing" });
  const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const res = await GET(req(`Bearer ${SECRET}`));
  expect(res.status).toBe(200);
  expect(sendMessage).toHaveBeenCalledOnce();
  expect(markSlaAlerted).toHaveBeenCalledWith("t-breach");
  // The write failed: it must be logged and NOT counted as a (throttled) alert,
  // so it retries next run rather than silently going un-throttled.
  expect(errSpy).toHaveBeenCalled();
  expect(await res.json()).toMatchObject({ ok: true, alerted: 0 });
  errSpy.mockRestore();
});

// ── 4b: owner-DM on breach + pending-approval reminder ──────────────────────

it("when an owner is bound: DMs the owner on a breach AND the group alert still fires", async () => {
  mockState.ownerChatId = 12345;
  (slaListActiveOrders as any).mockResolvedValue({ success: true, orders: [
    { id: 1, tracking_token: "t-breach", status: "confirmed", status_changed_at: "2026-06-14T13:50:00.000Z", sla_alerted_at: "", name: "A", phone: "p", delivery_date: "2026-06-14", delivery_slot: "16:00", order_summary: "x" },
  ]});
  const res = await GET(req(`Bearer ${SECRET}`));
  expect(res.status).toBe(200);
  const calls = (sendMessage as any).mock.calls as [string | number, string][];
  // Group alert UNCHANGED: still sent to the group chat with the OVERDUE text.
  const group = calls.find((c) => String(c[0]) === "999");
  expect(group).toBeTruthy();
  expect(group![1]).toContain("OVERDUE");
  // ALSO an owner DM about the breach.
  const ownerSla = calls.find((c) => String(c[0]) === "12345" && /SLA/.test(c[1]));
  expect(ownerSla).toBeTruthy();
  expect(ownerSla![1]).toContain("confirmed");
  expect(markSlaAlerted).toHaveBeenCalledWith("t-breach");
});

it("DMs the owner ONE pending-approval reminder and dedups it on an immediate second run", async () => {
  mockState.ownerChatId = 12345;
  // One breaching confirmed order + two pending_approval orders awaiting the owner.
  (slaListActiveOrders as any).mockResolvedValue({ success: true, orders: [
    { id: 1, tracking_token: "t-breach", status: "confirmed", status_changed_at: "2026-06-14T13:50:00.000Z", sla_alerted_at: "", name: "A", phone: "p", delivery_date: "2026-06-14", delivery_slot: "16:00", order_summary: "x" },
    { id: 2, tracking_token: "t-pa1", status: "pending_approval", status_changed_at: "2026-06-14T13:59:30.000Z", sla_alerted_at: "2026-06-14T13:59:40.000Z", name: "B", phone: "p", delivery_date: "2026-06-14", delivery_slot: "19:00", order_summary: "y" },
    { id: 3, tracking_token: "t-pa2", status: "pending_approval", status_changed_at: "2026-06-14T13:59:30.000Z", sla_alerted_at: "2026-06-14T13:59:40.000Z", name: "C", phone: "p", delivery_date: "2026-06-14", delivery_slot: "19:30", order_summary: "z" },
  ]});

  await GET(req(`Bearer ${SECRET}`));
  const firstRunCalls = (sendMessage as any).mock.calls as [string | number, string][];
  const reminder = firstRunCalls.filter((c) => String(c[0]) === "12345" && /awaiting your approval/.test(c[1]));
  expect(reminder).toHaveLength(1);
  expect(reminder[0][1]).toContain("2"); // 2 orders awaiting approval

  // Immediate second run (clock pinned): the reminder is deduped by the cooldown.
  (sendMessage as any).mockClear();
  await GET(req(`Bearer ${SECRET}`));
  const secondRunCalls = (sendMessage as any).mock.calls as [string | number, string][];
  expect(secondRunCalls.some((c) => /awaiting your approval/.test(c[1]))).toBe(false);
});
