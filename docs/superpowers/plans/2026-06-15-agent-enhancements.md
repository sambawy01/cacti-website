# Owner-DM Agent Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the owner-DM Telegram agent faster, smarter, safer, and proactive: (1) escalate to the heavy model when the fast one bails, (2) a "typing…" indicator, (3) wire the built-but-unused intrusion alert, (4) proactive notifications (twice-daily digest + pending-approval + SLA-breach owner DMs).

**Architecture:** Builds on the shipped agent (`vercel-app/src/lib/assistant/*`, `app/api/telegram/webhook/route.ts`, `app/api/cron/sla-check/route.ts`). Reuses the existing every-minute `sla-check` cron and adds one twice-daily `owner-digest` cron.

**Tech stack:** Next.js (Vercel), TypeScript, Vitest, Ollama, Vercel Cron, existing Apps Script backend.

**Branch:** `feat/telegram-owner-agent` (already checked out; the agent commits live here).

**Existing surface to reuse (do NOT recreate):**
- `agent.ts`: `runAgent`, the bounded loop, `pickModel`/`fastModel`/`heavyModel` (exported), `callOllama`, `heavyDisabled` latch, `lastRefusal`.
- `telegram.ts`: `sendMessage(chatId,text,keyboard?)`, `editMessageText`, base `call(method,payload)` + `botUrl`.
- `state.ts`: `getOwnerChatId()` (fail-closed), `shouldAlertOwner(...)` (built + tested, currently UNUSED), `IntrusionKind`, alert constants, `telegram/alerts.json`.
- `appsScript.ts`: `slaListActiveOrders()` (returns `SlaActiveOrder[]` incl `status`, `sla_alerted_at`, `tracking_token`), `getCrmOrdersList(range)` (revenue), `logExpense`. SLA cron uses `markSlaAlerted`.
- `app/api/cron/sla-check/route.ts`: CRON_SECRET-gated, every minute, alerts the **group** (`TELEGRAM_OWNER_CHAT_ID`) on SLA breach, dedups via `sla_alerted_at`/`markSlaAlerted`.
- `vercel.json`: `crons: [{ path: "/api/cron/sla-check", schedule: "* * * * *" }]`.

**Cairo time note:** Egypt is UTC+3 in summer (DST ~late Apr–late Oct), UTC+2 in winter. Digest crons must be DST-safe: schedule at BOTH candidate UTC hours and gate in-route on the actual Cairo hour + a once-per-slot Blob marker.

---

## Task 1: Heavy-model escalation on a fast-model bail

**Files:** Modify `vercel-app/src/lib/assistant/agent.ts`; Test `agent.test.ts`.

When the FAST model returns a terminal text turn (no tool calls) that looks like a refusal/non-answer ("I can't", "I don't have access", "I'm not able", "rephrase"), and the heavy model hasn't already been used/disabled and the deadline allows, do ONE retry of the whole turn on the heavy model before returning. This catches the "bailed instead of calling a tool" class.

- [ ] **Step 1: Failing test** — add to `agent.test.ts`:

```typescript
it("escalates to the heavy model when the fast model bails with a refusal", async () => {
  // Round 1 (fast): a refusal text, no tool calls. Then the heavy retry: a real answer.
  const fetchSpy = vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(ollamaResponse({ message: { role: "assistant", content: "I can't access that." } }))
    .mockResolvedValueOnce(ollamaResponse({ message: { role: "assistant", content: "You have 3 active orders." } }));
  const out = await runAgent({ chatId: 1, userText: "orders I sent?", deadlineAt: Date.now() + 90_000 });
  expect(out.kind).toBe("text");
  if (out.kind === "text") expect(out.text).toContain("active orders");
  // Two model calls: the fast bail + the heavy escalation.
  expect(fetchSpy).toHaveBeenCalledTimes(2);
  const body2 = JSON.parse(fetchSpy.mock.calls[1][1]!.body as string);
  expect(body2.model).toMatch(/pro|heavy/i); // escalated to heavy
});

it("does NOT escalate when the fast model gives a real answer", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(ollamaResponse({ message: { role: "assistant", content: "We're open 10AM-8PM." } }));
  const out = await runAgent({ chatId: 1, userText: "hours?", deadlineAt: Date.now() + 90_000 });
  expect(out.kind).toBe("text");
  expect(fetchSpy).toHaveBeenCalledTimes(1); // no escalation
});
```

