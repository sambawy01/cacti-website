# Owner-DM Telegram Agent — Design

**Date:** 2026-06-14
**Status:** Design (awaiting user review → writing-plans)
**Related:** ports ~80% of the "Vassili" agent from `sambawy01/Holistic-Beauty-Website-`; shares the order backend with [SLA timers](2026-06-14-telegram-sla-timers-design.md) and the Kitchen Display (separate future sub-project).

## 1. Goal

Give the owner a private, conversational Telegram assistant (in DM with the existing `@CarlitoBC_bot`) that understands plain language (text, **voice**, **photos**, **PDFs**), answers questions about the live business, and performs operational actions **behind a Confirm tap**. It reuses the existing bot and backend — the Sales-group order tickets and SLA alerts are unchanged.

## 2. Scope

**v1 (this spec) — the full agent:**
- Free-text chat + reasoning (Ollama agent loop with tool-calling).
- **Read** tools: orders & status, capacity/slots left, revenue (today/week), customer lookup & history, menu & stock.
- **Act** tools (confirm-gated): approve/decline/advance/delay orders, mark menu item out-of-stock, approve/reject requisitions, **broadcast to the Sales group**.
- **Voice:** voice notes transcribed (Groq Whisper, auto EN/AR) → treated as typed commands.
- **Vision:** photos analyzed (Gemini-3); receipts → **log expense** (confirm-gated); dish/product photos identified.
- **Documents:** inbound PDF → text extracted → fed to the agent.
- **Owner-only**, bound via `/start <ADMIN_PASS>`; **all group messages ignored**.

**Non-goals (v1):** customer-facing chat; staff commanding the agent in the group; TTS/voice replies; the Kitchen Display (separate sub-project); multi-owner/staff roles.

## 3. Architecture

Extend the **existing** `/api/telegram/webhook` route (do **not** add a second route). It already authenticates Telegram (`X-Telegram-Bot-Api-Secret-Token` vs `TELEGRAM_WEBHOOK_SECRET`, constant-time, fails closed) and handles order-button callbacks. We add message routing + new confirm-gate callbacks. Runtime `nodejs`, `dynamic = "force-dynamic"`, raise `maxDuration` to ~90s for model/IO budget.

```
Telegram → /api/telegram/webhook (secret-gated, returns 200 fast)
  ├─ callback_query
  │    ├─ existing order buttons (approve:/preparing:/delivered:/delay:/…)
  │    └─ NEW confirm-gate taps (confirm:<uuid> / cancel:<uuid>)
  └─ message  — only when chat is the bound owner's private DM
       ├─ text       → agent loop
       ├─ voice      → Groq Whisper → transcript → agent loop
       ├─ photo      → Gemini-3 vision → structured JSON → agent loop
       └─ document   → PDF text extract → agent loop          [net-new]

agent loop (Ollama deepseek, ≤4 tool rounds)
  • read tool      → call Apps Script / compute → result back to model
  • mutating tool  → build pending action (Blob) → reply with Confirm/Cancel
                     → owner taps Confirm → execute once (atomic claim)
```

Group messages and DMs from anyone other than the bound owner are ignored (owner gets full agent; strangers get a generic refusal). Order tickets continue to post to the Sales group via the unchanged `/api/order` + existing webhook button paths.

## 4. Components

Mirror the reference layout under `vercel-app/src/lib/assistant/`:

| Module | Role | Source |
|---|---|---|
| `app/api/telegram/webhook/route.ts` | dispatch text/voice/photo/document + callbacks | extend existing |
| `lib/telegram.ts` | Bot API client (`sendMessage`, `editMessageText`, `answerCallbackQuery`, `getFile`, `downloadFile`, `sendDocument`) | already present; add `downloadFile`/`sendDocument` if missing |
| `lib/assistant/agent.ts` | Ollama chat + tool-calling loop, model routing, deadlines | port |
| `lib/assistant/prompt.ts` | Bistro system prompt (Cairo time, persona, tool rules, plain-text, bilingual EN/AR) | new (Bistro) |
| `lib/assistant/tools.ts` | tool schemas + implementations wired to Apps Script | new (Bistro) |
| `lib/assistant/vision.ts` | two-stage photo → JSON → instruction | port + new schema |
| `lib/assistant/voice.ts` | Groq Whisper transcription | port (drop-in) |
| `lib/assistant/docs.ts` | PDF → text | **net-new** |
| `lib/assistant/state.ts` | Blob: history, pending actions, claims, audit | port |
| `lib/appsScript.ts` | add read/mutate clients + `logExpense` | extend |
| `scripts/setup-telegram.mjs` | re-register webhook incl. `message` updates | port/adjust |

