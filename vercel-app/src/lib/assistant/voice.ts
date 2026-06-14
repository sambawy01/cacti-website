/**
 * Voice-note transcription for the Bistro Cloud owner agent — Groq Whisper.
 *
 * The owner can send a Telegram voice note (OGG/Opus) instead of typing; the
 * webhook (Task 10) owns Telegram's `getFile`/`downloadFile` hop, downloads the
 * bytes, and hands them here. We transcribe with Groq's `whisper-large-v3-turbo`
 * (OpenAI-compatible multipart endpoint) and feed the transcript into the SAME
 * text agent loop as a typed message — so a spoken "confirm tomorrow's orders"
 * goes through the identical confirm gate.
 *
 * - Language: AUTO (no language param) — Whisper detects EN vs AR itself, which
 *   matches the owner's mix.
 * - Degrades gracefully: with no GROQ_API_KEY the webhook tells the owner voice
 *   is unavailable instead of crashing. The key is already provisioned in prod
 *   (used by the website chat).
 * - Caps: oversize audio is rejected BEFORE the upload (a friendly message, not
 *   a timeout).
 */

/** Groq's OpenAI-compatible transcription endpoint. */
const GROQ_TRANSCRIBE_URL =
  "https://api.groq.com/openai/v1/audio/transcriptions";

/** The transcription model (confirmed available on this account). */
export const VOICE_MODEL = "whisper-large-v3-turbo";

/**
 * Hard cap on audio we'll upload (bytes). Telegram voice notes are tiny (Opus
 * ~1KB/s), so 20 MB is already minutes of speech; anything larger is rejected
 * with a clear message rather than risking a slow upload near the webhook
 * deadline. (Groq's own limit is higher; this is our conservative gate.)
 */
export const MAX_VOICE_BYTES = 20 * 1024 * 1024;

/**
 * Hard cap on voice-note DURATION (seconds). This entry point only receives the
 * already-downloaded bytes (not Telegram's reported `duration`), so the
 * duration gate is enforced by the webhook BEFORE download; here we enforce the
 * conservative 20 MB byte cap. Exported so the webhook can apply this limit.
 */
export const MAX_VOICE_SECONDS = 300;

/** Per-request upstream timeout for the Groq call. */
const TRANSCRIBE_TIMEOUT_MS = 30_000;

/**
 * Budget reserved for the agent loop AFTER transcription (ms). Transcription is
 * the last I/O before the agent runs, so we never let the Groq call extend past
 * `deadlineAt − this`, and fail fast below this floor — a SIGKILL at the
 * webhook's maxDuration would answer no 2xx and make Telegram redeliver.
 */
const TRANSCRIBE_DEADLINE_RESERVE_MS = 20_000;
/** Don't start the Groq call with less than this much time; fail fast instead. */
const MIN_TRANSCRIBE_TIMEOUT_MS = 3_000;

/** Is voice transcription usable right now? (Needs a Groq API key.) */
export function voiceEnabled(): boolean {
  return Boolean((process.env.GROQ_API_KEY || "").trim());
}

export type TranscriptionOutcome =
  | { ok: true; text: string }
  | {
      ok: false;
      reason: "disabled" | "too-large" | "empty" | "upstream" | "too-slow";
    };

/**
 * Transcribe voice-note bytes to text via Groq Whisper. Never throws — every
 * failure path returns a typed `{ ok:false, reason }` the webhook maps to a
 * friendly reply.
 *
 * @param bytes      Already-downloaded voice-note bytes (the webhook owns the
 *                   Telegram getFile/downloadFile hop).
 * @param deadlineAt Epoch-ms wall-clock deadline for the whole webhook turn; the
 *                   Groq call is capped to leave room for the agent loop after.
 */
export async function transcribeVoice(
  bytes: Uint8Array,
  deadlineAt: number
): Promise<TranscriptionOutcome> {
  const key = (process.env.GROQ_API_KEY || "").trim();
  if (!key) return { ok: false, reason: "disabled" };
  if (bytes.length === 0) return { ok: false, reason: "empty" }; // nothing to transcribe
  if (bytes.length > MAX_VOICE_BYTES) return { ok: false, reason: "too-large" };

  // Deadline-aware timeout: cap at min(default, remaining − reserve). If too
  // little of the webhook budget remains, fail fast ("too-slow") rather than
  // risk the maxDuration kill → Telegram redelivery.
  const budget = deadlineAt - Date.now() - TRANSCRIBE_DEADLINE_RESERVE_MS;
  if (budget < MIN_TRANSCRIBE_TIMEOUT_MS) return { ok: false, reason: "too-slow" };
  const timeoutMs = Math.min(TRANSCRIBE_TIMEOUT_MS, budget);

  // Copy into a fresh ArrayBuffer-backed view: the incoming Uint8Array may be
  // backed by a SharedArrayBuffer (not a valid BlobPart under strict types).
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);

  const form = new FormData();
  form.append(
    "file",
    new Blob([body], { type: "audio/ogg" }),
    "voice.ogg"
  );
  form.append("model", VOICE_MODEL);
  // JSON response, deterministic decoding. NO language param → auto-detect
  // (handles the owner's EN + AR mix).
  form.append("response_format", "json");
  form.append("temperature", "0");

  try {
    const res = await fetch(GROQ_TRANSCRIBE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      console.error(`[voice] Groq transcription ${res.status}: ${detail}`);
      return { ok: false, reason: "upstream" };
    }
    const data = (await res.json().catch(() => ({}))) as { text?: unknown };
    const text = typeof data.text === "string" ? data.text.trim() : "";
    if (!text) return { ok: false, reason: "empty" };
    return { ok: true, text };
  } catch (error) {
    // A blown AbortSignal.timeout is the common "Groq was slow" case — report it
    // as too-slow (not a generic service error) so the webhook's reply is honest.
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      console.error("[voice] Groq transcription timed out:", error);
      return { ok: false, reason: "too-slow" };
    }
    console.error("[voice] Groq transcription failed:", error);
    return { ok: false, reason: "upstream" };
  }
}