- [ ] **Step 2: Run, confirm fail.** `npx vitest run src/lib/assistant/agent.test.ts`

- [ ] **Step 3: Implement.** In the terminal-text branch of `runAgent` (where `toolCalls.length === 0 || finalRound` returns `{kind:"text"}`): before returning, if `content` is non-empty AND matches a refusal regex AND `!route.heavy` was the model used (i.e. it ran on fast) AND `!heavyDisabled` AND `remainingMs >= DEADLINE_MIN_MODEL_MS`, then make ONE more `callOllama(messages, heavyModel(), timeout)` and use its content if it produced a better (non-refusal or tool-calling) result. Keep it bounded — only ONE escalation per `runAgent`, guarded by a `let escalated = false`. Refusal regex (case-insensitive): `/\b(can't|cannot|don't have access|do not have access|not able to|unable to|no access|rephrase)\b/`. If the heavy retry itself returns tool_calls, continue the loop (let it call tools); if text, return it. If escalation errors, fall back to the original fast text (never throw).

- [ ] **Step 4: Run, confirm pass** + `npx tsc --noEmit` + full `npm test`.

- [ ] **Step 5: Commit** `feat(agent): escalate to heavy model when the fast model bails`.

---

## Task 2: "typing…" chat action

**Files:** Modify `vercel-app/src/lib/telegram.ts` (+ test), `app/api/telegram/webhook/route.ts`.

- [ ] **Step 1: Failing test** in `telegram.test.ts`:

```typescript
it("sendChatAction posts the action to the chat", async () => {
  const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ ok: true, result: true }), { status: 200 }),
  );
  const r = await sendChatAction(777, "typing");
  expect(r.ok).toBe(true);
  expect(spy.mock.calls[0][0] as string).toContain("/sendChatAction");
});
```

- [ ] **Step 2: Run, confirm fail.**

- [ ] **Step 3: Implement** in `telegram.ts` (reuse the internal `call`):

```typescript
/** Show a chat action (e.g. "typing") — auto-clears after ~5s or on next message. */
export function sendChatAction(chatId: string | number, action: "typing" | "upload_voice" | "upload_document" = "typing"): Promise<TelegramResult> {
  return call("sendChatAction", { chat_id: chatId, action });
}
```

