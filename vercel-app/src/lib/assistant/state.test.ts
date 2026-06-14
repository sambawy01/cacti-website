import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// In-memory blob store. `allowOverwrite:false` throws if key exists (mirrors
// the server's x-allow-overwrite:0 contract), so the exactly-once claim is
// genuinely exercised here rather than mocked away.
const store = new Map<string, string>();
vi.mock("@vercel/blob", () => ({
  put: vi.fn(async (pathname: string, body: string, opts: { allowOverwrite?: boolean }) => {
    if (opts?.allowOverwrite === false && store.has(pathname)) throw new Error("blob exists");
    store.set(pathname, body);
    return { pathname };
  }),
  get: vi.fn(async (pathname: string) => {
    if (!store.has(pathname)) return null;
    return { statusCode: 200, stream: new Response(store.get(pathname)!).body };
  }),
  del: vi.fn(async (pathname: string) => {
    store.delete(pathname);
  }),
  list: vi.fn(async ({ prefix }: { prefix: string }) => ({
    blobs: [...store.keys()]
      .filter((k) => k.startsWith(prefix))
      .map((pathname) => ({ pathname, uploadedAt: new Date().toISOString() })),
  })),
  head: vi.fn(async () => null),
}));

import {
  bindOwner,
  getOwnerChatId,
  appendHistory,
  loadHistory,
  createPendingAction,
  takePendingAction,
  confirmCancelKeyboard,
} from "./state";

beforeEach(() => {
  store.clear();
  process.env.BLOB_READ_WRITE_TOKEN = "tok";
});
afterEach(() => vi.restoreAllMocks());

describe("owner binding", () => {
  it("returns null before binding, the chatId after", async () => {
    expect(await getOwnerChatId()).toBeNull();
    await bindOwner(12345);
    expect(await getOwnerChatId()).toBe(12345);
  });

  it("fails CLOSED (throws) on a corrupt owner record instead of returning null", async () => {
    store.set("telegram/owner.json", "{not json");
    await expect(getOwnerChatId()).rejects.toThrow();
    store.set("telegram/owner.json", JSON.stringify({ boundAt: "x" })); // missing chatId
    await expect(getOwnerChatId()).rejects.toThrow();
  });
});

describe("history", () => {
  it("caps to the last 24 messages and never strands a leading tool message", async () => {
    for (let i = 0; i < 30; i++) await appendHistory({ role: "user", content: `m${i}` });
    const h = await loadHistory();
    expect(h.length).toBeLessThanOrEqual(24);
    expect(h[0].role).not.toBe("tool");
  });

  it("truncates an over-long message to the per-message cap", async () => {
    await appendHistory({ role: "user", content: "x".repeat(5000) });
    const h = await loadHistory();
    expect(h[0].content.length).toBeLessThanOrEqual(2000);
  });

  it("never leaves a leading tool message after trimming (boundary lands on a tool turn)", async () => {
    // Order so the 24-message window's first element is the tool turn: u0, tool,
    // then 23 assistants = 25 messages. slice(-24) starts at the tool → the guard
    // MUST shift it. Without the guard the result would be 24 msgs starting with tool.
    await appendHistory({ role: "user", content: "u0" });
    await appendHistory({ role: "tool", tool_name: "orders_active", content: "result" });
    for (let i = 0; i < 23; i++) await appendHistory({ role: "assistant", content: `a${i}` });
    const h = await loadHistory();
    expect(h[0].role).not.toBe("tool");
    expect(h.length).toBe(23); // the stranded tool was shifted out (would be 24 otherwise)
  });
});

describe("pending action exactly-once", () => {
  it("first take succeeds, second take returns not-found", async () => {
    const p = await createPendingAction({
      chatId: 1,
      tool: "order_delay",
      args: { token: "t", minutes: 15 },
      summary: "delay",
    });
    const first = await takePendingAction(p.id);
    const second = await takePendingAction(p.id);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("not-found");
  });

  it("rejects an invalid (non-uuid) id without touching the store", async () => {
    const r = await takePendingAction("not-a-uuid");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid-id");
  });

  it("the CLAIM MARKER is the exactly-once gate: a pre-existing claim blocks the take even though the pending blob still exists", async () => {
    const p = await createPendingAction({
      chatId: 1,
      tool: "order_delay",
      args: { token: "t", minutes: 15 },
      summary: "delay",
    });
    // Simulate another serverless instance having already claimed this id.
    // The pending blob is intact, so only the claim marker can block execution.
    store.set(`telegram/claims/${p.id}.json`, JSON.stringify({ claimedAt: "earlier" }));
    const r = await takePendingAction(p.id);
    expect(r.ok).toBe(false); // claimPending's allowOverwrite:false put throws → fail-closed
    expect(store.has(`telegram/pending/${p.id}.json`)).toBe(true); // pending was never the gate
  });
});

describe("confirmCancelKeyboard", () => {
  it("renders Confirm/Cancel buttons carrying the pending id", () => {
    const kb = confirmCancelKeyboard("11111111-1111-1111-1111-111111111111");
    expect(kb.inline_keyboard[0][0].callback_data).toBe("confirm:11111111-1111-1111-1111-111111111111");
    expect(kb.inline_keyboard[0][1].callback_data).toBe("cancel:11111111-1111-1111-1111-111111111111");
  });
});
