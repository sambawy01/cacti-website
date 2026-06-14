/**
 * Minimal Telegram Bot API client (ported/simplified from the Holistic
 * Beauty reference). Plain-text messages (no parse_mode) so unbalanced
 * entities can never bounce. Every call returns a result object or throws on
 * transport error — callers decide what is fatal. For order pushes, failure
 * is non-fatal (the order is already placed).
 */

const API_BASE = "https://api.telegram.org";

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

function botUrl(method: string): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  return `${API_BASE}/bot${token}/${method}`;
}

export interface InlineKeyboard {
  inline_keyboard: { text: string; callback_data: string }[][];
}

export interface TelegramResult {
  ok: boolean;
  status: number;
  result?: unknown;
  description?: string;
}

async function call(method: string, payload: Record<string, unknown>): Promise<TelegramResult> {
  const res = await fetch(botUrl(method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: unknown; description?: string };
  if (!res.ok || !data.ok) {
    console.error(`[telegram] ${method} failed (${res.status}): ${String(data.description).slice(0, 300)}`);
  }
  return { ok: Boolean(data.ok), status: res.status, result: data.result, description: data.description };
}

export function sendMessage(chatId: string | number, text: string, keyboard?: InlineKeyboard): Promise<TelegramResult> {
  const payload: Record<string, unknown> = { chat_id: chatId, text, disable_web_page_preview: true };
  if (keyboard) payload.reply_markup = keyboard;
  return call("sendMessage", payload);
}

export function editMessageText(chatId: string | number, messageId: number, text: string, keyboard?: InlineKeyboard): Promise<TelegramResult> {
  const payload: Record<string, unknown> = { chat_id: chatId, message_id: messageId, text, disable_web_page_preview: true };
  if (keyboard) payload.reply_markup = keyboard;
  return call("editMessageText", payload);
}

export function editMessageReplyMarkup(chatId: string | number, messageId: number, keyboard: InlineKeyboard): Promise<TelegramResult> {
  return call("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: keyboard });
}

export function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<TelegramResult> {
  return call("answerCallbackQuery", { callback_query_id: callbackQueryId, ...(text ? { text } : {}) });
}

/** Show a chat action (e.g. "typing") — auto-clears after ~5s or on the next message. */
export function sendChatAction(
  chatId: string | number,
  action: "typing" | "upload_voice" | "upload_document" = "typing",
): Promise<TelegramResult> {
  return call("sendChatAction", { chat_id: chatId, action });
}

export interface GetFileResult {
  ok: boolean;
  filePath?: string;
  fileSize?: number;
  description?: string;
}

/** Resolve a Telegram file_id to a downloadable file_path (step 1 of 2). */
export async function getFile(fileId: string): Promise<GetFileResult> {
  const res = await fetch(botUrl("getFile"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: { file_path?: string; file_size?: number };
    description?: string;
  };
  if (!res.ok || !data.ok || !data.result?.file_path) {
    console.error(`[telegram] getFile failed (${res.status}): ${String(data.description).slice(0, 300)}`);
    return { ok: false, description: data.description };
  }
  return { ok: true, filePath: data.result.file_path, fileSize: data.result.file_size };
}

/**
 * Download file bytes from Telegram's file endpoint (step 2 of 2).
 * Returns null if the file exceeds `maxBytes` or the download fails.
 * `maxBytes` is enforced both on Content-Length and on the realized buffer.
 */
export async function downloadFile(filePath: string, maxBytes: number): Promise<Uint8Array | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  const res = await fetch(`${API_BASE}/file/bot${token}/${filePath}`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return null;
  const declared = Number(res.headers.get("content-length") || "0");
  if (declared > maxBytes) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) return null;
  return buf;
}

/** Send a document (e.g. generated PDF) to a chat. Multipart upload. */
export async function sendDocument(
  chatId: string | number,
  bytes: Uint8Array,
  filename: string,
  caption?: string,
): Promise<TelegramResult> {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", caption);
  // Re-wrap to Uint8Array<ArrayBuffer>: the param's ArrayBufferLike backing
  // doesn't satisfy BlobPart's ArrayBufferView<ArrayBuffer> without the copy.
  form.append("document", new Blob([new Uint8Array(bytes)]), filename);
  const res = await fetch(botUrl("sendDocument"), {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: unknown; description?: string };
  if (!res.ok || !data.ok) {
    console.error(`[telegram] sendDocument failed (${res.status}): ${String(data.description).slice(0, 300)}`);
  }
  return { ok: Boolean(data.ok), status: res.status, result: data.result, description: data.description };
}
