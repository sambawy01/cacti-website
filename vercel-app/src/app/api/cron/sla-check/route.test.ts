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

it("does NOT mark when Telegram rejects (ok:false 429) — retries next run", async () => {
  (slaListActiveOrders as any).mockResolvedValue({ success: true, orders: [
    { id: 1, tracking_token: "t-breach", status: "confirmed", status_changed_at: "2026-06-14T13:50:00.000Z", sla_alerted_at: "", name: "A", phone: "p", delivery_slot: "16:00", order_summary: "x" },
  ]});
  (sendMessage as any).mockResolvedValue({ ok: false, status: 429 });
  const res = await GET(req(`Bearer ${SECRET}`));
  expect(res.status).toBe(200);
  expect(sendMessage).toHaveBeenCalledOnce();
  expect(markSlaAlerted).not.toHaveBeenCalled();
  expect(await res.json()).toMatchObject({ ok: true, alerted: 0 });
});
