import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./state", () => ({
  loadHistory: vi.fn(async () => []),
  appendHistory: vi.fn(async () => {}),
  createPendingAction: vi.fn(async (a: any) => ({ ...a, id: "11111111-1111-1111-1111-111111111111", createdAt: "now" })),
}));
// vi.mock factories are hoisted above top-level declarations, so the shared
// executeTool spy must be created via vi.hoisted to be referenceable inside it.
const { execMock } = vi.hoisted(() => ({ execMock: vi.fn(async () => "OK-RESULT") }));
vi.mock("./tools", () => ({
  TOOLS: [{ type: "function", function: { name: "orders_active", description: "", parameters: { type: "object", properties: {}, required: [] } } }],
  requiresConfirmation: (n: string) => n === "order_delay",
  validateMutationArgs: (_n: string, a: any) => ({ ok: true, args: a }),
  describeMutation: () => "Delay order t1 by 15 min",
  executeTool: execMock,
}));
vi.mock("./prompt", () => ({ buildSystemPrompt: () => "SYS" }));

import { runAgent } from "./agent";
import { loadHistory } from "./state";

function ollamaResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}
beforeEach(() => { process.env.OLLAMA_API_KEY = "k"; });
afterEach(() => vi.restoreAllMocks());

describe("runAgent", () => {
  it("runs a read tool inline then returns the model's final text", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(ollamaResponse({ message: { role: "assistant", content: "", tool_calls: [{ function: { name: "orders_active", arguments: {} } }] } }))
      .mockResolvedValueOnce(ollamaResponse({ message: { role: "assistant", content: "You have 1 active order." } }));
    const out = await runAgent({ chatId: 1, userText: "any active orders?", deadlineAt: Date.now() + 90_000 });
    expect(out.kind).toBe("text");
    if (out.kind === "text") expect(out.text).toContain("active order");
    expect(execMock).toHaveBeenCalledWith("orders_active", {}, { chatId: 1 });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("short-circuits a mutating tool into a confirm result without executing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      ollamaResponse({ message: { role: "assistant", content: "", tool_calls: [{ function: { name: "order_delay", arguments: { token: "t1", minutes: 15 } } }] } }),
    );
    const out = await runAgent({ chatId: 1, userText: "delay t1 by 15", deadlineAt: Date.now() + 90_000 });
    expect(out.kind).toBe("confirm");
    if (out.kind === "confirm") {
      expect(out.pendingId).toMatch(/^[0-9a-f-]{36}$/);
      expect(out.text).toMatch(/confirm/i);
    }
    expect(execMock).not.toHaveBeenCalled(); // not executed until the tap
  });

  it("stops after MAX_TOOL_ROUNDS and returns a graceful message", async () => {
    // Fresh Response per call (a single shared Response would have its body
    // consumed once), so the model keeps emitting a read tool_call and the loop
    // genuinely runs until the round budget is exhausted.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      ollamaResponse({ message: { role: "assistant", content: "", tool_calls: [{ function: { name: "orders_active", arguments: {} } }] } }),
    );
    const out = await runAgent({ chatId: 1, userText: "loop", deadlineAt: Date.now() + 90_000 });
    expect(out.kind).toBe("text");
    // MAX_TOOL_ROUNDS = 4 → rounds 0..4 inclusive = 5 model calls, then the
    // final round returns the graceful fallback instead of looping forever.
    expect(fetchSpy).toHaveBeenCalledTimes(5);
  });

  it("escalates to the heavy model when the fast model bails with a refusal", async () => {
    // Round 1 (fast): a refusal text, no tool calls. Then the heavy retry: a real answer.
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(ollamaResponse({ message: { role: "assistant", content: "I can't access that." } }))
      .mockResolvedValueOnce(ollamaResponse({ message: { role: "assistant", content: "You have 3 active orders." } }));
    const out = await runAgent({ chatId: 1, userText: "orders I sent?", deadlineAt: Date.now() + 90_000 });
    expect(out.kind).toBe("text");
    if (out.kind === "text") expect(out.text).toContain("active orders");
    // Two model calls: the fast bail + the heavy escalation.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const body2 = JSON.parse(fetchSpy.mock.calls[1][1]!.body as string);
    expect(body2.model).toMatch(/pro|heavy/i); // escalated to heavy
  });

  it("does NOT escalate when the fast model gives a real answer", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(ollamaResponse({ message: { role: "assistant", content: "We're open 10AM-8PM." } }));
    const out = await runAgent({ chatId: 1, userText: "hours?", deadlineAt: Date.now() + 90_000 });
    expect(out.kind).toBe("text");
    expect(fetchSpy).toHaveBeenCalledTimes(1); // no escalation
  });

  it("does NOT escalate on a FACTUAL 'can't' answer (first-person anchored regex)", async () => {
    // "the kitchen can't take orders after 8PM" is a correct answer, not the
    // model bailing about itself — must not trigger a wasted heavy round-trip.
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(ollamaResponse({ message: { role: "assistant", content: "The kitchen can't take orders after 8PM." } }));
    const out = await runAgent({ chatId: 1, userText: "can we order at 9pm?", deadlineAt: Date.now() + 90_000 });
    expect(out.kind).toBe("text");
    expect(fetchSpy).toHaveBeenCalledTimes(1); // no escalation
  });

  it("never throws to the caller when loadHistory fails — degrades to empty history", async () => {
    vi.mocked(loadHistory).mockRejectedValueOnce(new Error("blob down"));
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      ollamaResponse({ message: { role: "assistant", content: "Hi! How can I help?" } }),
    );
    const out = await runAgent({ chatId: 1, userText: "hello", deadlineAt: Date.now() + 90_000 });
    expect(out.kind).toBe("text");
    if (out.kind === "text") expect(out.text).toContain("help");
  });
});
