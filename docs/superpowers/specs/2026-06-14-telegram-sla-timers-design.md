# Telegram SLA timers — per-stage targets + auto-escalation

**Date:** 2026-06-14
**Sub-project:** B (of the 4-part email/Telegram/CRM/cart batch — see [[email-tg-crm-cart-batch]])
**Status:** design approved, pending spec review

## Goal

Give every order a visible per-stage deadline on its Telegram ticket, and have a
scheduler automatically chase the sales group when a stage runs over its time
limit — even if nobody is looking at Telegram. Stages and limits:

| Stage (waiting to leave) | Limit |
|---|---|
| `pending_approval` → confirmed/declined | 3 min |
| `confirmed` → `preparing` | 5 min |
| `preparing` → `out_for_delivery` | 15 min |
| `out_for_delivery` → `delivered` | 10 min |

Two visible behaviors:
1. **On-ticket target:** each order ticket shows a target time for its current
   stage (e.g. `🎯 Start preparing by 2:35 PM`).
2. **Breach alert + re-nag:** when a stage passes its target, a standalone,
   actionable alert is posted to the group, re-posted every 5 min until the stage
   advances.

## Non-goals

- A live-updating countdown on the ticket (Telegram would require per-minute
  message edits — rejected as noisy/rate-limited). The ticket shows a fixed target.
- SLAs on terminal states (delivered/declined/cancelled).
- Tuning limits from the Google Sheet — limits live in code for v1 (may move to
  the Settings tab later).
- Per-staff assignment / who-owns-which-order. Alerts go to the whole sales group
  (the same `TELEGRAM_OWNER_CHAT_ID = -5336993630` group used today).

## Architecture & data flow

**Scheduler:** Vercel Cron (the project is on Pro, so 1-minute cron is allowed),
configured in a new `vercel-app/vercel.json`:

```json
{ "crons": [ { "path": "/api/cron/sla-check", "schedule": "* * * * *" } ] }
```

**Endpoint:** new `vercel-app/src/app/api/cron/sla-check/route.ts`. On each tick:
1. **Auth:** require Vercel's cron auth — `Authorization: Bearer ${CRON_SECRET}`
   (env var Vercel injects on cron invocations). Reject otherwise with 401.
2. **Operating-hours gate:** if the current Cairo time is outside ≈13:00–23:00,
   return early (`{ ok: true, skipped: "closed" }`). Keeps the every-minute cron a
   cheap no-op overnight and prevents stale-order nagging at 3 AM.
3. **Read** today's active orders from Apps Script (new admin-gated action, below).
4. For each order, run the **pure SLA engine** (below) to decide whether to alert.
5. For each order that is due to alert: post the breach alert to the group
   (Telegram) and write `sla_alerted_at = now` back to Apps Script. All side
   effects are non-fatal and logged; one order's failure must not abort the rest.

**Why Apps Script holds the timestamps:** the order of record lives in the CRM
Google Sheet; the cron is stateless between runs, so the deadline anchor
(`status_changed_at`) and the throttle marker (`sla_alerted_at`) must persist in
the sheet, not in Vercel memory.

## SLA engine (pure, unit-tested)

A pure module `vercel-app/src/lib/sla.ts` with **no I/O** — all "now" values are
injected so it is fully testable.

