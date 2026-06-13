import { validateOrderPayload } from "@/lib/validation";
import { placeOrder } from "@/lib/appsScript";
import { telegramConfigured, sendMessage } from "@/lib/telegram";
import { buildOrderMessage, keyboardForStatus } from "@/lib/orderMessage";
import { preflight, jsonWithCors } from "@/lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(): Response {
  return preflight();
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonWithCors({ ok: false, error: "Invalid JSON." }, 400);
  }

  const v = validateOrderPayload(body);
  if (!v.ok) {
    return jsonWithCors({ ok: false, error: v.error }, 400);
  }
  const order = v.value;

  let result;
  try {
    result = await placeOrder({
      name: order.name, phone: order.phone, email: order.email, address: order.address,
      orderTotal: order.orderTotal, orderSummary: order.orderSummary, itemCount: order.itemCount,
      deliverySlot: order.deliverySlot, expectedStatus: order.expectedStatus,
    });
  } catch (err) {
    console.error("[order] Apps Script call failed:", err);
    return jsonWithCors({ ok: false, error: "We couldn't reach our ordering system. Please try again." }, 502);
  }

  if (!result.success) {
    // Capacity/availability rejection — relay the code so the UI reacts.
    return jsonWithCors({ ok: false, code: result.code }, 409);
  }

  // Fan-out: Telegram push to the owner (non-fatal).
  if (telegramConfigured() && process.env.TELEGRAM_OWNER_CHAT_ID) {
    try {
      const text = buildOrderMessage({
        name: order.name, phone: order.phone, email: order.email, address: order.address,
        orderSummary: order.orderSummary, orderTotal: order.orderTotal, itemCount: order.itemCount,
        deliverySlot: order.deliverySlot, paymentMethod: order.paymentMethod,
        trackingToken: result.trackingToken, status: result.status,
      });
      await sendMessage(process.env.TELEGRAM_OWNER_CHAT_ID, text, keyboardForStatus(result.status, result.trackingToken));
    } catch (err) {
      console.error("[order] Telegram push failed (non-fatal):", err);
    }
  }

  const response: Record<string, unknown> = {
    ok: true,
    status: result.status,
    trackingToken: result.trackingToken,
    deliverySlot: result.deliverySlot,
    paymentMethod: order.paymentMethod,
  };
  if (order.paymentMethod === "instapay") {
    response.instapay = process.env.INSTAPAY_DETAILS || "Ask us for bank transfer details.";
  }
  return jsonWithCors(response, 200);
}
