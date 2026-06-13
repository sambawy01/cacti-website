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

export function editMessageText(chatId: string | number, messageId: number, text: string): Promise<TelegramResult> {
  return call("editMessageText", { chat_id: chatId, message_id: messageId, text, disable_web_page_preview: true });
}

export function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<TelegramResult> {
  return call("answerCallbackQuery", { callback_query_id: callbackQueryId, ...(text ? { text } : {}) });
}
