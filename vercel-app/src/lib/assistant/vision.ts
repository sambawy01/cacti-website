/**
 * Photo / vision understanding for the Bistro Cloud owner agent.
 *
 * TWO-STAGE design (ported pattern):
 *   Stage 1 (HERE): a multimodal model TRIAGES + EXTRACTS the photo into
 *     structured JSON — { kind, vendor, totalEgp, date, category, name,
 *     description, text }.
 *   Stage 2 (webhook, Task 10): for a receipt we synthesize a plain-language
 *     instruction and run it through the EXISTING text agent + tools, so the
 *     mutating action (log_expense) parks behind the owner's unchanged
 *     [Confirm | Cancel] gate. Nothing mutating ever executes from a photo
 *     without the owner's tap.
 *
 * WHY two-stage (not let the vision model tool-call directly): the agent's
 * native tool-calling is proven on the deepseek text models; the cloud
 * multimodal model (gemini-3-flash-preview) emits clean, reliable JSON but its
 * tool_call support is unproven on this account. Extracting JSON then handing
 * it to the proven text-agent gate is the robust path AND reuses every existing
 * validation / confirm guarantee unchanged.
 *
 * Bistro kinds: "receipt" (a business expense → log_expense), "dish" (a plate
 * of food → identify), "product" (a retail/pantry item → identify), "general"
 * (read / transcribe / describe a document, note, or label). Unlike the
 * Victoria reference there is NO skin/face guardrail — a food business has no
 * such surface, so that whole branch is intentionally absent.
 */

const OLLAMA_CHAT_URL = "https://ollama.com/api/chat";

/** Default cloud multimodal model; overridable via env. */
function visionModel(): string {
  return (process.env.OLLAMA_MODEL_VISION || "").trim() || "gemini-3-flash-preview";
}

/** Per-request upstream timeout for the vision extraction call. */
const VISION_TIMEOUT_MS = 30_000;

/**
 * Budget reserved for the agent loop AFTER extraction (ms). The synthesized
 * instruction re-enters the text agent under the same webhook deadline, so we
 * never let the vision call extend past `deadlineAt − this`, and fail fast
 * below the floor — a SIGKILL at maxDuration would answer no 2xx and make
 * Telegram redeliver the photo.
 */
const VISION_DEADLINE_RESERVE_MS = 20_000;
/** Don't start the vision call with less than this much time; reply instead. */
const MIN_VISION_TIMEOUT_MS = 3_000;

/** Cap the extracted free-text (description/translation) we relay back. */
const MAX_TEXT_CHARS = 1500;

/**
 * Is photo understanding usable right now? The multimodal model is cloud-only,
 * so this needs the Ollama Cloud key (same one the agent uses). When absent the
 * webhook tells the owner photos can't be processed.
 */
export function visionEnabled(): boolean {
  return Boolean((process.env.OLLAMA_API_KEY || "").trim());
}

/** Reply when vision is disabled (no cloud key). */
export const VISION_DISABLED =
  "I can't look at photos right now (vision isn't configured) — send it as " +
  "text and I'll help.";

/** Reply when the model couldn't make sense of the image. */
export const VISION_UNCLEAR =
  "I couldn't make out anything useful in that photo. If it's a receipt or a " +
  "dish, try a clearer, well-lit shot — or just tell me the details.";

/** Reply when too little of the webhook budget remains to analyze safely. */
export const VISION_TOO_SLOW =
  "That came in a bit late for me to read the photo in time — send it again " +
  "or just tell me the details.";

// --- extraction --------------------------------------------------------------

export type VisionKind = "receipt" | "dish" | "product" | "general";

interface VisionExtraction {
  kind: VisionKind;
  vendor: string;
  totalEgp: number | null;
  date: string;
  category: string;
  name: string;
  description: string;
  text: string;
}

