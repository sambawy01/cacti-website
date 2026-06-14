import { buildSystemPrompt } from "./prompt";
import {
  TOOLS,
  describeMutation,
  executeTool,
  requiresConfirmation,
  validateMutationArgs,
} from "./tools";
import { appendHistory, createPendingAction, loadHistory, type HistoryMessage } from "./state";

/**
 * Owner-DM Telegram agent loop — Ollama chat with NATIVE tool calling.
 *
 * Ported from the reference "Vassili" agent and adapted for Bistro Cloud:
 * - system prompt comes from buildSystemPrompt() (no persona-specific name);
 * - the tool catalog / validation / describe / execute come from ./tools;
 * - pending (confirm-gated) mutations are stored via ./state;
 * - the vision and web-search tools of the reference are dropped — the webhook
 *   route converts voice/photo/PDF to a TEXT instruction that re-enters this
 *   same loop, so the agent itself never needs the multimodal or web models;
 * - no audit writes here (state exposes only history + pending to this module).
 *
 * Loop shape:
 * - ≤ MAX_TOOL_ROUNDS rounds (each round = one model call, possibly with
 *   several tool calls). Read-only tools execute inline; the FIRST mutating
 *   tool call short-circuits the loop into a pending action + confirm result
 *   (the model never sees a mutating tool's output — that arrives via the
 *   webhook's confirm-callback handler after the owner taps Confirm).
 * - Overall budget: callers pass an absolute `deadlineAt` (the webhook derives
 *   it from its maxDuration). No NEW model call starts with less than
 *   DEADLINE_MIN_MODEL_MS remaining, and each call's own timeout is capped so
 *   it cannot run past the deadline minus the reply reserve — otherwise the
 *   function is killed mid-run and Telegram redelivers the update, double-
 *   running the agent.
 */

const MAX_TOOL_ROUNDS = 4;
const UPSTREAM_TIMEOUT_MS = 30_000;
const NUM_PREDICT = 700;
/** Don't START a model call with less budget than this before the deadline. */
const DEADLINE_MIN_MODEL_MS = 20_000;
/** Time reserved after the last model call to send the Telegram reply. */
const REPLY_RESERVE_MS = 8_000;
/**
 * Below this much remaining budget we DOWNGRADE a heavy-routed call to the
 * fast model: heavy models can run slower, and a request must never be lost to
 * routing.
 */
const HEAVY_MIN_REMAINING_MS = 35_000;

// --- Model routing -----------------------------------------------------------
//
// Two text models, picked per task (see pickModel):
// - FAST (deepseek-v4-flash:cloud): default for everyday ops — orders,
//   capacity, revenue, quick Q&A. Keeps Telegram latency low.
// - HEAVY (deepseek-v4-pro:cloud): document / long-form generation — when the
//   owner asks to write/draft/compose a letter, offer, report or document.
//
// Both are env-overridable. Routing FAILS SAFE: if the heavy call errors (e.g.
// the model isn't pulled on this host) the loop retries once on the fast model
// rather than failing the request, and latches heavy off for the rest of the run.

export const FAST_MODEL_DEFAULT = "deepseek-v4-flash:cloud";
export const HEAVY_MODEL_DEFAULT = "deepseek-v4-pro:cloud";

/** The everyday fast model (OLLAMA_MODEL override, else the flash default). */
export function fastModel(): string {
  return process.env.OLLAMA_MODEL || FAST_MODEL_DEFAULT;
}
/** The heavyweight model for long-form generation (OLLAMA_MODEL_HEAVY). */
export function heavyModel(): string {
  return process.env.OLLAMA_MODEL_HEAVY || HEAVY_MODEL_DEFAULT;
}

// Generation verbs + document nouns. Heavy routing fires when the owner is
// asking the assistant to AUTHOR a document/long-form piece — not when they
// dictate content for an ops action (e.g. "broadcast exactly this: …" has no
// generation verb on a document noun, so it stays fast).
const GEN_VERB_RE =
  /\b(write|draft|compose|prepare|prep|produce|generate|create|make|put together|drafting)\b/i;
const DOC_NOUN_RE =
  /\b(letter|offer|proposal|document|doc|pdf|memo|contract|agreement|statement|p&l|profit\s*(?:&|and)\s*loss|invoice|quote|quotation|report|summary)\b/i;
