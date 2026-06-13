# On-Site Confirmed Checkout — Phase 1 Design Spec

**Date:** 2026-06-13
**Status:** Approved design, pending implementation plan
**Part of:** a 3-phase evolution of the bistro-cloud.com order flow. This spec covers **Phase 1 only**.

## Background

The order flow currently shipped (2026-06-12/13) enforces kitchen capacity via a Google Apps Script backend and Google Sheets, but **checkout still hands off to WhatsApp** — the customer is sent to WhatsApp to "confirm," so an order is not a firm on-site sale. Email is optional. Orders are not pushed to the POS, a kitchen display, or Telegram.

The owner wants checkout to become a **confirmed on-site sale** that fans out to multiple systems. A reference implementation exists in the owner's other project, **Holistic Beauty** (`https://github.com/sambawy01/Holistic-Beauty-Website-`): a Next.js backend on Vercel doing on-site cash-on-delivery checkout, email (Resend), Telegram order push with one-tap admin action buttons, and order storage on Vercel Blob. That project is cash-on-delivery only — so it provides reusable patterns for checkout, Telegram, and email.

**No online payment capture is required.** Card payments are taken **at delivery on the driver's portable POS terminal** (card-on-delivery), so every payment method settles at handover or by manual transfer — there is no payment gateway anywhere in the roadmap.

## Phased roadmap (context)

- **Phase 1 (this spec):** On-site confirmed checkout; mandatory email; payment = Cash on Delivery + Card on Delivery (driver POS) + Instapay (show bank info); fan-out to email + Telegram; capacity/admin/calendar preserved.
- **Phase 2 (future):** Loyverse POS integration; each confirmed order pushed into Loyverse, whose Kitchen Display System becomes the kitchen display. Needs Loyverse API access + menu-to-Loyverse item mapping.

