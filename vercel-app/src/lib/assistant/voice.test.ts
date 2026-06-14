import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { transcribeVoice } from "./voice";

beforeEach(() => { process.env.GROQ_API_KEY = "g"; });
afterEach(() => vi.restoreAllMocks());

describe("transcribeVoice", () => {
  it("posts multipart to Groq and returns text on success", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ text: "what is on the menu" }), { status: 200 }),
    );
    const r = await transcribeVoice(new Uint8Array([1, 2, 3]), Date.now() + 60_000);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe("what is on the menu");
    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain("audio/transcriptions");
    expect(spy.mock.calls[0][1]!.body).toBeInstanceOf(FormData);
  });

  it("returns too-large when bytes exceed 20MB", async () => {
    const r = await transcribeVoice(new Uint8Array(20 * 1024 * 1024 + 1), Date.now() + 60_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("too-large");
  });

  it("returns disabled when GROQ_API_KEY is unset", async () => {
    delete process.env.GROQ_API_KEY;
    const r = await transcribeVoice(new Uint8Array([1]), Date.now() + 60_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("disabled");
  });

  it("returns empty (not too-large) for a zero-byte note", async () => {
    const r = await transcribeVoice(new Uint8Array(0), Date.now() + 60_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("empty");
  });

  it("maps an in-flight Groq timeout to too-slow (not upstream)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      Object.assign(new Error("The operation timed out"), { name: "TimeoutError" }),
    );
    const r = await transcribeVoice(new Uint8Array([1, 2, 3]), Date.now() + 60_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("too-slow");
  });
});