const AR_GEN_VERB_RE = /(اكتب|اكتبي|جهز|جهّز|حضّر|حضر|اعمل|صيغ|صياغة|أنشئ|انشئ)/;
const AR_DOC_NOUN_RE = /(خطاب|عرض|مقترح|مستند|وثيقة|تقرير|فاتورة|عقد|بيان)/;

// A terminal fast-model text that reads like a bail/refusal ("I can't access
// that", "I'm not able to", "please rephrase") rather than a real answer. When
// this matches, the loop escalates the turn ONCE to the heavy model (see
// runAgent) — the fast model often bails instead of calling a read tool.
// Anchored on FIRST-PERSON inability so factual answers that merely contain
// "can't"/"no access" ("the kitchen can't take orders after 8PM", "you can't go
// wrong with the special") don't waste a heavy round-trip — only the model
// bailing about ITSELF ("I can't access that", "I don't have a tool…") escalates.
const REFUSAL_RE =
  /\b(i\s+(can'?t|cannot)|i'?m\s+(not able|unable)|i\s+(don'?t|do not)\s+have\s+(access|a tool)|no access to|please rephrase)\b/i;

/** Does this message ask the assistant to author a document / long-form piece? */
export function isHeavyIntent(userText: string): boolean {
  const t = (userText || "").slice(0, 2000);
  if (GEN_VERB_RE.test(t) && DOC_NOUN_RE.test(t)) return true;
  if (AR_GEN_VERB_RE.test(t) && AR_DOC_NOUN_RE.test(t)) return true;
  return false;
}

export interface ModelRoute {
  model: string;
  heavy: boolean;
  reason: string;
}

/**
 * Pick the model for a run from the owner's text intent. Pure +
 * env-overridable so it can be unit-tested in isolation. The webhook passes
 * vision/voice results as TEXT, so there is no image branch here — every run
 * routes on text alone.
 */
export function pickModel(ctx: { userText?: string }): ModelRoute {
  if (isHeavyIntent(ctx.userText ?? "")) {
    return {
      model: heavyModel(),
      heavy: true,
      reason: "document/long-form generation intent",
    };
  }
  return { model: fastModel(), heavy: false, reason: "default ops" };
}

interface OllamaToolCall {
  function: { name: string; arguments?: Record<string, unknown> | string };
}

interface OllamaChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: OllamaToolCall[];
  tool_name?: string;
}

async function callOllama(
  messages: OllamaChatMessage[],
  model: string,
  timeoutMs: number = UPSTREAM_TIMEOUT_MS
): Promise<OllamaChatMessage> {
  const apiKey = process.env.OLLAMA_API_KEY;
  const baseUrl = apiKey
    ? "https://ollama.com/api/chat"
    : "http://localhost:11434/api/chat";

  const res = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      stream: false,
      options: { num_predict: NUM_PREDICT },
      messages,
      tools: TOOLS,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 500);
    throw new Error(`Ollama upstream error ${res.status}: ${detail}`);
  }
  const data = (await res.json()) as { message?: OllamaChatMessage };
  if (!data.message) throw new Error("Ollama returned no message");
  return data.message;
}

/** Parse a tool call's arguments — object OR a stringified JSON object. */
function parseArgs(call: OllamaToolCall): Record<string, unknown> {
  const raw = call.function.arguments;
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object")
        return parsed as Record<string, unknown>;
    } catch {
      // fall through
    }
  }
  return {};
}

export type AgentResult =
  | { kind: "text"; text: string }
  | {
      kind: "confirm";
      /** Text to send above the [Confirm | Cancel] keyboard. */
      text: string;
      pendingId: string;
    };

/**
 * Run one owner message through the agent. Returns either a final text reply
 * or a confirm request (the webhook attaches the inline keyboard and, only
 * after the owner taps Confirm and the action executes, appends the mutation
 * to history). Conversation history is loaded from / persisted to Blob here.
 *
 * Errors are never thrown to the caller — every failure path returns a short
 * graceful text result so the webhook always has something to send.
 */