- `STAGE_LIMITS_MIN: Record<ActiveStatus, number>` =
  `{ pending_approval: 3, confirmed: 5, preparing: 15, out_for_delivery: 10 }`.
  (`confirmed`'s 5 min is the "start preparing within 5 min" target; etc.)
- `ActiveStatus = "pending_approval" | "confirmed" | "preparing" | "out_for_delivery"`.
- `stageDeadline(status, stageEnteredAt: Date): Date` → `stageEnteredAt + limit`.
- `stageActionLabel(status): string` → the human verb for the target line:
  pending_approval → "Approve/decline", confirmed → "Start preparing",
  preparing → "Out for delivery", out_for_delivery → "Deliver".
- `targetLine(status, stageEnteredAt): string` → e.g. `🎯 Start preparing by 2:35 PM`
  (12-hour Cairo time via the existing slot/label formatting helpers).
- `shouldAlert({ status, stageEnteredAt, lastAlertedAt, now }): boolean`:
  - Only for an `ActiveStatus`.
  - `breached = now > stageDeadline(status, stageEnteredAt)`.
  - **First alert:** breached AND (`lastAlertedAt` is null OR `lastAlertedAt <
    stageEnteredAt`, i.e. the marker is from a previous stage).
  - **Re-nag:** breached AND `lastAlertedAt >= stageEnteredAt` AND
    `now - lastAlertedAt >= 5 min`.
  - Returns true in either case, false otherwise.
- `overdueMinutes(status, stageEnteredAt, now): number` → whole minutes past the
  deadline, for the alert text.

Resetting on stage change is implicit: when a transition updates
`status_changed_at` to a newer time, the previous `sla_alerted_at` is now "older
than the stage", so `shouldAlert` treats the new stage as never-alerted.

## Schema changes (Apps Script / Orders sheet)

Add two columns to `CRM_TABS.Orders` (currently ends `…, 'tracking_token',
'status', 'notes'`):
- **`status_changed_at`** — ISO timestamp the order entered its current stage.
- **`sla_alerted_at`** — ISO timestamp of the last breach alert (blank = never).

Writes:
- **Order creation** (`orderPlace` / `addOrderSubmission`): set
  `status_changed_at = timestamp` (creation time), `sla_alerted_at = ''`.
- **Every status transition** (`orderSetStatus`, `orderSetStatusByToken`, and the
  delay path if it changes status): set `status_changed_at = now`. Leave
  `sla_alerted_at` as-is (the engine's "older than stage" check resets it
  logically; no need to clear it on transition).
- **On alert** (new action `orderMarkSlaAlerted(token)` or a field set via the
  existing setter): set `sla_alerted_at = now`.

**Migration:** extend the existing `migrateOrdersTab` to add the two headers.
**Fallback for pre-existing rows:** when `status_changed_at` is blank, the cron
and readers fall back to the order's creation `timestamp`. When `sla_alerted_at`
is blank, treat as never alerted.

**New read action** `slaListActiveOrders` (admin-gated, password = existing
`APPS_SCRIPT_ADMIN_PASSWORD`): returns today's (Cairo) orders whose status is an
`ActiveStatus`, with the fields the cron needs: `id`, `tracking_token`, `status`,
`status_changed_at`, `sla_alerted_at`, `name`, `phone`, `delivery_slot`,
`order_summary`. (May reuse/filter `adminGetOrders` if cleaner.) The Vercel side
calls it through the existing `appsScript` lib with the admin password.

## On-ticket target line

`buildOrderMessage` (`vercel-app/src/lib/orderMessage.ts`) gains a target line for
the current stage, rendered from "now + limit" at the moment the stage is entered:
- Initial post (`order/route.ts`): status is `pending_approval` or `confirmed`.
- Transition edits (Telegram webhook `editMessageText`): the webhook re-renders
  the ticket text after advancing status, so the target line updates to the new
  stage automatically. For terminal statuses (delivered/declined/cancelled) the
  target line is omitted.

The target value shown on the ticket is computed independently of the stored
`status_changed_at` (it equals render-time + limit, and render happens exactly
when the stage is entered), so display does not depend on the new columns. The
stored `status_changed_at` is what the cron uses later.

## Breach alert (Telegram)

A standalone group message (NOT a reply — the order ticket's `message_id` is not
stored, and a self-contained alert is better UX). Built by a new helper in
`orderMessage.ts`, e.g. `buildSlaAlertMessage({ id, name, phone, status,
overdueMin, limitMin })`:

```
⏰ OVERDUE — Order #123
Sara · 0100…
Stage: awaiting approval — 4 min over (target 3 min)
👇 act now
```

with the **same inline keyboard** as the current status
(`keyboardForStatus(status, token)`), so a tap on the alert advances the order
exactly like the original ticket. Posting uses the existing `sendMessage` to
`TELEGRAM_OWNER_CHAT_ID`.

## Error handling

- Endpoint auth failure → 401, no work.
- Apps Script read failure → log, return `{ ok: false }` (cron retries next minute).
- Per-order send/mark failures are caught individually and logged; the loop
  continues. A failed `sla_alerted_at` write means at worst a duplicate alert next
  minute — acceptable, not data loss.
- `maxDuration` set high enough (e.g. 60) for the read + a few sends, mirroring the
  existing order route's setting.

## Testing

- **`sla.test.ts` (pure, injected now):** deadline math per stage; `shouldAlert`
  first-alert vs not-yet-breached vs re-nag-window vs within-5-min-suppressed vs
  stage-reset (lastAlertedAt older than stageEnteredAt); `targetLine` /
  `stageActionLabel` strings; `overdueMinutes`.
- **`api/cron/sla-check/route.test.ts`:** rejects missing/wrong `CRON_SECRET`
  (401); returns early when "closed" (mock Cairo time); given a mix of active
  orders (one breached, one fresh, one terminal), alerts ONLY the breached one,
  attaches the right keyboard, and calls the mark action; non-fatal on a single
  order's send failure.
- **`orderMessage.test.ts`:** target line appears for each active status and is
  omitted for terminal; `buildSlaAlertMessage` content + keyboard.
- **Apps Script:** unit-style checks (existing harness/pattern) that creation and
  transitions write `status_changed_at`, and that `slaListActiveOrders` filters to
  today's active orders. Migration adds the two headers idempotently.
- `cd vercel-app && npm test` and `npx tsc --noEmit` green before commit.

## Rollout

1. Apps Script first: `clasp push --force && clasp deploy -i <@16 id>` so the new
   columns, the transition timestamp writes, and `slaListActiveOrders` are live.
   (Update deployment @16 in place — never make a new deployment; see
   [[project-state]].)
2. Set `CRON_SECRET` in the Vercel project env (used by Vercel Cron + endpoint).
3. Deploy Vercel: `cd vercel-app && vercel --prod` (needs owner approval). Vercel
   registers the cron from `vercel.json` on deploy.
4. Verify: hit `/api/cron/sla-check` manually with the secret during open hours and
   confirm it reads orders and (with a deliberately old test order) posts an alert.

## Open decisions deferred to the plan

- Exact `slaListActiveOrders` shape vs reusing `adminGetOrders` + filtering.
- Whether `orderMarkSlaAlerted` is a dedicated action or a generic field setter.
- The precise operating-hours window bounds (proposed 13:00–23:00 Cairo).