## 5. Tool catalog (mapped to the real backend)

Existing Apps Script actions are reused; **net-new** flagged.

**Read (run inline, no confirm):**
- `orders_active` → `slaListActiveOrders` (today's active orders + status).
- `order_lookup(token|id)` → `getOrderStatus` / `getOrders`.
- `capacity_today(slot?)` → `getAvailability` (slots/items left per hour).
- `revenue_summary(period)` → tool sums `order_total` from `getOrders`/`getCRMOrders` for today/week *(net-new aggregation in TS; no new .gs action)*.
- `customer_lookup(name|phone)` → `getContacts` + `getCRMOrders` for history.
- `menu_list` / `stock_list` → `getMenu` / `getStock` / `getPantry`.

**Mutate (confirm-gated):**
- `order_set_status(token,status)` → `setOrderStatusByToken`.
- `order_delay(token,minutes)` → `delayOrder`.
- `order_finalize(token,payment)` → `orderFinalize` (approve).
- `menu_set_out_of_stock(id,bool)` → `toggleVisibility` / `togglePantryVisibility`.
- `requisition_decide(id,approve|reject)` → `approveRequisition` / `rejectRequisition`.
- `broadcast_group(text)` → `sendMessage(TELEGRAM_OWNER_CHAT_ID=group, text)`.
- `log_expense(vendor,amount,date,category,note)` → **net-new `logExpense` action + `Expenses` sheet**.

**Media (produce input for the loop):**
- `analyze_photo` (vision) → `{kind: receipt|dish|product|general, vendor, total_egp, date, text, …}`; a receipt result is turned into a `log_expense` proposal.
- `transcribe_voice` (Groq Whisper).
- `read_document` (PDF → text).

## 6. Vision pipeline (two-stage, ported pattern)

`largestPhoto` → `getFile` → `downloadFile` (≤15 MB, deadline-bounded) → base64 → Ollama vision (`gemini-3-flash-preview`, temp 0) returning **structured JSON only**. A synthesized plain-language instruction (e.g. "log_expense vendor=… total=…") is then fed back through the **same agent loop + confirm gate**, so a receipt still needs a tap before it writes. Kinds for Bistro: `receipt`, `dish`, `product`, `general`.

## 7. Voice pipeline (drop-in)

Telegram voice (`.oga`) → caps (≤300 s, ≤20 MB) → `getFile` → `downloadFile` → multipart to Groq `whisper-large-v3-turbo` (`response_format=json`, no `language` → auto-detect EN/AR). Echo "🎙 Heard: …" then run the transcript through the agent loop.

## 8. Document pipeline (net-new)

`message.document` with `mime_type=application/pdf` (cap ~10 MB) → `getFile` → `downloadFile` → extract text with a serverless-friendly lib (`unpdf` or `pdf-parse`) → truncate (~8k chars) → feed to the agent ("Summarize / extract / act on this document"). Non-PDF documents: politely declined in v1.

## 9. Expense logging (net-new)

**`Expenses` sheet** (CRM spreadsheet), columns: `id, timestamp, vendor, amount_egp, date, category, note, source, logged_by`. Date/amount stored as text-formatted where needed (same Sheets-coercion guard as Orders).

**`logExpense` Apps Script action** (admin-gated, in the admin `switch`): validates `vendor`+`amount`, appends a row, returns `{success, id}`. Client `logExpense(args)` in `appsScript.ts`. Always reached via the confirm gate (vision proposes → owner taps Confirm → `log_expense` tool → action).

## 10. State & memory (Vercel Blob)

Requires a Vercel Blob store (`BLOB_READ_WRITE_TOKEN`). Layout (ported):
- `telegram/owner.json` — bound owner `chat_id` (set on first `/start <ADMIN_PASS>`).
- `telegram/history.json` — last ~12 turns / 24 messages, 2000-char cap (includes real tool exchanges so the model keeps calling tools).
- `telegram/pending/<uuid>.json` — a proposed mutation (tool name + validated args + chat) with a TTL (~15 min).
- `telegram/claims/<uuid>.json` — atomic claim marker (`allowOverwrite:false`) → exactly-once execution on Confirm.
- `telegram/audit.jsonl` — append-only record of executed mutations.

## 11. Security

- **Owner binding:** one-time `/start <ADMIN_PASS>` (timing-safe compare) saves `chat_id` to `owner.json`; thereafter only that chat drives the agent. Non-owners get a generic refusal (rate-limited owner intrusion alert optional, ported).
- **Confirm-gate:** no tool that writes runs without a Confirm tap; each pending action executes at most once (claim marker). Mutating tool args validated before the proposal is shown.
- **Secret hygiene:** reuse the webhook secret gate. Bot replies use **no `parse_mode`** (plain text) so model/user/customer text can't inject Telegram formatting. Group text passed to `broadcast_group` is sanitized (strip control/bidi).
- **PII** (customer name/phone/address) appears only in the owner DM, never echoed to the group unless the owner explicitly broadcasts it.

## 12. Model stack & config

- **Brain:** Ollama Cloud `https://ollama.com/api/chat`, `OLLAMA_MODEL` fast (`deepseek-v4-flash:cloud`) + `OLLAMA_MODEL_HEAVY` (`deepseek-v4-pro:cloud`) for doc/long-form; native tool-calling.
- **Vision:** `OLLAMA_MODEL_VISION` (`gemini-3-flash-preview`).
- **Voice:** Groq `whisper-large-v3-turbo` (`GROQ_API_KEY` — already provisioned for Bistro).
- **Env (new):** `OLLAMA_API_KEY`, `ADMIN_PASS`, `BLOB_READ_WRITE_TOKEN`; optional model overrides. **Existing:** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_OWNER_CHAT_ID` (group), `APPS_SCRIPT_URL`, `APPS_SCRIPT_ADMIN_PASSWORD`, `GROQ_API_KEY`.

## 13. Error handling & deadlines

- Webhook always returns **200** once authenticated (real replies sent out-of-band) so Telegram never redelivers; in-memory `update_id` dedupe.
- A `deadlineAt` is threaded into all IO; on budget exhaustion the agent degrades (heavy→fast model, partial answer) rather than timing out silently.
- Per-message failures (model down, Apps Script error, transcription failure) reply with a short apology; never crash the handler.

## 14. Testing

Vitest (TS), mirroring the SLA feature's discipline:
- **agent.ts** — tool-call loop with a mocked Ollama (read tool round-trip; mutating tool short-circuits to a pending action; ≤4 rounds; deadline degrade).
- **tools.ts** — arg validation + Apps Script client calls (mocked `fetch`), revenue aggregation math.
- **state.ts** — pending/claim exactly-once, history cap, owner binding.
- **vision.ts** — JSON parse + receipt→log_expense synthesis (mocked vision response).
- **voice.ts / docs.ts** — transcription + PDF-extract happy/oversize paths (mocked).
- **webhook** — owner-only routing (group/stranger ignored), confirm/cancel callbacks.
- **Apps Script** (`logExpense`, `Expenses` sheet) — not unit-tested; verified by `clasp` deploy + `curl` (PII-free probe), per project convention.

## 15. Rollout

1. Create Vercel Blob store → set `BLOB_READ_WRITE_TOKEN`; set `OLLAMA_API_KEY`, `ADMIN_PASS` (use the reliable stdin method: `printf '%s' "$VAL" | vercel env add NAME production`).
2. Apps Script: add `Expenses` sheet (via a `migrate`-style helper) + `logExpense` action; `clasp push` + deploy in place to `@16`.
3. Deploy Vercel; re-register webhook with `allowed_updates: ["message","callback_query"]`.
4. Bind owner: DM the bot `/start <ADMIN_PASS>`.
5. Smoke test: ask a read question; send a voice note; send a receipt photo → Confirm → check the `Expenses` sheet; trigger an order action → Confirm → verify group ticket syncs.

## 16. Future phases (not v1)

- Staff @-mention read-only queries in the group; per-staff DMs/assignments.
- TTS voice replies; non-PDF document types.
- A dedicated `Expenses`/finance summary + P&L document.
- Kitchen Display System (separate spec).