export async function runAgent(input: {
  chatId: number;
  userText: string;
  deadlineAt: number;
}): Promise<AgentResult> {
  const { chatId, userText, deadlineAt } = input;

  // Degrade gracefully if Blob history is unreadable — runAgent must never throw
  // to its caller (the webhook), so a state read error just means no prior context.
  let history: HistoryMessage[] = [];
  try {
    history = await loadHistory();
  } catch (error) {
    console.error("[agent] loadHistory failed; continuing with empty history:", error);
  }
  const messages: OllamaChatMessage[] = [
    { role: "system", content: buildSystemPrompt() },
    // History carries user/assistant/tool turns; pass tool_name through so the
    // model can attribute prior tool output.
    ...history.map(
      (m): OllamaChatMessage => ({
        role: m.role,
        content: m.content,
        ...(m.tool_name ? { tool_name: m.tool_name } : {}),
      })
    ),
    { role: "user", content: userText },
  ];

  // Most recent validation refusal, kept so that when the round budget runs out
  // with no usable model text the owner still sees WHY nothing happened.
  let lastRefusal: string | null = null;

  // Route once from the owner's intent; the whole run uses this model. Per-call
  // we may downgrade to fast when the deadline is tight, and fall back to fast
  // (latched) if the heavy call errors.
  const route = pickModel({ userText });
  let heavyDisabled = false;
  // One-shot latch: at most ONE heavy-model escalation per runAgent when the
  // fast model bails with a refusal instead of calling a tool.
  let escalated = false;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const finalRound = round === MAX_TOOL_ROUNDS;

    // Deadline gate: never start a model call that could outlive the function's
    // execution budget (it would be killed and Telegram would redeliver the
    // update, double-running the agent).
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs < DEADLINE_MIN_MODEL_MS) {
      const text =
        "Sorry — this one is taking me too long to work through. Please try again in a moment.";
      // Don't persist apology turns (consistent with the model-error paths) — a
      // failed run carries no useful context for the next turn.
      return { kind: "text", text };
    }

    // Budget-aware model choice for THIS call: heavy only when there is room for
    // its (potentially slower) response and it hasn't already failed this run.
    const useHeavy =
      route.heavy && !heavyDisabled && remainingMs >= HEAVY_MIN_REMAINING_MS;
    const callModel = useHeavy ? route.model : fastModel();
    const callTimeout = Math.min(
      UPSTREAM_TIMEOUT_MS,
      remainingMs - REPLY_RESERVE_MS
    );

    let reply: OllamaChatMessage;
    try {
      reply = await callOllama(messages, callModel, callTimeout);
    } catch (error) {
      console.error(`[agent] Model call failed (model=${callModel}):`, error);
      // FAIL SAFE: never lose a request to routing. If the HEAVY model failed,
      // retry once on the fast model — but only if budget still allows a fresh
      // call. Latch heavy off so the remaining rounds skip it.
      heavyDisabled = true;
      const fast = fastModel();
      const retryRemaining = deadlineAt - Date.now();
      if (callModel !== fast && retryRemaining >= DEADLINE_MIN_MODEL_MS) {
        try {
          reply = await callOllama(
            messages,
            fast,
            Math.min(UPSTREAM_TIMEOUT_MS, retryRemaining - REPLY_RESERVE_MS)
          );
        } catch (fallbackError) {
          console.error("[agent] Fast-model fallback also failed:", fallbackError);
          return {
            kind: "text",
            text: "Sorry — my brain is unreachable right now. Please try again in a minute.",
          };
        }
      } else {
        return {
          kind: "text",
          text: "Sorry — my brain is unreachable right now. Please try again in a minute.",
        };
      }
    }

    let toolCalls = reply.tool_calls ?? [];

    // --- Heavy-model escalation on a fast-model bail -------------------------
    // The FAST model sometimes BAILS ("I can't access that", "please rephrase")
    // on a terminal text turn instead of calling a read tool. When that happens
    // — and only if THIS turn ran on fast, heavy is still available, and the
    // deadline allows a fresh call — retry the whole turn ONCE on the heavy
    // model before giving up. Bounded to one escalation per run (`escalated`).
    // If the heavy retry returns tool_calls the loop just continues below (it
    // can now act on them); if it returns text the terminal branch returns it.
    // Never throws: on any escalation error we keep the original fast text.
    // Skip on the final round: if heavy then returns tool_calls they can't run
    // (the final round must return text), so the owner would get the empty-
    // handed fallback instead of the fast reply — a downgrade. And gate on
    // HEAVY_MIN_REMAINING_MS (not the looser DEADLINE_MIN_MODEL_MS) since this
    // fires the slower HEAVY model — same threshold the per-round downgrade uses.
    if (toolCalls.length === 0 && !finalRound && !useHeavy && !heavyDisabled && !escalated) {
      const fastContent = (reply.content || "").trim();
      const escalationRemaining = deadlineAt - Date.now();
      if (
        fastContent &&
        REFUSAL_RE.test(fastContent) &&
        escalationRemaining >= HEAVY_MIN_REMAINING_MS
      ) {
        escalated = true;
        try {
          const heavyReply = await callOllama(
            messages,
            heavyModel(),
            Math.min(UPSTREAM_TIMEOUT_MS, escalationRemaining - REPLY_RESERVE_MS)
          );
          // Adopt the heavy result for the rest of this iteration.
          reply = heavyReply;
          toolCalls = heavyReply.tool_calls ?? [];
        } catch (error) {
          console.error(
            "[agent] Heavy-model escalation failed; keeping fast text:",
            error
          );
          // reply/toolCalls unchanged → the original fast text is returned below.
        }
      }
    }

    if (toolCalls.length === 0 || finalRound) {
      const content = (reply.content || "").trim();
      const text =
        content ||
        (lastRefusal
          ? `I can't do that as asked — ${lastRefusal}. Nothing was queued. Please rephrase and I'll try again.`
          : "Hmm, I came back empty-handed. Could you rephrase that?");
      // Persist only genuine model content — not empty-handed/refusal fallbacks,
      // matching the deadline/model-error paths (apology turns aren't saved).
      if (content) {
        await appendHistory(
          { role: "user", content: userText },
          { role: "assistant", content: text }
        );
      }
      return { kind: "text", text };
    }

    // Mutating call? → pending action + confirm result, loop ends here.
    let refusedThisRound = false;
    for (const call of toolCalls) {
      const name = call.function?.name ?? "";
      const args = parseArgs(call);
      if (!requiresConfirmation(name, args)) continue;

      // Validate/normalize ONCE — the summary and the executor consume the SAME
      // validated object, so what the owner confirms is exactly what executes.
      // Invalid args are REFUSED (never queued): a malformed value could render
      // blank on the confirm card while the executor's String() coercion acts
      // on the real payload (prompt-injection surface).
      const validated = validateMutationArgs(name, args);
      if (!validated.ok) {
        // A fixable slip (e.g. a bad enum). Rounds always remain here
        // (finalRound returned above), so feed REFUSED back as a tool result
        // and let the model self-correct. The owner only sees a refusal if the
        // round budget runs out without usable text (lastRefusal fallback).
        lastRefusal = validated.error;
        messages.push(reply);
        for (const c of toolCalls) {
          messages.push({
            role: "tool",
            tool_name: c.function?.name ?? "",
            content:
              c === call
                ? `REFUSED — ${validated.error}. Nothing was queued or executed. Correct the arguments and call the tool again.`
                : "NOT EXECUTED — another tool call in this turn was refused; correct it and retry.",
          });
        }
        refusedThisRound = true;
        break;
      }

      // Valid mutation → queue it and short-circuit. Do NOT execute, do NOT
      // process any further tool calls, do NOT append history (the webhook
      // appends the mutation to history after it executes on Confirm).
      const summary = describeMutation(name, validated.args);
      const pending = await createPendingAction({
        chatId,
        tool: name,
        args: validated.args,
        summary,
      });
      return {
        kind: "confirm",
        text: `⚠️ Please confirm:\n${summary}`,
        pendingId: pending.id,
      };
    }
    if (refusedThisRound) continue; // refusal fed back — let the model retry

    // All read-only — execute and feed results back into the conversation.
    messages.push(reply);
    for (const call of toolCalls) {
      const name = call.function?.name ?? "";
      const args = parseArgs(call);
      const result = await executeTool(name, args, { chatId });
      messages.push({
        role: "tool",
        tool_name: name,
        content: result.slice(0, 6000),
      });
    }
  }

  // Unreachable (finalRound returns above), but keeps TypeScript satisfied.
  const text = "Something went sideways — please try again.";
  await appendHistory(
    { role: "user", content: userText },
    { role: "assistant", content: text }
  );
  return { kind: "text", text };
}
