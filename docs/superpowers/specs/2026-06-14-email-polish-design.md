# Email polish — branding + threading + status stepper

**Date:** 2026-06-14
**Sub-project:** A (of a 4-part email/Telegram/CRM/cart batch)
**Status:** design approved, pending spec review

## Goal

Make the customer order emails (1) visually branded and (2) group into a single
email conversation per order instead of landing as up to 4 separate messages.
As part of the visual work, each status email shows the same 4-step status
stepper the `/track` page uses, so the email mirrors the tracking page at the
moment it was sent.

This is purely a presentation + delivery-header change. No new email *types*,
no copy rewrites beyond what the redesign requires, no change to *when* emails
fire or *who* sends them. Vercel/Resend remains the only sender (Apps Script
still cannot send mail — see [[project-state]]).

## Non-goals

- Live/self-updating email content (email clients freeze content on delivery;
  dynamic images are defeated by Gmail/Apple image proxy caching, and AMP for
  Email is out of scope). The "live" experience comes from threaded updates +
  the always-live "Track your order" button.
- Sender identity changes (From / reply-to stay as-is — owner is happy with them).
- New brand sections (social links, signatures, etc.) — explicitly out of scope.
- Marketing / favorites emails — that is Sub-project C.

## Current state (what we're changing)

- `vercel-app/src/lib/email.ts` — pure template builders
  (`confirmationEmail`, `statusEmail`, `delayEmail`, `declineEmail`), a shared
  `wrap()` shell, and `sendEmail(to, subject, html)` (the Resend POST; never throws).
- Shell today: **navy** (`#2C3E50`) header with a white **text** wordmark
  "Bistro Cloud" — no logo image — and an orange (`#D94E28`) CTA + footer link.
- Call sites:
  - `api/order/route.ts` → confirmation email.
  - `api/telegram/webhook/route.ts` → status (preparing/out/delivered), decline,
    delay, and confirmation-on-approval emails.
- Each `sendEmail` call is an independent Resend message with no threading headers
  and a per-stage subject → up to 4 separate inbox entries per order.
- `/track` stepper (`src/app/pages/Track.tsx`): 4 steps —
  `confirmed` → `preparing` → `out_for_delivery` → `delivered`
  (labels: "Confirmed", "Being prepared", "Out for delivery", "Delivered";
  icons CheckCircle2 / ChefHat / Bike / PackageCheck; current step marked ●).

## Section 1 — Branded look

### 1a. Host the logo publicly
- Add the Bistro Cloud logo PNG to the website repo's `public/` folder
  (e.g. `public/email-logo.png`). Vite copies `public/` to the site root, so it
  serves from the stable, self-owned URL **`https://bistro-cloud.com/email-logo.png`**.
- Self-hosted on our own domain (not imgbb) because it's a permanent brand mark
  that must load in emails indefinitely with no third-party dependency. (imgbb —
  key now in the BC keys doc — is reserved for *dynamic* dish images in Sub-project C.)
- Source asset: the same logo shown in the site header
  (`src/assets/8ed5368e99d26da0c833286cd37634dbfa9feba8.png`) — orange cloud with
  spoon+fork over black "BISTRO CLOUD" text, built for light backgrounds.

### 1b. Restyle the `wrap()` shell
- Header: replace navy bar with a **cream/white header** (`#F9F5F0`) containing the
  centered logo `<img>` (~160px wide, with `alt="Bistro Cloud"` and an explicit
  `width` for clients that block images). Tagline "Fresh. Natural. Delivered Daily."
  beneath in muted gray.
- Body: white background, dark-gray (`#333`) text, generous padding (keep ~600px
  max width, centered).
- Accent: the logo's **orange** (`#D94E28`) used consistently for the CTA button,
  the order Total line, and a thin divider rule.
- Footer: keep current text footer (tagline + bistro-cloud.com link), restyled to
  match.
- All styles remain **inline** (email clients strip `<style>` blocks). Keep using
  `escapeHtml` on all interpolated values.

### 1c. Status stepper component (new)
- Add a pure helper in `email.ts`, e.g. `statusStepper(currentStage)`, that renders
  an inline-HTML/table 4-step bar mirroring `/track`:
  Confirmed → Being prepared → Out for delivery → Delivered.
- Rendering rules: completed steps = orange with a check "✓"; current step = orange,
  bold, marked ●; future steps = muted gray. Use a `<table>` (not flexbox) for
  Outlook compatibility; emoji or simple shapes instead of the React lucide icons.
- Embedded in: confirmation (`confirmed`), status (`preparing` / `out_for_delivery`
  / `delivered`), and delay (current stage unchanged, ETA shown above/below).
- **Not** in the decline email (a declined order has no live stepper) — decline
  keeps its current apologetic layout.

### 1d. Template updates
- `confirmationEmail`: add stepper at `confirmed`; restyle within new shell;
  keep order summary card, payment line, optional Instapay block, track button.
