# Email Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Brand the customer order emails (logo + cleaner look), add a tracking-page-style status stepper, and thread all of an order's emails into one conversation.

**Architecture:** All changes are in the Vercel/Resend email layer (`vercel-app/src/lib/email.ts` + its two call sites) plus one static logo asset committed to the website repo's `public/`. Threading is achieved with a deterministic per-order Message-ID derived from the tracking token (`<order-{token}@bistro-cloud.com>`): the first email sets it as `Message-ID`, later emails set `In-Reply-To`/`References` to it. A single constant subject (`Bistro Cloud — your order`) is shared by confirmation/status/delay emails so subject-threading clients also group them; decline stays standalone.

**Tech Stack:** TypeScript, Next.js (Vercel serverless), Resend HTTP API, Vitest. Website is a Vite SPA on GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-06-14-email-polish-design.md`

**Two-repo note:** The repo root (`/Users/bistrocloud/Bistro-Cloud-website`) is the **website** (Vite SPA → GitHub Pages). `vercel-app/` is a **separate Next.js app** with its own `package.json`/tests. Run website commands from root; run email/test commands from `vercel-app/`.

---

## Task 1: Add the logo as a public website asset

**Files:**
- Create: `public/email-logo.png` (website repo root)
- Source: `src/assets/8ed5368e99d26da0c833286cd37634dbfa9feba8.png`

- [ ] **Step 1: Copy the site-header logo into `public/`**

Run (from repo root):
```bash
cp src/assets/8ed5368e99d26da0c833286cd37634dbfa9feba8.png public/email-logo.png
```

- [ ] **Step 2: Verify it exists and is a PNG**

Run:
```bash
file public/email-logo.png
```
Expected: `public/email-logo.png: PNG image data, ...`

- [ ] **Step 3: Confirm Vite will serve it at the site root**

`public/` is copied verbatim to the build output, so this file will be live at `https://bistro-cloud.com/email-logo.png` after the website deploys. No code change needed. (It will be *deployed* in Task 11, before the Vercel email change references it.)

- [ ] **Step 4: Commit**

```bash
git add public/email-logo.png
git commit -m "feat(email): add public logo asset for branded emails"
```

---

## Task 2: Order Message-ID + shared subject constants

**Files:**
- Modify: `vercel-app/src/lib/email.ts`
- Test: `vercel-app/src/lib/email.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `email.test.ts` (import `orderMessageId` and `ORDER_SUBJECT` at the top alongside the existing imports):

```ts
describe("orderMessageId", () => {
  it("builds a deterministic RFC Message-ID from the token", () => {
    expect(orderMessageId("tok-9")).toBe("<order-tok-9@bistro-cloud.com>");
  });
});

