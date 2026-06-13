import { timingSafeEqual } from "node:crypto";
import { setOrderStatusByToken } from "@/lib/appsScript";
import { answerCallbackQuery, editMessageText } from "@/lib/telegram";
import { actionToStatus } from "@/lib/orderMessage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TgCallback {
  id: string;
  data?: string;
  message?: { message_id: number; chat: { id: number }; text?: string };
}
interface TgUpdate {
  update_id?: number;
  callback_query?: TgCallback;
  message?: unknown;
}

function secretOk(received: string | null): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected || !received) return false;
  const a = Buffer.from(received, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    timingSafeEqual(a, a); // constant-time even on length mismatch
    return false;
  }
  return timingSafeEqual(a, b);
}

const STATUS_LABEL: Record<string, string> = {
  confirmed: "✅ Confirmed",
  declined: "❌ Declined",
  preparing: "👨‍🍳 Being prepared",
  out_for_delivery: "🛵 Out for delivery",
  delivered: "📦 Delivered",
  cancelled: "🚫 Cancelled",
};

export async function POST(request: Request): Promise<Response> {
  if (!secretOk(request.headers.get("X-Telegram-Bot-Api-Secret-Token"))) {
    return new Response("unauthorized", { status: 401 });
  }

  let update: TgUpdate;
  try {
    update = (await request.json()) as TgUpdate;
  } catch {
    return new Response("ok", { status: 200 }); // never make Telegram redeliver
  }

  const cb = update.callback_query;
  if (!cb || !cb.data || !cb.message) {
    return new Response("ok", { status: 200 });
  }

  if (process.env.TELEGRAM_OWNER_CHAT_ID && String(cb.message.chat.id) !== process.env.TELEGRAM_OWNER_CHAT_ID) {
    return new Response("ok", { status: 200 });
  }

  const [action, token] = cb.data.split(":");
  const status = actionToStatus(action || "");
  if (!status || !token) {
    await answerCallbackQuery(cb.id, "Unknown action").catch(() => {});
    return new Response("ok", { status: 200 });
  }

  try {
    const r = await setOrderStatusByToken(token, status);
    if (r.success) {
      const original = cb.message.text || "Order";
      await editMessageText(cb.message.chat.id, cb.message.message_id, `${original}\n\n— ${STATUS_LABEL[status] || status}`);
      await answerCallbackQuery(cb.id, STATUS_LABEL[status] || status);
    } else {
      await answerCallbackQuery(cb.id, r.error || "Update failed");
    }
  } catch (err) {
    console.error("[webhook] status update failed:", err);
    await answerCallbackQuery(cb.id, "Update failed").catch(() => {});
  }

  return new Response("ok", { status: 200 });
}
