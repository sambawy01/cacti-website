import { after } from "next/server";
import { validateOrderPayload, type ValidatedOrder } from "@/lib/validation";
import { placeOrder, orderFinalize } from "@/lib/appsScript";
import { telegramConfigured, sendMessage } from "@/lib/telegram";
import { buildOrderMessage, keyboardForStatus } from "@/lib/orderMessage";
import { preflight, jsonWithCors } from "@/lib/cors";
import { loyverseConfigured, pushReceipt } from "@/lib/loyverse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The shape of a successful placeOrder() result (trackingToken + status etc.). */
type PlaceOrderSuccess = { success: true; status: "confirmed" | "pending_approval"; trackingToken: string; deliverySlot: string; deliveryDate: string; id?: number };

/**
 * Everything that does NOT need to block the customer's "Place Order" response:
 *  1. orderFinalize — Apps Script kitchen calendar + confirmation email + Customers upsert.
 *  2. Telegram push to the owner.
 *  3. Loyverse receipt (confirmed orders only).
 *
 * Run via `after()` so the HTTP response is already sent. Each step is wrapped
 * so one failure never stops the others, and nothing here can throw (the route
 * has already returned 200). Exported so it can be unit-tested directly.
 */
export async function runOrderSideEffects(order: ValidatedOrder, result: PlaceOrderSuccess): Promise<void> {
  // 1. Finalize in Apps Script (calendar + confirmation email + Customers upsert).
  try {
    const instapay = order.paymentMethod === "instapay" ? (process.env.INSTAPAY_DETAILS || "") : undefined;
    await orderFinalize(result.trackingToken, instapay);
  } catch (err) {
    console.error("[order] orderFinalize failed (non-fatal):", err);
    if (telegramConfigured() && process.env.TELEGRAM_OWNER_CHAT_ID) {
      await sendMessage(
        process.env.TELEGRAM_OWNER_CHAT_ID,
        `⚠️ Order finalize failed (calendar/email may not have sent): ${err instanceof Error ? err.message : "unknown error"}`,
      ).catch(() => {});
    }
  }

  // 2. Telegram push to the owner (non-fatal).
  if (telegramConfigured() && process.env.TELEGRAM_OWNER_CHAT_ID) {
    try {
      const text = buildOrderMessage({
        name: order.name, phone: order.phone, email: order.email, address: order.address,
        orderSummary: order.orderSummary, orderTotal: order.orderTotal, itemCount: order.itemCount,
        deliverySlot: order.deliverySlot, paymentMethod: order.paymentMethod,
        trackingToken: result.trackingToken, status: result.status, note: order.note,
        location: order.location,
      });
      await sendMessage(process.env.TELEGRAM_OWNER_CHAT_ID, text, keyboardForStatus(result.status, result.trackingToken));
    } catch (err) {
      console.error("[order] Telegram push failed (non-fatal):", err);
    }
  }

  // 3. Push CONFIRMED orders to Loyverse as a completed receipt (non-fatal).
  // pending_approval orders are pushed later, on owner approval (Telegram webhook).
  if (result.status === "confirmed" && loyverseConfigured()) {
    try {
      const r = await pushReceipt({
        items: order.items,
        name: order.name,
        phone: order.phone,
        address: order.address,
        deliverySlot: order.deliverySlot,
        paymentMethod: order.paymentMethod,
        orderTotal: order.orderTotal,
        trackingToken: result.trackingToken,
        location: order.location,
      });
      if (!r.ok) {
        console.error("[order] Loyverse push failed (non-fatal):", r.error);
        if (telegramConfigured() && process.env.TELEGRAM_OWNER_CHAT_ID) {
          await sendMessage(
            process.env.TELEGRAM_OWNER_CHAT_ID,
            `⚠️ Order didn't sync to Loyverse: ${r.error || "unknown error"}`,
          ).catch(() => {});
        }
      }
    } catch (err) {
      console.error("[order] Loyverse push threw (non-fatal):", err);
    }
  }
}

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

  if (order.paymentMethod === "instapay" && !process.env.INSTAPAY_DETAILS) {
    console.error("[order] INSTAPAY_DETAILS env var is not set — instapay confirmation email will have no bank details");
  }

  let result;
  try {
    result = await placeOrder({
      name: order.name, phone: order.phone, email: order.email, address: order.address,
      orderTotal: order.orderTotal, orderSummary: order.orderSummary, itemCount: order.itemCount,
      deliverySlot: order.deliverySlot, expectedStatus: order.expectedStatus, note: order.note,
      location: order.location,
      paymentMethod: order.paymentMethod,
      instapayDetails: order.paymentMethod === "instapay" ? (process.env.INSTAPAY_DETAILS || "") : undefined,
    });
  } catch (err) {
    console.error("[order] Apps Script call failed:", err);
    return jsonWithCors({ ok: false, error: "We couldn't reach our ordering system. Please try again." }, 502);
  }

  if (!result.success) {
    // Capacity/availability rejection — relay the code so the UI reacts. No deferred work.
    return jsonWithCors({ ok: false, code: result.code }, 409);
  }

  // Respond to the customer NOW. The slow fan-out (calendar, email, Telegram,
  // Loyverse) runs after the response is flushed, so "Place Order" returns as
  // soon as capacity is confirmed and the order + tracking token are written.
  after(() => runOrderSideEffects(order, result as PlaceOrderSuccess));

  return jsonWithCors({
    ok: true,
    status: result.status,
    trackingToken: result.trackingToken,
    deliverySlot: result.deliverySlot,
    paymentMethod: order.paymentMethod,
  }, 200);
}
