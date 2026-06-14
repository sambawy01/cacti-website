import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getFile, downloadFile, sendDocument, sendChatAction } from "./telegram";

const ORIG = { ...process.env };
beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = "TESTTOKEN";
});
afterEach(() => {
  process.env = { ...ORIG };
  vi.restoreAllMocks();
});

describe("getFile", () => {
  it("resolves a file_path from getFile", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: { file_id: "F", file_path: "voice/file_1.oga", file_size: 1234 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const r = await getFile("F");
    expect(r.ok).toBe(true);
    expect(r.filePath).toBe("voice/file_1.oga");
    expect(r.fileSize).toBe(1234);
  });

  it("returns ok:false on Telegram error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: false, description: "file not found" }), { status: 400 }),
    );
    const r = await getFile("bad");
    expect(r.ok).toBe(false);
  });
});

describe("downloadFile", () => {
  it("fetches bytes from the file endpoint using the bot token", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(bytes, { status: 200 }),
    );
    const out = await downloadFile("voice/file_1.oga", 20 * 1024 * 1024);
    expect(out).not.toBeNull();
    expect(Array.from(out!)).toEqual([1, 2, 3, 4]);
    const url = spy.mock.calls[0][0] as string;
    expect(url).toBe("https://api.telegram.org/file/botTESTTOKEN/voice/file_1.oga");
  });

  it("returns null when the file exceeds the size cap", async () => {
    const big = new Uint8Array(11);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(big, { status: 200, headers: { "content-length": "11" } }),
    );
    const out = await downloadFile("x", 10);
    expect(out).toBeNull();
  });

  it("enforces the cap on the realized buffer even with no Content-Length header", async () => {
    // A streamed body carries no Content-Length, so the declared-size check passes
    // (declared = 0); the realized-buffer check must still reject the 11-byte body.
    const big = new Uint8Array(11);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(big);
        c.close();
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(stream, { status: 200 }));
    const out = await downloadFile("x", 10);
    expect(out).toBeNull();
  });
});

describe("sendChatAction", () => {
  it("sendChatAction posts the action to the chat", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: true }), { status: 200 }),
    );
    const r = await sendChatAction(777, "typing");
    expect(r.ok).toBe(true);
    expect(spy.mock.calls[0][0] as string).toContain("/sendChatAction");
  });
});

describe("sendDocument", () => {
  it("posts multipart with the document bytes and filename", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 }),
    );
    const r = await sendDocument(123, new Uint8Array([9]), "report.pdf", "here you go");
    expect(r.ok).toBe(true);
    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain("/sendDocument");
    expect(spy.mock.calls[0][1]!.body).toBeInstanceOf(FormData);
  });
});