- `statusEmail(status)`: add stepper at `status`; keep heading/body copy.
- `delayEmail`: add stepper at the order's current stage (new field, see below) +
  keep the new-ETA copy.
- `declineEmail`: restyle only (new shell), no stepper.

`delayEmail` currently lacks the current stage. Add an optional `currentStage`
input; the webhook delay path already knows the order's status and can pass it.
If it's ever absent, omit the stepper gracefully (render ETA copy only).

## Section 2 — Threading (one conversation per order)

### 2a. Deterministic Message-ID per order
- Derive a stable RFC Message-ID from the order's tracking token:
  **`<order-{token}@bistro-cloud.com>`**.
- The **first** email for an order (confirmation, or confirmation-on-approval)
  sends with `Message-ID: <order-{token}@bistro-cloud.com>`.
- Every **subsequent** email for that order (preparing, out, delivered, delay)
  sends with `In-Reply-To` **and** `References` set to that same id → clients
  stack them under the original.
- **Decline** email is standalone (no prior confirmation thread to join) — it sends
  with no threading headers, or its own id; either way it does not thread.

### 2b. Constant subject
- All lifecycle emails for an order share one subject string, e.g.
  **`Bistro Cloud — your order`** (a single constant; optionally append a short
  order ref if a friendly one exists, but the *string must be identical* across the
  lifecycle so subject-threading clients also group them).
- Status (confirmed → being prepared → out for delivery → delivered) is conveyed by
  the **stepper + heading + body + preview text**, never the subject.
- Decline keeps its own distinct subject ("we couldn't fit your order in today").

### 2c. `sendEmail` signature change
- Extend to `sendEmail(to, subject, html, opts?)` where `opts` carries threading:
  e.g. `{ messageId?: string }` for the root email and
  `{ inReplyTo?: string; references?: string }` for replies — or a single
  `threadToken` from which `sendEmail` builds the right headers based on a
  `role: 'root' | 'reply'` flag. Final shape decided in the plan; behavior:
  - root → sets `Message-ID`
  - reply → sets `In-Reply-To` + `References`
  - none → current behavior (decline).
- Pass these via Resend's `headers` field in the POST body.

### 2d. Resend header verification + fallback (honesty flag)
- **Risk:** Resend may auto-generate its own `Message-ID` and ignore a custom one.
  Must verify during implementation that Resend honors a custom `Message-ID` /
  `In-Reply-To` / `References` via the `headers` field.
- **If honored:** threading is deterministic across clients. ✅
- **If overridden:** fall back to **consistent-subject + same-sender** threading
  (Gmail and Apple Mail group these well in practice). The constant subject in 2b
  already provides this fallback at no extra cost.
- The plan must include a real send-test to a Gmail account to confirm the thread
  collapses.

## Affected files

- `vercel-app/src/lib/email.ts` — shell restyle, `statusStepper` helper, template
  updates, `sendEmail` threading opts. (Primary.)
- `vercel-app/src/app/api/order/route.ts` — pass root threading opt on confirmation.
- `vercel-app/src/app/api/telegram/webhook/route.ts` — pass reply threading opts on
  status/delay; root opt on confirmation-on-approval; decline unchanged; pass
  `currentStage` to `delayEmail`.
- `public/email-logo.png` (new) — committed logo asset in the **website** repo.
- `vercel-app/src/lib/email.test.ts` — extend.

## Testing

- **Unit (Vitest, in `email.test.ts`):**
  - Each template builder returns the new shell (cream header markup, logo `<img>`
    with the bistro-cloud.com URL, orange accent).
  - `statusStepper(stage)` marks exactly the right step current and prior steps
    complete for each of confirmed/preparing/out_for_delivery/delivered.
  - Subject is the single constant for all lifecycle emails; decline keeps its own.
  - `sendEmail` builds the correct Resend `headers` for root vs reply vs none
    (mock `fetch`, assert the JSON body's `headers`).
  - All builders still `escapeHtml` interpolated values (no XSS regression).
- **Manual:** real Resend send of a full lifecycle (confirm → preparing → out →
  delivered) to a Gmail inbox; verify (a) logo renders, (b) stepper advances,
  (c) all four collapse into one thread. Refund any Loyverse test receipts created.
- `cd vercel-app && npm test` and `npx tsc --noEmit` green before commit.

## Rollout

- Deploy via `cd vercel-app && vercel --prod --yes` (needs explicit owner approval).
- The logo asset ships with the **website** GitHub Pages deploy (push to main) so
  `https://bistro-cloud.com/email-logo.png` is live *before* the Vercel email
  change references it. Sequence: land + deploy the logo asset first, then Vercel.

## Open decisions deferred to the plan

- Exact `sendEmail` opts shape (`role` flag vs explicit header fields).
- Whether to include a short human order ref in the constant subject.
- Stepper visual primitives (emoji vs CSS shapes) — pick the most client-robust.
