// Website AI chat backend. Ported from the Supabase Edge Function
// (supabase/functions/ai-chat/index.ts) to a Next.js route on the Vercel app.
// The only behavioral changes vs. the original:
//   - the Anthropic call is replaced with Groq (OpenAI-compatible API);
//   - the Supabase `saveConversation` side effect is dropped (Supabase-specific).
// Everything else — CORS, in-memory rate limit, the two system prompts, the
// `messages.slice(-20)` window, the SSE wire format, and the env-gated
// plan-builder proposal → CRM forward — is preserved.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALLOWED_ORIGINS = [
  "https://bistro-cloud.com",
  "https://www.bistro-cloud.com",
  "http://localhost:5173",
];

/**
 * CORS headers for this endpoint. The client POSTs application/json (which
 * triggers a preflight) with no auth header, so we echo the request Origin
 * when it's allowed, otherwise fall back to the first allowed origin.
 */
function corsHeadersFor(origin: string): Record<string, string> {
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    // Echoed Allow-Origin varies by request Origin — tell any CDN not to
    // serve one origin's cached CORS response to a different origin.
    Vary: "Origin",
  };
}

// In-memory rate limit: 20 requests/hour/IP.
// NOTE: serverless instances each keep their own Map and reset on cold start,
// so this is best-effort only — acceptable here because the client
// (src/services/aiService.ts) also rate-limits per session.
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 3600000; // 1 hour

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  if (entry.count >= RATE_LIMIT_MAX) return true;
  entry.count++;
  return false;
}

const CHAT_PROMPT = `You are Bistro Cloud's friendly assistant in El Gouna, Egypt. Answer questions about the menu, hours (Mon-Sun 10AM-8PM), delivery (Safaga to Ras Ghareb, including Hurghada, free over EGP 500), dietary options, and pricing. Be warm and concise. If the user mentions corporate catering, office lunch, or recurring orders, suggest the Plan Builder at /plan-builder. Keep responses under 3 sentences unless more detail is needed.

Key info:
- Location: West Golf, New Sabina, El Gouna
- Phone: +20 122 128 8804
- WhatsApp: wa.me/201221288804
- Instagram: @bistrocloudelgouna
- Delivery area: Safaga to Ras Ghareb (including Hurghada & El Gouna)
- Free delivery over EGP 500
- Products: Premium Beef Tallow, Bone Broth
- 100% natural ingredients, open kitchen policy`;

const PLAN_BUILDER_PROMPT = `You are Bistro Cloud's corporate plan designer in El Gouna, Egypt. Guide the user through building a catering plan by collecting: company name, headcount, frequency, dietary needs, budget, location, contact info (name, email, phone).

Rules:
- Ask ONE question at a time
- After each question, include a JSON code block with suggested quick replies, e.g.:
\`\`\`json
["Daily (Mon-Fri)", "3x/week", "Events only"]
\`\`\`
- Once you have enough info (at minimum: company, headcount, frequency, contact email, location), generate a proposal as a JSON code block:
\`\`\`json
{ "type": "proposal", "company": "...", "contact": {...}, "headcount": N, "frequency": "...", "location": "...", "dietary": [...], "menuRotation": [{day, theme}...], "pricing": { "perPersonPerDay": N, "weeklyTotal": N, "currency": "EGP", "discounts": [...] } }
\`\`\`

CATERING PRICING — use these EXACT numbers:
- Per person per meal: EGP 600 to EGP 1,200 depending on menu selection
- Budget menu: EGP 600/person. Standard: ~EGP 800/person. Premium: ~EGP 1,000/person. Luxury full-course: EGP 1,200/person.
- Weekly formula: headcount × per-meal rate × days per week
- 10% off for daily (5-day) recurring plans. Free delivery for corporate plans.
- NEVER quote below EGP 600/person or above EGP 1,200/person.

Service area: Safaga to Ras Ghareb (including Hurghada & El Gouna)`;

const JSON_FENCE_RE = /```json\s*\n?([\s\S]*?)```/g;

/** Pull the proposal JSON out of the assistant's reply, if present. */
function extractProposal(text: string): Record<string, unknown> | null {
  for (const match of text.matchAll(JSON_FENCE_RE)) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed && parsed.type === "proposal") return parsed;
    } catch {
      /* skip malformed JSON */
    }
  }
  return null;
}

/**
 * Fire-and-forget forward of a finished plan-builder proposal to the CRM
 * (Apps Script). Env-gated: when CRM_ENDPOINT is unset this is a no-op, exactly
 * as in the original. Swallows its own errors so it can never break the stream.
 */
