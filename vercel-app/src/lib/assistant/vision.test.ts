import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { analyzePhoto } from "./vision";

function visionResponse(json: unknown) {
  return new Response(JSON.stringify({ message: { content: JSON.stringify(json) } }), { status: 200 });
}
beforeEach(() => { process.env.OLLAMA_API_KEY = "k"; });
afterEach(() => vi.restoreAllMocks());

describe("analyzePhoto", () => {
  it("turns a receipt into a log_expense instruction with the read values", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      visionResponse({ kind: "receipt", vendor: "Metro", totalEgp: 540, date: "2026-06-14", category: "ingredients", text: "" }),
    );
    const out = await analyzePhoto(new Uint8Array([1]), "", Date.now() + 60_000);
    expect(out.kind).toBe("agent");
    if (out.kind === "agent") {
      expect(out.instruction).toMatch(/log_expense/);
      expect(out.instruction).toMatch(/540/);
      expect(out.echo).toMatch(/Metro/);
      // Fenced to the one intended tool (defence in depth on the OCR surface).
      expect(out.instruction).toMatch(/do not call any other tool/i);
    }
  });

  it("asks for the amount instead of logging 0 when the total is unclear", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      visionResponse({ kind: "receipt", vendor: "Metro", totalEgp: null, date: "", category: "ingredients", text: "" }),
    );
    const out = await analyzePhoto(new Uint8Array([1]), "", Date.now() + 60_000);
    expect(out.kind).toBe("agent");
    if (out.kind === "agent") {
      expect(out.instruction).toMatch(/ASK me for the amount/i);
      expect(out.instruction).not.toMatch(/amountEgp 0\b/); // never a fabricated zero
    }
  });

  it("base64-encodes the actual image bytes and sends them to the vision model", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      visionResponse({ kind: "general", vendor: "", totalEgp: null, date: "", text: "a plate of food" }),
    );
    await analyzePhoto(new Uint8Array([1, 2, 3]), "what is this", Date.now() + 60_000);
    const body = JSON.parse((spy.mock.calls[0][1]!.body as string));
    expect(body.model).toContain("gemini");
    expect(body.messages.at(-1).images?.[0]).toBe(Buffer.from([1, 2, 3]).toString("base64"));
  });
});