(A previously-considered Phase 3 — an online card-payment gateway — is **dropped**: card is settled on delivery via the driver's POS, so online prepayment is not needed.)

Each phase is its own spec → plan → build cycle.

## Goals (Phase 1)

1. Checkout completes **on the website** and produces a firm order — no WhatsApp handoff in the happy path.
2. **Email is mandatory** so every customer can receive delivery updates.
3. Payment choice at checkout: **Cash on Delivery**, **Card on Delivery** (paid on the driver's POS terminal at handover), or **Instapay** (shows the owner's bank/account details for a manual transfer). All settle at delivery/transfer — no online capture.
4. On placement, the order fans out to **email** (customer confirmation + status updates) and **Telegram** (owner push with one-tap status actions).
5. **Preserve** the capacity engine, admin OrdersTab, kitchen calendar, and the single source of truth (Google Sheets) — reuse, don't replace.

## Non-goals (Phase 1)

- Online payment capture / a payment gateway — **not needed at all** (card is paid on the driver's POS at delivery).
- Loyverse POS and a real Kitchen Display System (Phase 2) — the existing kitchen Google Calendar is the interim display.
- Migrating order storage off Google Sheets, or re-implementing capacity on Vercel.
- Resend / a new email service — Phase 1 reuses the existing Apps Script email.
- Automated Instapay reconciliation (transfers are confirmed out-of-band by the owner).

## Architecture (Approach A — Vercel orchestrates, Apps Script stays authority)

```
React + Vite site (GitHub Pages)
  Cart → on-site checkout form  ──POST /api/order──▶  Vercel / Next.js backend (NEW)
  Done screen (tracking + pay info) ◀── result ──┘        │
                                                          │ 1. validate (mandatory email)
                                                          │ 2. call Apps Script placeOrder (channel=web)
                                                          │ 3. Telegram push to owner (one-tap actions)
                                                          ▼
                                            Apps Script backend (EXISTING, unchanged logic)
                                              placeOrder: capacity lock → Orders sheet
                                                          → kitchen Google Calendar
                                                          → customer confirmation email
                                            setOrderStatus: status changes + status emails
                                                          ▼
                                              Google Sheets CRM (source of truth)
                                              Telegram button taps ──▶ /api/telegram/webhook ──▶ setOrderStatus
```

The Vercel backend is intentionally **thin** in Phase 1 (checkout proxy + Telegram). It is the foundation that Phases 2–3 thicken (Loyverse, card-gateway webhooks). Capacity, storage, calendar, and email stay in Apps Script.

## Components

### A. Vercel/Next.js backend (new)

Lives in a `vercel-app/` directory in the Bistro Cloud repo (mirroring Holistic Beauty's layout) on its own Vercel project. TypeScript, Next.js App Router, nodejs runtime.

- **`POST /api/order`** — the order endpoint.
  - Validates payload: `items[]`, `name`, `phone`, `email` (**required**, regex-validated), `address`, `deliverySlot` ('HH:mm'), `expectedStatus` ('open'|'busy'), `paymentMethod` ('cod'|'card_on_delivery'|'instapay'), optional `note`.
  - Rejects with a clear error if email is missing/invalid or required fields fail.
  - Calls Apps Script `placeOrder` with `channel=web` (see Apps Script changes). Receives `{success, status, trackingToken, deliverySlot, deliveryDate}` or a failure code (`slot_full`, `slot_unavailable`, `busy_retry`, `daily_limit`).
  - On success: fires the Telegram push (non-fatal on failure).
  - Returns to the frontend: `{ ok, status, trackingToken, paymentMethod, instapay?: {details} }`. For `paymentMethod==='instapay'`, includes the configured bank details for the done screen.
  - On Apps Script failure: returns the failure code so the frontend shows the correct message (slot just filled → refresh picker; daily limit / busy → guidance; generic → support fallback).
- **`POST /api/telegram/webhook`** — receives Telegram callback queries from the action buttons.
  - Verifies the Telegram webhook secret header.
  - The button's `callback_data` carries the order's **tracking token** (a UUID, ~36 chars, well within Telegram's 64-byte `callback_data` limit) plus the target status (e.g., `approve`/`decline`/`preparing`/`out_for_delivery`/`delivered`/`cancel`).
  - Calls Apps Script `setOrderStatusByToken(token, status)` (see Apps Script changes) — a token-keyed status setter, so the webhook never depends on a volatile sheet row index.
  - Edits the original Telegram message to reflect the new status; answers the callback query.
- **`lib/appsScript.ts`** — typed client for the Apps Script web app (`placeOrder`, `setOrderStatusByToken`). Holds the Apps Script URL + admin password from env.
- **`lib/telegram.ts`** — Telegram Bot API helpers (sendMessage with inline keyboard, editMessageText, answerCallbackQuery), ported from Holistic Beauty.
- **`lib/orderMessage.ts`** — builds the Telegram order message text + inline keyboard from an order.
- **`lib/validation.ts`** — shared field validation (email/phone regex, lengths), ported from Holistic Beauty's order validation.

Env vars (names only): `APPS_SCRIPT_URL`, `APPS_SCRIPT_ADMIN_PASSWORD`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET`, `INSTAPAY_DETAILS`.

### B. Apps Script backend (minimal change)

- `placeOrder` gains an optional `channel` param. When `channel === 'web'`, it **skips the internal owner-notification email** (`sendInternalNotification`) — Telegram now covers owner alerts — but still creates the kitchen calendar event and sends the **customer** confirmation email. The success result is extended to include the order **id** (so Vercel can build callback data if needed). All capacity/lock/storage logic is unchanged.
- New **`setOrderStatusByToken(token, newStatus)`** action: looks up the Orders row by `tracking_token`, then applies the **existing `orderSetStatus` logic** (same side effects — confirm/decline/status emails, kitchen calendar, Pipeline sync, cache invalidation). This gives the Telegram webhook a stable, row-index-independent way to change status. It is password-gated like the other admin actions. `orderSetStatus` (row-index based) remains for the admin panel.

### C. React frontend (CartDrawer + done view)

- **Email field becomes required** (validated client-side; the placeholder/label marks it required).
- **Payment selector**: Cash on Delivery, Card on Delivery (driver POS), and Instapay. All three are valid Phase 1 options (none capture payment online).
- **Checkout button**: "Place Order" replaces "Checkout via WhatsApp". On click it POSTs to Vercel `/api/order` (the capacity-aware slot picker and ASAP logic are unchanged). The synchronous-`window.open`/WhatsApp machinery is removed from the happy path.
- **Done view** (new): on success, replace the cart contents with a confirmation panel — order confirmed, the tracking link (`/track?token=…`), and payment instructions per method (COD: "Pay cash on delivery"; Card on Delivery: "Pay by card on the driver's terminal at delivery"; Instapay: the bank details returned by the API + "transfer and we'll confirm"). For `pending_approval`, the panel says the time is busy and will be confirmed shortly.
- **Failure handling**: on an API error, show a message and a WhatsApp support link (fallback only); the cart is **not** cleared so the customer can retry.
- A new `orderService` method `placeOrderOnSite(input)` POSTs to the Vercel endpoint and returns the typed result.

## Data flow (happy path)

1. Customer submits checkout (valid email, COD / Card on Delivery / Instapay) → `POST /api/order`.
2. Vercel validates → calls Apps Script `placeOrder?channel=web` → capacity lock → writes Orders/Pipeline rows (slot stored as text per the V18 fix) → kitchen calendar event → customer confirmation email.
3. Vercel sends Telegram push to owner with the order + status buttons.
4. Vercel returns `{ ok, status, trackingToken, paymentMethod, instapay? }`.
5. Frontend shows the done view; cart cleared on success.
6. Owner taps a Telegram button → `/api/telegram/webhook` → `setOrderStatus` → status email to customer + tracking page updates.

## Error handling

- **Mandatory email missing/invalid**: rejected client-side and server-side; never reaches Apps Script.
- **Capacity busy (open slot raced)**: `placeOrder` returns `slot_full` → Vercel relays it → frontend refreshes the picker and asks the customer to repick (cart intact).
- **Busy slot chosen knowingly**: `pending_approval` → done view explains it; Telegram push shows Approve/Decline.
- **Daily limit / paused**: relayed codes → frontend shows the matching guidance.
- **Vercel→Apps Script call fails** (network/5xx): Vercel returns a generic failure; frontend shows "couldn't place your order" + WhatsApp support link; cart intact.
- **Telegram push fails**: non-fatal — order already persisted; owner still has email + admin panel. Logged.
- **Telegram webhook bad secret**: rejected. Unknown order/row: answered with an error toast in Telegram, no status change.

## Testing

- **Vercel `/api/order`**: payload validation (esp. mandatory email), correct Apps Script call with `channel=web`, success mapping, each failure code mapped, Telegram push invoked, Telegram failure non-fatal.
- **Vercel webhook**: secret verification, each button → correct `setOrderStatus` call, message edit.
- **Frontend**: checkout form blocks submit without a valid email; done-view variants (COD / Card on Delivery / Instapay / pending_approval); failure keeps the cart and shows fallback.
- **Live QA**: a real on-site order end-to-end → confirms a row in the Orders sheet (slot stored correctly), a kitchen calendar event, a customer confirmation email, and a Telegram push whose buttons drive status changes + status emails. Clean up test data after.

## Open configuration (owner provides; not design)

- Telegram bot token + owner chat ID (reuse the Holistic Beauty bot or create a new one) + a webhook secret.
- Instapay bank/account details to display.
- A Vercel project for the new backend; the Apps Script web-app URL + admin password as env vars.

## Reuse map (from Holistic Beauty)

- **Port with light adaptation:** `lib/telegram.ts`, the Telegram order-message + inline-keyboard pattern, the webhook callback handler, field validation regexes, the on-site checkout form UX and done-screen pattern.
- **Do not port:** Vercel Blob order storage, Resend email, the Next.js order-persistence/catalog layer — Bistro Cloud keeps Google Sheets + Apps Script email (Approach A).