async function forwardToCRM(proposal: Record<string, unknown>): Promise<void> {
  const crmEndpoint = process.env.CRM_ENDPOINT;
  if (!crmEndpoint) return;
  try {
    const payload = JSON.stringify({
      formType: "ai_plan_builder",
      data: proposal,
      timestamp: new Date().toISOString(),
    });
    // Bound the forward: a hung CRM endpoint must not hold the SSE stream
    // open up to maxDuration. Timeout aborts the fetch → caught below.
    await fetch(`${crmEndpoint}?payload=${encodeURIComponent(payload)}`, {
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    console.error("CRM forwarding failed (non-blocking):", err);
  }
}

export function OPTIONS(request: Request): Response {
  const origin = request.headers.get("origin") || "";
  return new Response(null, { status: 204, headers: corsHeadersFor(origin) });
}

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get("origin") || "";
  const cors = corsHeadersFor(origin);

  // Rate-limit key = the trusted client IP. Prefer Vercel's `x-real-ip`
  // (set by the platform, not client-controllable); fall back to the first
  // `x-forwarded-for` hop, then "unknown". Keying on the leftmost XFF alone
  // is spoofable — a client can forge that header to evade the limiter.
  const ip = (
    request.headers.get("x-real-ip") ||
    (request.headers.get("x-forwarded-for") || "unknown").split(",")[0]
  ).trim();
  if (isRateLimited(ip)) {
    return new Response(JSON.stringify({ error: "rate_limited" }), {
      status: 429,
      headers: { "Content-Type": "application/json", ...cors },
    });
  }

  let body: { mode?: unknown; messages?: unknown } | null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const mode = body?.mode;
  const messages = body?.messages;
  if (!mode || !messages || !Array.isArray(messages)) {
    return new Response(JSON.stringify({ error: "Invalid request" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...cors },
    });
  }

  // Validate each message before spending a Groq call: every entry must be an
  // object with a string `role` and a non-empty string `content` of length
  // ≤ 4000. Rejects oversized/malformed payloads with the same 400 shape.
  const MAX_CONTENT_LEN = 4000;
  const validShape = messages.every((m) => {
    if (typeof m !== "object" || m === null) return false;
    const { role, content } = m as { role?: unknown; content?: unknown };
    return (
      typeof role === "string" &&
      typeof content === "string" &&
      content.length > 0 &&
      content.length <= MAX_CONTENT_LEN
    );
  });
  if (!validShape) {
    return new Response(JSON.stringify({ error: "Invalid request" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...cors },
    });
  }

  const systemPrompt = mode === "chat" ? CHAT_PROMPT : PLAN_BUILDER_PROMPT;
  // Groq model IDs — verify these are still current at https://console.groq.com/docs/models
  const model =
    mode === "chat"
      ? process.env.GROQ_MODEL_CHAT || "llama-3.1-8b-instant"
      : process.env.GROQ_MODEL_PLAN || "llama-3.3-70b-versatile";

  const chatMessages = messages as Array<{ role: string; content: string }>;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      let fullResponse = "";

      try {
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) {
          send({ error: "Server misconfigured" });
          controller.close();
          return;
        }

        const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "system", content: systemPrompt }, ...chatMessages.slice(-20)],
            stream: true,
            max_tokens: 1024,
            temperature: 0.5,
          }),
        });

        if (!groqRes.ok || !groqRes.body) {
          throw new Error(`Groq responded ${groqRes.status}`);
        }

        // Groq emits OpenAI-style SSE: `data: {json}` lines, terminated by
        // `data: [DONE]`. Buffer raw bytes and split on newlines so we don't
        // choke on chunk boundaries that fall mid-line.
        const reader = groqRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let finished = false;

        while (!finished) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trim();
            if (!payload) continue;
            if (payload === "[DONE]") {
              finished = true;
              break;
            }
            try {
              const json = JSON.parse(payload);
              const content: string | undefined = json?.choices?.[0]?.delta?.content;
              if (content) {
                fullResponse += content;
                send({ token: content });
              }
            } catch {
              /* skip malformed SSE line */
            }
          }
        }

        send({ done: true });

        // Plan-builder: if the reply contains a proposal, forward it to the CRM
        // (env-gated, non-blocking). saveConversation from the original is
        // intentionally NOT ported (Supabase-specific).
        if (mode === "plan-builder") {
          const proposal = extractProposal(fullResponse);
          if (proposal) await forwardToCRM(proposal);
        }
      } catch (err) {
        console.error("Groq API error:", err);
        send({ error: "Our AI is taking a break. Please try again or message us on WhatsApp." });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      ...cors,
    },
  });
}
