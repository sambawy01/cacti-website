import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OPTIONS, POST } from "./route";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

/** Build a Response whose body is a ReadableStream of encoded SSE lines, the
 *  same shape Groq's streaming endpoint returns. */
function sseResponse(lines: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

/** Drain a streamed Response body to a string. */
async function readBody(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

function deltaLine(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

let ipCounter = 0;
function post(
  body: unknown,
  opts: { origin?: string; ip?: string; realIp?: string } = {},
): Promise<Response> {
  // Default to a unique IP per request so the in-memory rate limiter never
  // bleeds across tests; tests that exercise the limiter pin an explicit IP.
  // The route now keys the limiter on `x-real-ip` (the trusted, non-spoofable
  // client IP) and only falls back to `x-forwarded-for`. Default isolation
  // uses a unique XFF; limiter tests pin via `realIp`.
  const ip = opts.ip ?? `10.0.0.${++ipCounter}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-forwarded-for": ip,
  };
  if (opts.realIp) headers["x-real-ip"] = opts.realIp;
  if (opts.origin) headers.origin = opts.origin;
  return POST(
    new Request("https://app.test/api/ai-chat", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  process.env.GROQ_API_KEY = "test-key";
  delete process.env.CRM_ENDPOINT;
  delete process.env.GROQ_MODEL_CHAT;
  delete process.env.GROQ_MODEL_PLAN;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OPTIONS (CORS preflight)", () => {
  it("returns 204 and echoes an allowed origin", () => {
    const res = OPTIONS(
      new Request("https://app.test/api/ai-chat", {
        method: "OPTIONS",
        headers: { origin: "https://bistro-cloud.com" },
      }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://bistro-cloud.com");
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
    expect(res.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type");
  });

  it("falls back to the first allowed origin for a disallowed origin", () => {
    const res = OPTIONS(
      new Request("https://app.test/api/ai-chat", {
        method: "OPTIONS",
        headers: { origin: "https://evil.example" },
      }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://bistro-cloud.com");
  });
});

describe("POST chat streaming", () => {
  it("translates Groq SSE chunks into token + done events with CORS headers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(sseResponse([deltaLine("Hello"), deltaLine(" world"), "data: [DONE]\n\n"]));
    vi.stubGlobal("fetch", fetchMock);

    const res = await post(
      { mode: "chat", messages: [{ role: "user", content: "hi" }], sessionId: "s1" },
      { origin: "http://localhost:5173" },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");

    const text = await readBody(res);
    expect(text).toContain(`data: {"token":"Hello"}`);
    expect(text).toContain(`data: {"token":" world"}`);
    expect(text).toContain(`data: {"done":true}`);

    // Groq was called with the chat model and the system prompt prepended.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(GROQ_URL);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.model).toBe("llama-3.1-8b-instant");
    expect(sent.stream).toBe(true);
    expect(sent.messages[0].role).toBe("system");
    expect(sent.messages[1]).toEqual({ role: "user", content: "hi" });
  });

  it("emits done even when Groq ends without an explicit [DONE]", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse([deltaLine("hey")])));
    const res = await post({ mode: "chat", messages: [{ role: "user", content: "hi" }] });
    const text = await readBody(res);
    expect(text).toContain(`data: {"token":"hey"}`);
    expect(text).toContain(`data: {"done":true}`);
  });

  it("reassembles a single SSE event split across two chunks", async () => {
    // One full `data: {...}` event sent in two pieces: the first chunk ends
    // mid-line, the second completes it. Exercises `buffer = lines.pop()`
    // partial-line retention across reads.
    const fullLine = `data: ${JSON.stringify({ choices: [{ delta: { content: "Hi" } }] })}`;
    const splitAt = 12; // somewhere inside the line
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          fullLine.slice(0, splitAt),
          `${fullLine.slice(splitAt)}\n\ndata: [DONE]\n\n`,
        ]),
      ),
    );
    const res = await post({ mode: "chat", messages: [{ role: "user", content: "hi" }] });
    const text = await readBody(res);
    expect(text).toContain(`data: {"token":"Hi"}`);
    expect(text).toContain(`data: {"done":true}`);
  });

  it("emits an error event and no done when Groq responds non-ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 500 })),
    );
    const res = await post({ mode: "chat", messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(200);
    const text = await readBody(res);
    expect(text).toContain(`data: {"error":`);
    expect(text).not.toContain(`data: {"done":true}`);
  });

  it("emits an error event and no done when the Groq fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const res = await post({ mode: "chat", messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(200);
    const text = await readBody(res);
    expect(text).toContain(`data: {"error":`);
    expect(text).not.toContain(`data: {"done":true}`);
  });
});

describe("validation", () => {
  it("returns 400 when messages is missing", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const res = await post({ mode: "chat" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid request" });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeTruthy();
  });

  it("returns 400 when mode is missing", async () => {
    const res = await post({ messages: [{ role: "user", content: "x" }] });
    expect(res.status).toBe(400);
  });

  it("returns 400 when a message content exceeds 4000 chars (never calls Groq)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await post({
      mode: "chat",
      messages: [{ role: "user", content: "x".repeat(5000) }],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid request" });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 when a message content is not a string", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await post({
      mode: "chat",
      messages: [{ role: "user", content: 123 }],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("missing GROQ_API_KEY", () => {
  it("streams a single 'Server misconfigured' error and closes", async () => {
    delete process.env.GROQ_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await post({ mode: "chat", messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(200);
    const text = await readBody(res);
    expect(text).toContain(`data: {"error":"Server misconfigured"}`);
    expect(text).not.toContain(`"done":true`);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("rate limiting", () => {
  it("returns 429 with {error:'rate_limited'} on the 21st request from one x-real-ip", async () => {
    // Fresh stream per call — a single Response body can only be read once.
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(["data: [DONE]\n\n"])));
    // Pin the trusted client IP (x-real-ip), the header the limiter now keys
    // on. A unique x-forwarded-for is still sent per call to prove the limiter
    // ignores spoofable XFF when a real IP is present.
    const realIp = "203.0.113.7";
    const body = { mode: "chat", messages: [{ role: "user", content: "hi" }] };

    for (let i = 0; i < 20; i++) {
      const res = await post(body, { realIp });
      expect(res.status).toBe(200);
    }
    const limited = await post(body, { realIp });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited" });
  });
});

describe("plan-builder proposal → CRM forward", () => {
  const proposalText =
    'Here is your plan:\n```json\n{"type":"proposal","company":"Acme","headcount":20}\n```\n';

  function groqStreamWithProposal(): Response {
    // Split the proposal across two delta chunks to exercise buffering.
    const mid = Math.floor(proposalText.length / 2);
    return sseResponse([
      deltaLine(proposalText.slice(0, mid)),
      deltaLine(proposalText.slice(mid)),
      "data: [DONE]\n\n",
    ]);
  }

  it("fires a CRM request when CRM_ENDPOINT is set and a proposal is present", async () => {
    process.env.CRM_ENDPOINT = "https://crm.test/exec";
    const fetchMock = vi.fn(async (url: string) => {
      if (typeof url === "string" && url.startsWith("https://crm.test")) {
        return new Response("ok", { status: 200 });
      }
      return groqStreamWithProposal();
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await post({ mode: "plan-builder", messages: [{ role: "user", content: "plan" }] });
    await readBody(res);

    const crmCall = fetchMock.mock.calls.find(
      (c) => typeof c[0] === "string" && (c[0] as string).startsWith("https://crm.test/exec?payload="),
    );
    expect(crmCall).toBeTruthy();
    const url = new URL(crmCall![0] as string);
    const forwarded = JSON.parse(decodeURIComponent(url.searchParams.get("payload")!));
    expect(forwarded.formType).toBe("ai_plan_builder");
    expect(forwarded.data).toMatchObject({ type: "proposal", company: "Acme" });
  });

  it("does not call the CRM when CRM_ENDPOINT is unset", async () => {
    const fetchMock = vi.fn().mockResolvedValue(groqStreamWithProposal());
    vi.stubGlobal("fetch", fetchMock);

    const res = await post({ mode: "plan-builder", messages: [{ role: "user", content: "plan" }] });
    await readBody(res);

    // Only the Groq call — never a CRM call.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(GROQ_URL);
  });

  it("uses the plan-builder model", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(["data: [DONE]\n\n"]));
    vi.stubGlobal("fetch", fetchMock);
    const res = await post({ mode: "plan-builder", messages: [{ role: "user", content: "plan" }] });
    await readBody(res);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.model).toBe("llama-3.3-70b-versatile");
  });
});