describe("ORDER_SUBJECT", () => {
  it("is the single constant lifecycle subject", () => {
    expect(ORDER_SUBJECT).toBe("Bistro Cloud — your order");
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd vercel-app && npx vitest run src/lib/email.test.ts -t "orderMessageId"`
Expected: FAIL — `orderMessageId is not a function` / `ORDER_SUBJECT` undefined.

- [ ] **Step 3: Implement the constants**

In `email.ts`, just after the `REPLY_TO` constant (~line 21), add:

```ts
/** The single subject shared by every lifecycle email of one order, so clients
 * that thread by subject also group them. Decline keeps its own subject. */
export const ORDER_SUBJECT = "Bistro Cloud — your order";

/** Deterministic RFC Message-ID for an order, derived from its tracking token.
 * The first email of an order sends with this as Message-ID; later emails set
 * In-Reply-To/References to it so they thread under the original. */
export function orderMessageId(token: string): string {
  return `<order-${token}@bistro-cloud.com>`;
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `cd vercel-app && npx vitest run src/lib/email.test.ts -t "orderMessageId"`
Expected: PASS (both new describes).

- [ ] **Step 5: Commit**

```bash
git add vercel-app/src/lib/email.ts vercel-app/src/lib/email.test.ts
git commit -m "feat(email): add orderMessageId + ORDER_SUBJECT constants"
```

---

## Task 3: Threading headers in `sendEmail`

**Files:**
- Modify: `vercel-app/src/lib/email.ts:209-244` (the `sendEmail` function)
- Test: `vercel-app/src/lib/email.test.ts`

- [ ] **Step 1: Write failing tests**

Add inside the existing `describe("emailConfigured + sendEmail", ...)` block in `email.test.ts`:

```ts
it("sets a Message-ID header for a root email", async () => {
  process.env.RESEND_API_KEY = "re_secret";
  const spy = vi.fn(async () => new Response("{}", { status: 200 }));
  globalThis.fetch = spy as unknown as typeof fetch;
  await sendEmail("a@b.com", "s", "<p>h</p>", { threadToken: "tok-9", threadRole: "root" });
  const body = JSON.parse((spy.mock.calls[0] as any)[1].body);
  expect(body.headers).toEqual({ "Message-ID": "<order-tok-9@bistro-cloud.com>" });
});

it("sets In-Reply-To + References headers for a reply email", async () => {
  process.env.RESEND_API_KEY = "re_secret";
  const spy = vi.fn(async () => new Response("{}", { status: 200 }));
  globalThis.fetch = spy as unknown as typeof fetch;
  await sendEmail("a@b.com", "s", "<p>h</p>", { threadToken: "tok-9", threadRole: "reply" });
  const body = JSON.parse((spy.mock.calls[0] as any)[1].body);
  expect(body.headers).toEqual({
    "In-Reply-To": "<order-tok-9@bistro-cloud.com>",
    References: "<order-tok-9@bistro-cloud.com>",
  });
});

it("sends NO headers field when no thread opts are given", async () => {
  process.env.RESEND_API_KEY = "re_secret";
  const spy = vi.fn(async () => new Response("{}", { status: 200 }));
  globalThis.fetch = spy as unknown as typeof fetch;
  await sendEmail("a@b.com", "s", "<p>h</p>");
  const body = JSON.parse((spy.mock.calls[0] as any)[1].body);
  expect(body.headers).toBeUndefined();
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd vercel-app && npx vitest run src/lib/email.test.ts -t "header"`
Expected: FAIL — `sendEmail` ignores the 4th arg; `body.headers` is undefined for root/reply.

- [ ] **Step 3: Implement the opts + headers**

In `email.ts`, add the opts type (near the other interfaces, e.g. above `sendEmail`):

```ts
export interface SendEmailOpts {
  /** The order's tracking token, used to derive the thread Message-ID. */
  threadToken?: string;
  /** "root" → set Message-ID; "reply" → set In-Reply-To + References. */
  threadRole?: "root" | "reply";
}
```

Change the `sendEmail` signature and body. Replace the function header line:

```ts
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  opts?: SendEmailOpts,
): Promise<{ ok: boolean; error?: string }> {
```

Inside the function, after the `if (!to) return ...` guard and before the `try`, build the headers:

```ts
  let threadHeaders: Record<string, string> | undefined;
  if (opts?.threadToken && opts.threadRole) {
    const id = orderMessageId(opts.threadToken);
    threadHeaders =
      opts.threadRole === "root"
        ? { "Message-ID": id }
        : { "In-Reply-To": id, References: id };
  }
```

Then in the `JSON.stringify({...})` Resend body, add the headers conditionally — change the body object to:

```ts
      body: JSON.stringify({
        from: FROM,
        to: [to],
        reply_to: REPLY_TO,
        subject,
        html,
        ...(threadHeaders ? { headers: threadHeaders } : {}),
      }),
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `cd vercel-app && npx vitest run src/lib/email.test.ts -t "sendEmail"`
Expected: PASS, including the 3 new header tests and the existing envelope test (which sends no opts → no headers).

- [ ] **Step 5: Commit**

```bash
git add vercel-app/src/lib/email.ts vercel-app/src/lib/email.test.ts
git commit -m "feat(email): thread emails via Message-ID/In-Reply-To headers"
```

---

## Task 4: Status stepper helper

**Files:**
- Modify: `vercel-app/src/lib/email.ts`
- Test: `vercel-app/src/lib/email.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `email.test.ts` (import `statusStepper`):

```ts
describe("statusStepper", () => {
  it("marks the current step and completes prior steps", () => {
    const html = statusStepper("out_for_delivery");
    // All four labels present
    expect(html).toContain("Confirmed");
    expect(html).toContain("Being prepared");
    expect(html).toContain("Out for delivery");
    expect(html).toContain("Delivered");
    // Two prior steps are checked, current is the dot, future is the hollow ring
    expect((html.match(/✓/g) || []).length).toBe(2); // confirmed + preparing done
    expect(html).toContain("●"); // out_for_delivery current
    expect(html).toContain("○"); // delivered future
  });

  it("at 'confirmed' nothing is checked yet and confirmed is current", () => {
    const html = statusStepper("confirmed");
    expect((html.match(/✓/g) || []).length).toBe(0);
    expect((html.match(/○/g) || []).length).toBe(3); // 3 future steps
    expect(html).toContain("●");
  });

  it("at 'delivered' all prior steps are checked", () => {
    const html = statusStepper("delivered");
    expect((html.match(/✓/g) || []).length).toBe(3);
    expect((html.match(/○/g) || []).length).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd vercel-app && npx vitest run src/lib/email.test.ts -t "statusStepper"`
Expected: FAIL — `statusStepper is not a function`.

- [ ] **Step 3: Implement the stepper**

In `email.ts`, add (place it above the template builders, after `trackButton`):

```ts
export type StepperStage = "confirmed" | "preparing" | "out_for_delivery" | "delivered";

const STEPPER_STEPS: { key: StepperStage; label: string }[] = [
  { key: "confirmed", label: "Confirmed" },
  { key: "preparing", label: "Being prepared" },
  { key: "out_for_delivery", label: "Out for delivery" },
  { key: "delivered", label: "Delivered" },
];

/** A 4-step status bar mirroring the /track page. Completed steps show ✓ (orange),
 * the current step ● (orange, bold), future steps ○ (gray). Table-based for Outlook. */
export function statusStepper(current: StepperStage): string {
  const currentIndex = STEPPER_STEPS.findIndex((s) => s.key === current);
  const cells = STEPPER_STEPS.map((step, i) => {
    const done = i < currentIndex;
    const active = i === currentIndex;
    const marker = done ? "✓" : active ? "●" : "○";
    const markerColor = done || active ? "#D94E28" : "#cfcfcf";
    const labelColor = done || active ? "#333" : "#aaa";
    const weight = active ? "bold" : "normal";
    return (
      '<td style="text-align:center; vertical-align:top; width:25%; padding:0 4px;">' +
      `<div style="font-size:18px; line-height:1; color:${markerColor};">${marker}</div>` +
      `<div style="font-size:11px; margin-top:6px; color:${labelColor}; font-weight:${weight};">${step.label}</div>` +
      "</td>"
    );
  }).join("");
  return (
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;">' +
    `<tr>${cells}</tr></table>`
  );
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `cd vercel-app && npx vitest run src/lib/email.test.ts -t "statusStepper"`
Expected: PASS (all 3).

- [ ] **Step 5: Commit**

```bash
git add vercel-app/src/lib/email.ts vercel-app/src/lib/email.test.ts
git commit -m "feat(email): add tracking-page status stepper helper"
```

---

## Task 5: Rebrand the `wrap()` shell (cream header + logo)

**Files:**
- Modify: `vercel-app/src/lib/email.ts:44-60` (the `wrap` function)
- Test: `vercel-app/src/lib/email.test.ts:25-34`

Note: `declineEmail` calls `wrap()`, so it inherits the new shell automatically with no code change; its test stays green.

- [ ] **Step 1: Update the `wrap` test to the new shell (make it fail)**

Replace the existing `describe("wrap", ...)` block (lines 25-34) with:

```ts
describe("wrap", () => {
  it("wraps inner HTML in the branded shell with the logo + cream header + footer", () => {
    const html = wrap("<p>hi</p>");
    expect(html).toContain("<p>hi</p>");
    expect(html).toContain('src="https://bistro-cloud.com/email-logo.png"'); // logo
    expect(html).toContain('alt="Bistro Cloud"');
    expect(html).toContain("#F9F5F0"); // cream header/background
    expect(html).toContain("Fresh. Natural. Delivered Daily."); // tagline
    expect(html).toContain('href="https://bistro-cloud.com"'); // footer link
    expect(html).not.toContain("#2C3E50"); // navy header is gone from the shell
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd vercel-app && npx vitest run src/lib/email.test.ts -t "wrap"`
Expected: FAIL — old shell has no logo `<img>` and still contains `#2C3E50`.

- [ ] **Step 3: Rewrite `wrap()`**

Replace the `wrap` function body (lines 44-60) with:

```ts
/** The branded header/body/footer shell — cream header with the logo image. */
export function wrap(innerHtml: string): string {
  return (
    '<div style="font-family: Helvetica Neue, Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #F9F5F0;">' +
    '<div style="background: #F9F5F0; padding: 28px 30px 20px; text-align: center;">' +
    '<img src="https://bistro-cloud.com/email-logo.png" width="160" alt="Bistro Cloud" style="display:inline-block; width:160px; max-width:160px; height:auto;">' +
    '<p style="color: #888; margin: 12px 0 0; font-size: 13px; letter-spacing: 0.4px;">Fresh. Natural. Delivered Daily.</p>' +
    "</div>" +
    '<div style="padding: 30px; background: white;">' +
    innerHtml +
    "</div>" +
    '<div style="padding: 20px 30px; text-align: center; border-top: 1px solid #eee;">' +
    '<p style="color: #999; font-size: 12px; margin: 0;">Bistro Cloud El Gouna &middot; 100% Natural Ingredients &middot; Free Delivery<br>' +
    '<a href="https://bistro-cloud.com" style="color: #D94E28; text-decoration: none;">bistro-cloud.com</a></p>' +
    "</div>" +
    "</div>"
  );
}
```

Note: the template `<h2>` headings still use `color: #2C3E50` (dark slate text) — that is fine and is inside the inner HTML, not the shell. The `wrap` test only checks the shell string it builds around `<p>hi</p>`, so it will not see those headings.

- [ ] **Step 4: Run the wrap test + full email unit file**

Run: `cd vercel-app && npx vitest run src/lib/email.test.ts -t "wrap"`
Expected: PASS.
Run: `cd vercel-app && npx vitest run src/lib/email.test.ts`
Expected: the `declineEmail` tests still PASS (auto-restyled); confirmation/status/delay subject tests will still be FAILING here — they are fixed in Tasks 6-8. That's expected at this point.

- [ ] **Step 5: Commit**

```bash
git add vercel-app/src/lib/email.ts vercel-app/src/lib/email.test.ts
git commit -m "feat(email): rebrand shell with cream header + logo image"
```

---

## Task 6: `confirmationEmail` — constant subject + stepper

**Files:**
- Modify: `vercel-app/src/lib/email.ts:92-119` (the `confirmationEmail` function)
- Test: `vercel-app/src/lib/email.test.ts:42-60`

- [ ] **Step 1: Update the confirmation tests (make them fail)**

In `email.test.ts`, change the subject assertion at line 59 from:
```ts
    expect(subject).toBe("Bistro Cloud — order confirmed for 2:30 PM");
```
to:
```ts
    expect(subject).toBe("Bistro Cloud — your order");
```
And add, inside that same `it(...)` (after the existing `Track your order` assertion):
```ts
    expect(html).toContain("Being prepared"); // status stepper present
```

- [ ] **Step 2: Run, verify failure**

Run: `cd vercel-app && npx vitest run src/lib/email.test.ts -t "confirmationEmail"`
Expected: FAIL — subject is still the old per-slot string; no stepper labels.

- [ ] **Step 3: Implement**

In `confirmationEmail` (`email.ts`), insert the stepper right after the heading/`<h2>` line. Change the start of `inner` so it reads:

```ts
  const label = slotLabel(o.deliverySlot);
  let inner =
    `<h2 style="color: #2C3E50; margin-top: 0;">Order confirmed, ${escapeHtml(o.name)}!</h2>` +
    statusStepper("confirmed") +
    `<p style="color: #555; line-height: 1.6;">Your delivery is scheduled for <strong>today at ${escapeHtml(label)}</strong>.</p>` +
```

(keep the rest of `inner` — the summary card, payment line, instapay block, `trackButton` — unchanged.)

Change the returned subject from:
```ts
    subject: `Bistro Cloud — order confirmed for ${label}`,
```
to:
```ts
    subject: ORDER_SUBJECT,
```

- [ ] **Step 4: Run, verify pass**

Run: `cd vercel-app && npx vitest run src/lib/email.test.ts -t "confirmationEmail"`
Expected: PASS (all confirmation tests, including escape + instapay).

- [ ] **Step 5: Commit**

```bash
git add vercel-app/src/lib/email.ts vercel-app/src/lib/email.test.ts
git commit -m "feat(email): confirmation uses constant subject + status stepper"
```

---

## Task 7: `statusEmail` — constant subject + stepper

**Files:**
- Modify: `vercel-app/src/lib/email.ts:147-156` (the `statusEmail` function)
- Test: `vercel-app/src/lib/email.test.ts:94-116`

- [ ] **Step 1: Update the status tests (make them fail)**

In `email.test.ts`, change the three status subject assertions:
- line 99: `expect(subject).toBe("Your Bistro Cloud order is being prepared");` → `expect(subject).toBe("Bistro Cloud — your order");`
- line 107: `expect(subject).toBe("Your Bistro Cloud order is out for delivery");` → `expect(subject).toBe("Bistro Cloud — your order");`
- line 113: `expect(subject).toBe("Your Bistro Cloud order has been delivered");` → `expect(subject).toBe("Bistro Cloud — your order");`

Add to the `preparing` test (after the existing assertions):
```ts
    expect(html).toContain("Out for delivery"); // stepper labels present
```

- [ ] **Step 2: Run, verify failure**

Run: `cd vercel-app && npx vitest run src/lib/email.test.ts -t "statusEmail"`
Expected: FAIL — subjects still the old strings; no stepper.

- [ ] **Step 3: Implement**

In `statusEmail` (`email.ts`), add the stepper after the heading and change the returned subject. Replace the `inner`/return with:

```ts
  const copy = STATUS_EMAIL_COPY[status];
  const inner =
    `<h2 style="color: #2C3E50; margin-top: 0;">${copy.heading}</h2>` +
    statusStepper(status) +
    `<p style="color: #555; line-height: 1.6;">${copy.body}</p>` +
    `<p style="color: #555; line-height: 1.6;">Scheduled time: <strong>${escapeHtml(slotLabel(o.deliverySlot))}</strong></p>` +
    trackButton(o.trackingToken);
  return { subject: ORDER_SUBJECT, html: wrap(inner) };
```

Note: `status` is typed `StatusEmailStatus` (`"preparing" | "out_for_delivery" | "delivered"`), which is assignable to `StepperStage`, so `statusStepper(status)` type-checks.

- [ ] **Step 4: Run, verify pass**

Run: `cd vercel-app && npx vitest run src/lib/email.test.ts -t "statusEmail"`
Expected: PASS (all three).

- [ ] **Step 5: Commit**

```bash
git add vercel-app/src/lib/email.ts vercel-app/src/lib/email.test.ts
git commit -m "feat(email): status emails use constant subject + stepper"
```

---

## Task 8: `delayEmail` — constant subject + optional stepper

**Files:**
- Modify: `vercel-app/src/lib/email.ts:158-173` (the `DelayEmailInput` interface + `delayEmail` function)
- Test: `vercel-app/src/lib/email.test.ts:118-132`

- [ ] **Step 1: Update + add delay tests (make them fail)**

In `email.test.ts`, change the delay subject assertion (line 126) from:
```ts
    expect(subject).toBe("Bistro Cloud — updated delivery time");
```
to:
```ts
    expect(subject).toBe("Bistro Cloud — your order");
```
Then add a new `it` inside `describe("delayEmail", ...)`:
```ts
  it("renders the stepper at the given current stage, and omits it when absent", () => {
    const withStage = delayEmail({
      name: "Sara", oldLabel: "2:30 PM", newLabel: "3:00 PM",
      trackingToken: "t2", currentStage: "preparing",
    });
    expect(withStage.html).toContain("Being prepared");
    expect(withStage.html).toContain("Out for delivery");

    const noStage = delayEmail({
      name: "Sara", oldLabel: "2:30 PM", newLabel: "3:00 PM", trackingToken: "t2",
    });
    expect(noStage.html).not.toContain("Out for delivery"); // no stepper without a stage
  });
```

- [ ] **Step 2: Run, verify failure**

Run: `cd vercel-app && npx vitest run src/lib/email.test.ts -t "delayEmail"`
Expected: FAIL — subject mismatch + `currentStage` not supported.

- [ ] **Step 3: Implement**

In `email.ts`, extend the interface — change `DelayEmailInput` to:

```ts
export interface DelayEmailInput {
  name: string;
  oldLabel: string;
  newLabel: string;
  trackingToken: string;
  /** Order's current pipeline stage, used to render the stepper. Omit to skip it. */
  currentStage?: StepperStage;
}
```

Replace the `delayEmail` body with:

```ts
export function delayEmail(o: DelayEmailInput): BuiltEmail {
  const inner =
    '<h2 style="color: #2C3E50; margin-top: 0;">Your order is running a little late</h2>' +
    (o.currentStage ? statusStepper(o.currentStage) : "") +
    `<p style="color: #555; line-height: 1.6;">New estimated delivery: <b>${escapeHtml(o.newLabel)}</b> (was ${escapeHtml(o.oldLabel)}). Thanks for your patience!</p>` +
    trackButton(o.trackingToken);
  return { subject: ORDER_SUBJECT, html: wrap(inner) };
}
```

- [ ] **Step 4: Run, verify pass + whole email unit file green**

Run: `cd vercel-app && npx vitest run src/lib/email.test.ts`
Expected: PASS — the entire `email.test.ts` file is now green.

- [ ] **Step 5: Commit**

```bash
git add vercel-app/src/lib/email.ts vercel-app/src/lib/email.test.ts
git commit -m "feat(email): delay email uses constant subject + optional stepper"
```

---

## Task 9: Wire the confirmation send in `order/route.ts` as a thread root

**Files:**
- Modify: `vercel-app/src/app/api/order/route.ts:59`
- Test: `vercel-app/src/app/api/order/route.test.ts:225`

- [ ] **Step 1: Update the route test (make it fail)**

In `route.test.ts`, change line 225 from:
```ts
    expect(sendEmail).toHaveBeenCalledWith("sara@example.com", "Bistro Cloud — order confirmed", "<p>confirm</p>");
```
to:
```ts
    expect(sendEmail).toHaveBeenCalledWith(
      "sara@example.com",
      "Bistro Cloud — order confirmed",
      "<p>confirm</p>",
      expect.objectContaining({ threadRole: "root" }),
    );
```

- [ ] **Step 2: Run, verify failure**

Run: `cd vercel-app && npx vitest run src/app/api/order/route.test.ts -t "confirmation"`
Expected: FAIL — `sendEmail` is called with only 3 args.

- [ ] **Step 3: Implement**

In `order/route.ts`, change line 59 from:
```ts
      const sent = await sendEmail(order.email, subject, html);
```
to:
```ts
      const sent = await sendEmail(order.email, subject, html, {
        threadToken: result.trackingToken,
        threadRole: "root",
      });
```

- [ ] **Step 4: Run, verify pass**

Run: `cd vercel-app && npx vitest run src/app/api/order/route.test.ts`
Expected: PASS (whole file).

- [ ] **Step 5: Commit**

```bash
git add vercel-app/src/app/api/order/route.ts vercel-app/src/app/api/order/route.test.ts
git commit -m "feat(email): send confirmation as the order's thread root"
```

---

## Task 10: Wire the Telegram webhook sends (status/delay replies, confirmation root, decline standalone)

**Files:**
- Modify: `vercel-app/src/app/api/telegram/webhook/route.ts` (lines 104, 139-140, 173) + the import on line 7
- Test: `vercel-app/src/app/api/telegram/webhook/route.test.ts` (lines 272, 312-315, 361)

- [ ] **Step 1: Update the webhook tests (make them fail)**

In `webhook/route.test.ts`:

(a) Status email assertion (line 272) → add the reply opts:
```ts
    expect(sendEmail).toHaveBeenCalledWith(
      "sara@example.com", "status-subject", "<p>status</p>",
      expect.objectContaining({ threadRole: "reply" }),
    );
```

(b) Delay — the `delayEmail` arg assertion (around line 312) → include `currentStage`. Change it to:
```ts
    expect(delayEmail).toHaveBeenCalledWith(
      expect.objectContaining({ trackingToken: expect.any(String), currentStage: "confirmed" }),
    );
```
and the delay `sendEmail` assertion (line 315) → add reply opts:
```ts
    expect(sendEmail).toHaveBeenCalledWith(
      "sara@example.com", "delay-subject", "<p>delay</p>",
      expect.objectContaining({ threadRole: "reply" }),
    );
```

(c) Confirmation-on-approve `sendEmail` assertion (line 361) → add root opts:
```ts
    expect(sendEmail).toHaveBeenCalledWith(
      "sara@example.com", "confirm-subject", "<p>confirm</p>",
      expect.objectContaining({ threadRole: "root" }),
    );
```

(d) Decline (line 305) — **leave unchanged**. Decline sends with no opts (3 args), and a 3-arg `toHaveBeenCalledWith` still matches.

- [ ] **Step 2: Run, verify failure**

Run: `cd vercel-app && npx vitest run src/app/api/telegram/webhook/route.test.ts`
Expected: FAIL on status/delay/confirmation assertions (missing 4th arg / missing currentStage).

- [ ] **Step 3: Implement the wiring**

In `webhook/route.ts`:

First, extend the email import on line 7 to include `StepperStage`:
```ts
import { confirmationEmail, statusEmail, declineEmail, delayEmail, sendEmail, type StatusEmailStatus, type StepperStage } from "@/lib/email";
```

(a) `sendStatusEmailByToken` — line 104, change:
```ts
    const sent = await sendEmail(o.email, subject, html);
```
to:
```ts
    const sent = await sendEmail(o.email, subject, html, { threadToken: token, threadRole: "reply" });
```

(b) `sendDelayEmailByToken` — replace lines 139-140 (`const { subject, html } = delayEmail(...)` and the `sendEmail` line) with:
```ts
    const stepperStages: StepperStage[] = ["confirmed", "preparing", "out_for_delivery", "delivered"];
    const currentStage = stepperStages.includes(o.status as StepperStage)
      ? (o.status as StepperStage)
      : undefined;
    const { subject, html } = delayEmail({ name: o.name, oldLabel, newLabel, trackingToken: token, currentStage });
    const sent = await sendEmail(o.email, subject, html, { threadToken: token, threadRole: "reply" });
```

(c) `sendConfirmationEmailByToken` — line 173, change:
```ts
    const sent = await sendEmail(o.email, subject, html);
```
to:
```ts
    const sent = await sendEmail(o.email, subject, html, { threadToken: token, threadRole: "root" });
```

(d) `sendDeclineEmailByToken` — **leave unchanged** (standalone, no thread).

- [ ] **Step 4: Run, verify pass**

Run: `cd vercel-app && npx vitest run src/app/api/telegram/webhook/route.test.ts`
Expected: PASS (whole file).

- [ ] **Step 5: Commit**

```bash
git add vercel-app/src/app/api/telegram/webhook/route.ts vercel-app/src/app/api/telegram/webhook/route.test.ts
git commit -m "feat(email): thread webhook status/delay/confirmation emails per order"
```

---

## Task 11: Full verification + staged deploy + live thread test

**Files:** none (verification + deploy)

- [ ] **Step 1: Full Vercel test suite**

Run: `cd vercel-app && npm test`
Expected: all tests PASS (was 120; now higher with the new email/header/stepper tests).

- [ ] **Step 2: Type-check the Vercel app**

Run: `cd vercel-app && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Website build (logo asset is part of this deploy)**

Run (from repo root): `npm run build`
Expected: build succeeds; confirm `dist/email-logo.png` exists in the output:
```bash
ls dist/email-logo.png
```
Expected: the file is listed.

- [ ] **Step 4: Deploy the website FIRST (so the logo URL resolves before emails use it)**

This pushes to `main`; GitHub Actions deploys to GitHub Pages. **Requires explicit owner approval to deploy.**
After deploy completes (~1 min), verify the logo is live:
```bash
curl -sI https://bistro-cloud.com/email-logo.png | head -1
```
Expected: `HTTP/2 200`.

- [ ] **Step 5: Deploy the Vercel email change**

Run: `cd vercel-app && vercel --prod --yes` — **Requires explicit owner approval.**
Then health-check:
```bash
curl -s https://bistro-cloud-orders.vercel.app/api/health
```
Expected: `{"ok":true}`.

- [ ] **Step 6: Live thread + Resend-header verification (the honesty flag from the spec)**

Place a real test order to a Gmail inbox, then walk it through the lifecycle via the Telegram buttons (Approve → Preparing → Out for delivery → Delivered). Verify:
- the **logo renders** at the top of each email,
- the **stepper advances** stage by stage,
- **all emails collapse into ONE Gmail thread**.

If Gmail splits them (Resend overrode the custom Message-ID), the constant subject (`Bistro Cloud — your order`) already provides subject-based fallback threading — confirm whether the thread still collapses on subject alone, and note the result. Refund/ignore any Loyverse test receipts created (Loyverse keeps sales permanently).

- [ ] **Step 7: Final commit / clean tree**

```bash
git status
```
Expected: clean (all task commits already made). Update memory notes if behavior changed materially.

---

## Self-Review (completed by plan author)

- **Spec coverage:** Branding/logo → Tasks 1, 5. Cream header + orange accent → Task 5. Status stepper mirroring /track → Task 4 (helper) + Tasks 6-8 (embedding). Threading Message-ID/In-Reply-To → Tasks 2-3 + wiring 9-10. Constant subject → Tasks 2, 6-8. Decline standalone → Tasks 5/10 (unchanged). Resend-header verification + subject fallback → Task 11 Step 6. Staged deploy (logo before Vercel) → Task 11 Steps 4-5. All spec sections mapped. ✓
- **Placeholder scan:** No TBD/TODO; every code step shows full code. ✓
- **Type consistency:** `StepperStage` defined in Task 4, reused in Tasks 7/8/10. `SendEmailOpts {threadToken, threadRole}` defined in Task 3, used identically in Tasks 9-10. `ORDER_SUBJECT`/`orderMessageId` defined in Task 2, used in 3/6/7/8. `statusStepper(stage)` signature consistent throughout. ✓
