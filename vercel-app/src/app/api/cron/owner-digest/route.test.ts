import { it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/server", () => ({ NextResponse: { json: (b: unknown, i?: { status?: number }) => new Response(JSON.stringify(b), { status: i?.status ?? 200 }) } }));
vi.mock("@/lib/appsScript", () => ({
  getCrmOrdersList: vi.fn(),
  getExpensesList: vi.fn(),
  slaListActiveOrders: vi.fn(),
}));
vi.mock("@/lib/telegram", () => ({ sendMessage: vi.fn(async () => ({ ok: true, status: 200 })) }));

// Stateful digest marker: markDigestSent stores the last key, wasDigestSent
// compares — mirrors the real single-key blob so the per-slot dedup can be
// exercised across two GET() calls in one test.
const mockMarker = { key: null as string | null, ownerChatId: 12345 as number | null };
vi.mock("@/lib/assistant/state", () => ({
  getOwnerChatId: vi.fn(async () => mockMarker.ownerChatId),
  wasDigestSent: vi.fn(async (k: string) => mockMarker.key === k),
  markDigestSent: vi.fn(async (k: string) => { mockMarker.key = k; }),
}));

import { GET } from "./route";
import { getCrmOrdersList, getExpensesList, slaListActiveOrders } from "@/lib/appsScript";
import { sendMessage } from "@/lib/telegram";

const SECRET = "cron-secret";
function req(auth?: string): Request {
  const headers: Record<string, string> = {};
  if (auth) headers.authorization = auth;
  return new Request("https://app.test/api/cron/owner-digest", { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  process.env.CRON_SECRET = SECRET;
  mockMarker.key = null;
  mockMarker.ownerChatId = 12345;
  (sendMessage as any).mockResolvedValue({ ok: true, status: 200 });
  // Today (Cairo) = 2026-06-15. Two realized orders → 1000 EGP revenue.
  (getCrmOrdersList as any).mockResolvedValue({ success: true, items: [
    { _rowIndex: 2, id: 1, order_total: 400, status: "confirmed", delivery_date: "2026-06-15", timestamp: "2026-06-15T08:00:00.000Z" },
    { _rowIndex: 3, id: 2, order_total: 600, status: "delivered", delivery_date: "2026-06-15", timestamp: "2026-06-15T09:00:00.000Z" },
  ]});
  (getExpensesList as any).mockResolvedValue({ success: true, items: [
    { amount_egp: 250, date: "2026-06-15", category: "produce" },
  ]});
  (slaListActiveOrders as any).mockResolvedValue({ success: true, orders: [
    { id: 9, tracking_token: "t-pa", status: "pending_approval", status_changed_at: "2026-06-15T16:00:00.000Z", sla_alerted_at: "", name: "P", phone: "p", delivery_date: "2026-06-15", delivery_slot: "21:00", order_summary: "q" },
  ]});
});
afterEach(() => { vi.useRealTimers(); });

it("rejects a missing/wrong CRON_SECRET with 401", async () => {
  expect((await GET(req())).status).toBe(401);
  expect((await GET(req("Bearer nope"))).status).toBe(401);
  expect(sendMessage).not.toHaveBeenCalled();
});

it("sends the digest at 20:00 Cairo with revenue / expenses / net / pending", async () => {
  vi.setSystemTime(new Date("2026-06-15T17:00:00.000Z")); // 20:00 Cairo (EEST)
  const res = await GET(req(`Bearer ${SECRET}`));
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, status: "sent" });
  expect(sendMessage).toHaveBeenCalledOnce();
  const [to, text] = (sendMessage as any).mock.calls[0] as [number, string];
  expect(to).toBe(12345);
  expect(text).toContain("1000"); // revenue
  expect(text).toContain("250");  // expenses
  expect(text).toContain("750");  // net = 1000 - 250
  expect(text).toMatch(/pending[^\n]*1/i); // 1 pending approval
});

it("skips when it is NOT a digest slot (14:00 Cairo)", async () => {
  vi.setSystemTime(new Date("2026-06-15T11:00:00.000Z")); // 14:00 Cairo
  const res = await GET(req(`Bearer ${SECRET}`));
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ status: "skipped: not a slot" });
  expect(sendMessage).not.toHaveBeenCalled();
});

it("dedups: a second call in the same slot does not send again", async () => {
  vi.setSystemTime(new Date("2026-06-15T17:00:00.000Z")); // 20:00 Cairo
  await GET(req(`Bearer ${SECRET}`));
  expect(sendMessage).toHaveBeenCalledOnce();
  (sendMessage as any).mockClear();
  const res = await GET(req(`Bearer ${SECRET}`));
  expect(await res.json()).toMatchObject({ status: "skipped: already sent" });
  expect(sendMessage).not.toHaveBeenCalled();
});

it("still sends when one source THROWS — that field degrades to unavailable", async () => {
  vi.setSystemTime(new Date("2026-06-15T17:00:00.000Z")); // 20:00 Cairo
  (getExpensesList as any).mockRejectedValueOnce(new Error("apps script down"));
  const res = await GET(req(`Bearer ${SECRET}`));
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, status: "sent" });
  expect(sendMessage).toHaveBeenCalledOnce();
  const text = (sendMessage as any).mock.calls[0][1] as string;
  expect(text).toContain("1000");        // revenue still computed
  expect(text).toMatch(/unavailable/i);  // expenses (and net) degrade, not abort
});

it("skips with no send when no owner is bound", async () => {
  vi.setSystemTime(new Date("2026-06-15T17:00:00.000Z"));
  mockMarker.ownerChatId = null;
  const res = await GET(req(`Bearer ${SECRET}`));
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ status: "skipped: no owner" });
  expect(sendMessage).not.toHaveBeenCalled();
});