function buildVisionPrompt(): string {
  return `You are the image-triage and extraction step for the private ops assistant of a small Egyptian cloud-kitchen / bistro. You receive ONE image plus an optional caption from the owner. Classify it and extract structured data. Respond with ONLY a single JSON object — no prose, no markdown fences.

Choose exactly one "kind":
- "receipt": a receipt, invoice or proof of a business expense/purchase the owner wants logged to the books.
- "dish": a prepared plate of food / a menu dish the owner wants identified or described.
- "product": a retail or pantry ITEM (a packaged good, ingredient, bottle, box) the owner wants identified.
- "general": the owner wants you to read, transcribe, translate or plainly describe what's in the image (a document, a note, a label).

For "receipt", extract: vendor (string, who was paid), totalEgp (number, the grand total in EGP), date (YYYY-MM-DD or ""), category (best guess of expense category, e.g. ingredients, packaging, utilities, transport, other).
For "dish" or "product", extract: name (English name) and description (a short one-line description).
For "general", put the read/translated/described text in "text".

JSON shape (use null/"" for fields that don't apply):
{"kind":"receipt|dish|product|general","vendor":"","totalEgp":null,"date":"","category":"","name":"","description":"","text":""}`;
}

function parseJsonLoose(raw: string): Record<string, unknown> | null {
  let s = (raw || "").trim();
  // Strip ``` / ```json fences the models sometimes add.
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(s);
  if (fence) s = fence[1].trim();
  // Fall back to the first {...} block if there's leading/trailing prose.
  if (!s.startsWith("{")) {
    const m = /\{[\s\S]*\}/.exec(s);
    if (m) s = m[0];
  }
  try {
    const parsed = JSON.parse(s) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function str(o: Record<string, unknown>, key: string): string {
  const v = o[key];
  return typeof v === "string" ? v.trim() : "";
}

/** Read a numeric field that the model may emit as a number or numeric string. */
function num(o: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const v = o[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) {
      return Number(v);
    }
  }
  return null;
}

async function callVision(
  imageBase64: string,
  caption: string,
  timeoutMs: number
): Promise<VisionExtraction | null> {
  const key = (process.env.OLLAMA_API_KEY || "").trim();
  if (!key) return null;
  let content: string;
  try {
    const res = await fetch(OLLAMA_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: visionModel(),
        stream: false,
        options: { temperature: 0 },
        messages: [
          { role: "system", content: buildVisionPrompt() },
          {
            role: "user",
            content: `Caption from the owner: ${caption.trim() || "(none)"}`,
            images: [imageBase64],
          },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      console.error(`[vision] Ollama vision ${res.status}: ${detail}`);
      return null;
    }
    const data = (await res.json().catch(() => ({}))) as {
      message?: { content?: unknown };
    };
    content =
      typeof data.message?.content === "string" ? data.message.content : "";
  } catch (error) {
    console.error("[vision] Ollama vision call failed:", error);
    return null;
  }

  const obj = parseJsonLoose(content);
  if (!obj) return null;

  const kindRaw = str(obj, "kind").toLowerCase();
  const kind: VisionKind = (
    ["receipt", "dish", "product", "general"].includes(kindRaw)
      ? kindRaw
      : "general"
  ) as VisionKind;

  return {
    kind,
    vendor: str(obj, "vendor"),
    totalEgp: num(obj, "totalEgp", "total_egp"),
    date: str(obj, "date"),
    category: str(obj, "category"),
    name: str(obj, "name") || str(obj, "product_name"),
    description: str(obj, "description") || str(obj, "product_desc"),
    text: str(obj, "text").slice(0, MAX_TEXT_CHARS),
  };
}

// --- public outcome ----------------------------------------------------------

export type VisionOutcome =
  // Feed `instruction` into the text agent (it tool-calls → confirm gate);
  // `echo` is shown first so the owner sees what was understood from the photo.
  | { kind: "agent"; instruction: string; echo: string }
  // Direct reply — identification, a general read, disabled, slow, or unclear.
  | { kind: "reply"; text: string };

/**
 * Analyze a photo (already-downloaded bytes) + its caption. Returns either an
 * agent instruction (receipt → log_expense, confirm-gated downstream) or a
 * direct reply (dish/product identification, general read, or a graceful
 * failure). NEVER throws — disabled / failed / garbage paths return a friendly
 * reply.
 *
 * @param bytes      Already-downloaded photo bytes (the webhook owns the
 *                   Telegram getFile/downloadFile hop).
 * @param caption    The owner's optional caption on the photo.
 * @param deadlineAt Epoch-ms wall-clock deadline for the whole webhook turn; the
 *                   vision call is capped to leave room for the agent loop after.
 */
export async function analyzePhoto(
  bytes: Uint8Array,
  caption: string,
  deadlineAt: number
): Promise<VisionOutcome> {
  if (!visionEnabled()) return { kind: "reply", text: VISION_DISABLED };
  if (bytes.length === 0) return { kind: "reply", text: VISION_UNCLEAR };

  // Deadline-aware timeout: cap at min(default, remaining − reserve). If too
  // little of the webhook budget remains, reply now rather than risk the
  // maxDuration kill → Telegram redelivery.
  const budget = deadlineAt - Date.now() - VISION_DEADLINE_RESERVE_MS;
  if (budget < MIN_VISION_TIMEOUT_MS) return { kind: "reply", text: VISION_TOO_SLOW };
  const timeoutMs = Math.min(VISION_TIMEOUT_MS, budget);

  const ex = await callVision(
    Buffer.from(bytes).toString("base64"),
    caption,
    timeoutMs
  );
  if (!ex) return { kind: "reply", text: VISION_UNCLEAR };

  if (ex.kind === "receipt") {
    // NOTE: the extracted fields below are UNTRUSTED OCR (vendor/total/date) —
    // they are interpolated into the stage-2 instruction but never executed
    // directly: the text agent tool-calls log_expense, which parks behind the
    // owner's [Confirm | Cancel] gate, so every value is seen and approved.
    const cat = ex.category || "other";
    const amount =
      ex.totalEgp !== null ? `${ex.totalEgp} EGP` : "(amount unclear)";
    // Defence in depth on the untrusted-OCR surface: fence the agent to the one
    // intended tool, and when the amount is unknown don't hand it a bogus 0 —
    // tell it to ask instead (so it can't silently log a 0-EGP expense).
    const amountClause =
      ex.totalEgp !== null
        ? `amountEgp ${ex.totalEgp}`
        : `(the amount was unclear — ASK me for the amount before calling the tool; do not guess)`;
    const instruction =
      `I photographed a receipt. Log it as a business expense by calling log_expense with: ` +
      `vendor "${ex.vendor || "unknown"}", ${amountClause}, category "${cat}"` +
      `${ex.date ? `, date "${ex.date}"` : ""}, note "receipt photo". ` +
      `Use exactly these values; do not invent anything. ` +
      `Only call log_expense for this — do not call any other tool from this message.`;
    const echo =
      `🧾 From the receipt I read:\n` +
      `— vendor: ${ex.vendor || "(unclear)"}\n` +
      `— total: ${amount}\n` +
      `— date: ${ex.date || "(unclear)"}\n` +
      `— category guess: ${cat}`;
    return { kind: "agent", instruction, echo };
  }

  if (ex.kind === "dish" || ex.kind === "product") {
    // No tool creates menu items / products, so identification is a direct
    // reply — the owner reads it and decides any follow-up themselves.
    const label = ex.kind === "dish" ? "🍽️" : "📦";
    const name = ex.name || (ex.kind === "dish" ? "a dish" : "an item");
    const desc = ex.description ? ` — ${ex.description}` : "";
    const body = ex.name || ex.description ? `${name}${desc}` : (ex.text || VISION_UNCLEAR);
    return { kind: "reply", text: `${label} ${body}` };
  }

  // general: relay what was read / transcribed / described.
  return { kind: "reply", text: ex.text || VISION_UNCLEAR };
}
