# Delay / New-ETA Feature — Design Spec

**Date:** 2026-06-13
**Status:** Approved design (owner chose "+15/+30/+60 ETA"). Small addition to the existing Telegram order flow.

## Goal

When the kitchen is running late, the owner taps a **"Running late"** button on the order in Telegram, picks **+15 / +30 / +60 min**, and the customer is told the new delivery time (email) and the tracking page reflects it. No customer-facing action; one extra tap for the owner.

## Flow

1. Confirmed and Being-prepared orders show a **"⏰ Running late"** button (added to their inline keyboard) alongside the existing status buttons.
2. Tapping it (`delay:<token>`) replaces the keyboard with delay choices: **+15 min**, **+30 min**, **+60 min**, and **⬅ Back**. Message text unchanged.
3. Tapping a choice (`delay15|delay30|delay60:<token>`):
   - Calls Apps Script `delayOrder(token, minutes)` → shifts the order's `delivery_slot` forward by N minutes, sends the customer a "running late, new ETA" email, returns the new slot.
   - The Telegram message is edited to append "⏰ Delayed → new ETA <h:mm AM/PM>" and the keyboard is restored to the order's normal status keyboard (so the owner can advance status or delay again).
4. Tapping **⬅ Back** (`delayback:<token>`) restores the normal status keyboard without changing anything.

## Components

### Apps Script (`apps-script/admin-api.gs`)
- New **`delayOrder(token, minutes)`** (admin-gated action `delayOrder`):
  - Find the order row by `tracking_token`. If not found → `{success:false}`.
  - Parse current `delivery_slot` ('HH:mm'); new minutes = slotMinutes + N; clamp to ≤ 23:59. Format new 'HH:mm'.
  - Write the new `delivery_slot` to the cell **as text** (setNumberFormat '@' then setValue — same coercion-safety as orderPlace).
  - Send the customer a delay email (new `sendDelayEmail(orderInfo, oldSlot, newSlot)`) — only if an email is on the order.
  - Return `{success:true, oldSlot, newSlot, newSlotLabel}`.
- New **`sendDelayEmail`**: short branded email — "Your order is running a little late. New estimated delivery: <newSlotLabel> (was <oldSlotLabel>). Thanks for your patience!" + the tracking link. **Sent via Resend** (the shared `sendCustomerEmail` helper introduced by the email-deliverability fix, which goes out first).
- Wire `case 'delayOrder':` into the password-gated `doGet` switch.

### Vercel webhook (`vercel-app/src/app/api/telegram/webhook/route.ts` + `lib`)
- `lib/orderMessage.ts`:
  - `keyboardForStatus('confirmed'|'preparing', token)` gains a second row: `[{ '⏰ Running late', 'delay:'+token }]`.
  - New `delayKeyboard(token)` → `[[+15 (delay15), +30 (delay30), +60 (delay60)], [⬅ Back (delayback)]]`.
  - The action parser recognizes `delay`, `delay15`, `delay30`, `delay60`, `delayback` (these are NOT status changes).
- `lib/appsScript.ts`: new `delayOrder(token, minutes)` client (admin password) → returns `{success, newSlotLabel?}`.
- Webhook handler: branch on the delay actions —
  - `delay` → answer the callback; `editMessageReplyMarkup`/`editMessageText` to show `delayKeyboard`. No state change.
  - `delay15|30|60` → call `delayOrder(token, N)`; on success edit the message (append the new-ETA line) and restore `keyboardForStatus(currentStatus, token)` — fetch the current status via the existing `getOrderStatus` (admin) to rebuild the right keyboard; answer the callback "ETA +N min".
  - `delayback` → fetch status, restore `keyboardForStatus(status, token)`.
  - Owner-id check still applies; always answer 200.

### Tracking page
No change needed — `getOrderStatus` already returns `deliverySlot`, which is now the new (delayed) time, so the tracking page shows the updated ETA automatically. (Optional future: a "delivery time updated" note; not in scope.)

## Capacity note
Shifting `delivery_slot` moves the order into a later hour's capacity bucket. This is semantically correct (the order now delivers later) and delays are occasional, so the minor availability re-computation is acceptable. The original kitchen-calendar event is left at the old time (calendar is interim until Loyverse KDS; not worth moving).

## Non-goals
- Customer-initiated reschedule. Owner-only.
- Moving the kitchen calendar event.
- A custom delay amount (only +15/+30/+60).
- Pending-approval or out-for-delivery/delivered orders showing the delay button (only confirmed + preparing — the prep window is where delays matter).

## Testing
- `delayOrder`: unit-style not feasible in Apps Script; validate live — delay a test order, confirm `delivery_slot` advances by N (stored as text), the customer email arrives with the new ETA, and the tracking page shows the new time.
- Vercel: unit tests for the keyboard (Running late row present on confirmed/preparing; delayKeyboard buttons + tokens), the action parser (delay actions recognized, not treated as status), and the webhook (delay → shows delayKeyboard no state change; delay30 → calls delayOrder + restores keyboard; delayback → restores; failure non-fatal, 200).
- Live: place a test order → tap Running late → +30 → confirm new ETA in Telegram + email + tracking; clean up.
