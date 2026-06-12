import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js";

const app = new Hono();

app.use(
  "/*",
  cors({
    origin: [
      "https://bistro-cloud.com",
      "https://www.bistro-cloud.com",
      "http://localhost:5173",
    ],
    allowHeaders: ["Content-Type"],
    allowMethods: ["POST", "OPTIONS"],
  })
);

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 3600000 });
    return false;
  }
  if (entry.count >= 20) return true;
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

function getSupabaseClient() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}

async function saveConversation(
  sessionId: string,
  messages: Array<{ role: string; content: string }>,
  proposal: Record<string, unknown> | null
) {
  try {
    const supabase = getSupabaseClient();
    await supabase.from("conversations").insert({
      session_id: sessionId,
      mode: "plan-builder",
      messages,
      proposal,
    });
  } catch (err) {
    console.error("Failed to save conversation:", err);
  }
}

async function forwardToCRM(proposal: Record<string, unknown>) {
  const crmEndpoint = Deno.env.get("CRM_ENDPOINT");
  if (!crmEndpoint) return;
  try {
    const payload = JSON.stringify({
      formType: "ai_plan_builder",
      data: proposal,
      timestamp: new Date().toISOString(),
    });
    await fetch(`${crmEndpoint}?payload=${encodeURIComponent(payload)}`);
  } catch (err) {
    console.error("CRM forwarding failed (non-blocking):", err);
  }
}

const JSON_FENCE_RE = /```json\s*\n?([\s\S]*?)```/g;

function extractProposal(text: string): Record<string, unknown> | null {
  for (const match of text.matchAll(JSON_FENCE_RE)) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed && parsed.type === "proposal") return parsed;
    } catch { /* skip */ }
  }
  return null;
}

app.post("/", async (c) => {
  const ip = c.req.header("x-forwarded-for") || c.req.header("cf-connecting-ip") || "unknown";

  if (isRateLimited(ip)) {
    return c.json({ error: "rate_limited" }, 429);
  }

  const { mode, messages, sessionId } = await c.req.json();

  if (!mode || !messages || !Array.isArray(messages)) {
    return c.json({ error: "Invalid request" }, 400);
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return c.json({ error: "Server misconfigured" }, 500);
  }

  const client = new Anthropic({ apiKey });
  const model = mode === "chat" ? "claude-haiku-4-5-20251001" : "claude-sonnet-4-6-20250514";
  const systemPrompt = mode === "chat" ? CHAT_PROMPT : PLAN_BUILDER_PROMPT;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      let fullResponse = "";

      try {
        const response = await client.messages.create({
          model,
          max_tokens: 1024,
          system: systemPrompt,
          messages: messages.slice(-20),
          stream: true,
        });

        for await (const event of response) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            fullResponse += event.delta.text;
            send({ token: event.delta.text });
          }
        }

        send({ done: true });

        if (mode === "plan-builder") {
          const proposal = extractProposal(fullResponse);
          if (proposal) {
            await Promise.all([
              saveConversation(sessionId, [...messages, { role: "assistant", content: fullResponse }], proposal),
              forwardToCRM(proposal),
            ]);
          }
        }
      } catch (err) {
        console.error("Claude API error:", err);
        send({ error: "Our AI is taking a break. Please try again or message us on WhatsApp." });
      }

      controller.close();
    },
  });

  // Must set CORS headers manually since raw Response bypasses Hono middleware
  const origin = c.req.header("origin") || "";
  const allowedOrigins = ["https://bistro-cloud.com", "https://www.bistro-cloud.com", "http://localhost:5173"];
  const corsOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
});

app.get("/health", (c) => c.json({ status: "ok" }));

Deno.serve(app.fetch);