(If `call` isn't exported/reachable, mirror its shape.) Then in `route.ts` `routeOwnerMessage`, fire `sendChatAction(chatId, "typing").catch(() => {})` once at the top (before the agent/media work) so the owner sees "typing…" immediately. Non-fatal.

- [ ] **Step 4: pass + tsc + full suite.**
- [ ] **Step 5: Commit** `feat(telegram): show typing… while the owner-DM agent works`.

---

## Task 3: Wire the intrusion alert

**Files:** Modify `app/api/telegram/webhook/route.ts` (+ test). Uses existing `shouldAlertOwner` from `state.ts`.

`shouldAlertOwner` is built + unit-tested but never called. Wire it so a non-owner DM / failed `/start` triggers a rate-limited owner-DM alert.

- [ ] **Step 1: Read `state.ts`** to confirm `shouldAlertOwner`'s exact signature + return (rate-limit decision) and `IntrusionKind`. Build a small local `alertOwner(ownerChatId, kind, fromInfo)` that, if `shouldAlertOwner(...)` says yes, `sendMessage(ownerChatId, "⚠️ Someone tried to use the bot: …")` — PII-light (no message text; just from-id/username + kind). Respect the rate-limit state it manages (alerts.json).

- [ ] **Step 2: Failing test** in `route.test.ts`: mock `shouldAlertOwner` to return true; a stranger DM → `sendMessage` called with the OWNER chat id (777) and an alert string; AND the stranger still gets the generic refusal. A second stranger DM with `shouldAlertOwner`→false → no second alert. Confirm the agent still never runs (existing assertion).

- [ ] **Step 3: Implement** — in the non-owner DM branch and the failed-`/start` branch of `route.ts`, after sending the generic refusal, call `alertOwner(...)` (deferred via `after()` or inline, non-fatal). Only when an owner is actually bound (`getOwnerChatId()` non-null) — never alert if unbound. Add `shouldAlertOwner`/`IntrusionKind`/`appendAudit` imports as needed.

- [ ] **Step 4: pass + tsc + full suite** (existing webhook tests must stay green).
- [ ] **Step 5: Commit** `feat(telegram): rate-limited owner alert on intrusion attempts`.

---

## Task 4: Proactive notifications (digest + pending + SLA owner-DM)

Three pieces. Reuse existing clients; add ONE Apps Script read for expenses (for the net figure).

**4a — Apps Script `getExpenses` read** (`apps-script/admin-api.gs`, + `appsScript.ts` client). Net needs expense totals. Add an admin-gated `getExpenses` action that returns the Expenses rows (or a summed total) for today/this-week, mirroring the `getCRMOrders`/`crmReadRows` pattern. Client: `getExpensesList(range): Promise<{success, items?: {amount_egp:number|string, date, category}[], error?}>`. NOT unit-tested server-side (clasp/curl verify); the TS client IS tested (mock fetch, assert `action=getExpenses` + password + range). **Deploy is deferred to rollout (clasp).**

**4b — Extend `sla-check` for owner DMs** (`app/api/cron/sla-check/route.ts` + test). It already alerts the group on SLA breach. ALSO: when it alerts on a breach, additionally `sendMessage(getOwnerChatId(), "🔴 SLA: order … stuck in <status> …")` (only if an owner is bound). AND count `pending_approval` orders in the scan; if any are older than a threshold (e.g. ≥ the SLA window) DM the owner a single "⏳ N orders awaiting your approval" line, deduped so it doesn't repeat every minute (reuse a Blob marker like `telegram/pending-reminded.json` with a cooldown, or piggyback on `sla_alerted_at`). Keep the existing group alert + dedup UNCHANGED. Tests: mock `slaListActiveOrders` with a breaching + a pending order; assert owner DM(s) sent to the owner chat id, group alert still sent, dedup respected.

**4c — Twice-daily digest cron** (`app/api/cron/owner-digest/route.ts` + test; `vercel.json`). CRON_SECRET-gated like sla-check. On invocation: compute Cairo hour; only proceed if it's the morning slot (9) or evening slot (20) AND that slot hasn't already sent today (Blob marker `telegram/digest-sent.json` keyed by `YYYY-MM-DD:slot`). Build the digest from existing clients: order count + revenue via `getCrmOrdersList("today")`, expenses via `getExpensesList("today")`, net = revenue − expenses, plus pending-approval count from `slaListActiveOrders`. Morning = "briefing" framing (yesterday's net + today's pending); evening = "wrap-up" (today's totals). DM the bound owner (skip if unbound). `vercel.json`: add digest cron entries at the UTC hours covering 9AM & 8PM Cairo for BOTH DST offsets — `"0 6 * * *"`, `"0 7 * * *"`, `"0 17 * * *"`, `"0 18 * * *"` — the in-route Cairo-hour gate + once-per-slot marker ensure exactly one send per slot regardless of DST. Tests: mock the clients + a pinned clock at 20:00 Cairo → digest sent with revenue/expenses/net/pending; at 14:00 Cairo → no send; second call same slot → deduped.

- [ ] Steps per piece: failing test → confirm fail → implement → pass → `tsc` → full suite → commit. Suggested commits: `feat(apps-script): getExpenses read for digest`, `feat(cron): owner-DM SLA breach + pending-approval reminder`, `feat(cron): twice-daily owner digest (revenue/expenses/net/pending)`.

---

## Rollout (after all tasks reviewed + green)
1. Full `npm test` + `npx tsc --noEmit` green.
2. `clasp push -f && clasp deploy --deploymentId AKfycbzN-…PVxhFA --description "V29: getExpenses"` (the live deployment, in place).
3. `vercel --prod --yes` (picks up the new cron route + agent changes).
4. `vercel.json` cron changes take effect on deploy — confirm in the Vercel dashboard (Crons) that `owner-digest` is registered.
5. Live check: trigger `/api/cron/owner-digest` once with the CRON_SECRET at an off-slot (expect "skipped: not a digest slot"), and confirm a stranger DM produces an owner alert.

## Self-review (author)
- Spec coverage: #1→T1, #2→T2, #3→T3, #5(EOD summary + pending + SLA)→T4a/b/c. Low-stock intentionally excluded (user opted out).
- No placeholders; each task has real test + impl guidance + reuses named existing exports.
- DST handled via in-route Cairo-hour gate + per-slot Blob dedup (not just UTC schedule).
- Owner DMs are all guarded by `getOwnerChatId()` non-null (no sends when unbound). Group SLA alert path unchanged.
