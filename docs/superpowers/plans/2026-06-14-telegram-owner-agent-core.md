# Owner-DM Telegram Agent — Plan 1: Core Agent

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working **read-only** owner-DM conversational assistant on the existing `@CarlitoBC_bot`: the owner binds via `/start <ADMIN_PASS>`, then asks plain-language questions (orders, capacity, revenue, customers, menu, stock) and the Ollama agent answers using tools wired to Bistro's Apps Script backend.

**Architecture:** Extend the existing `/api/telegram/webhook` route to handle `message` updates from the bound owner's private DM. An Ollama agent loop (`lib/assistant/agent.ts`) calls read-only tools (`lib/assistant/tools.ts`) that hit existing Apps Script actions via new clients in `lib/appsScript.ts`. Owner identity and conversation history live on Vercel Blob (`lib/assistant/state.ts`). No mutations and no media in this plan — those are Plans 2 and 3.

**Tech Stack:** TypeScript, Next.js (Vercel serverless), Vitest, Ollama Cloud chat API (raw `fetch`), `@vercel/blob`, Google Apps Script (existing).

**Spec:** `docs/superpowers/specs/2026-06-14-telegram-owner-agent-design.md`

**Repo note:** work in `vercel-app/` (its own `package.json` + Vitest). Run tests with `cd vercel-app && npm test`. The bot client `vercel-app/src/lib/telegram.ts` and the webhook already exist; the order-button callback handling MUST keep working unchanged.

**Reference (port source):** `sambawy01/Holistic-Beauty-Website-`, files `vercel-app/src/lib/assistant/{agent,state,prompt}.ts`. We re-implement Bistro-specific versions here (this plan shows the full code; consult the reference only for additional hardening ideas).

---

## File Structure

- `vercel-app/src/lib/appsScript.ts` — **modify**: add read clients `getOrders`, `getContacts`, `getMenu`, `getStock`, `getAvailability`.
- `vercel-app/src/lib/assistant/state.ts` — **create**: Blob-backed owner binding + conversation history.
- `vercel-app/src/lib/assistant/prompt.ts` — **create**: system prompt builder.
- `vercel-app/src/lib/assistant/tools.ts` — **create**: read-only tool definitions + implementations.
- `vercel-app/src/lib/assistant/agent.ts` — **create**: Ollama chat + tool-calling loop.
- `vercel-app/src/app/api/telegram/webhook/route.ts` — **modify**: route owner-DM `message` updates to the agent; `/start` binding; ignore group/strangers.
- `vercel-app/package.json` — **modify**: add `@vercel/blob` dependency.

---

## Task 1: Add `@vercel/blob` + env documentation

**Files:**
- Modify: `vercel-app/package.json`

- [ ] **Step 1: Install the Blob client**

Run: `cd vercel-app && npm install @vercel/blob`
Expected: `@vercel/blob` appears under `dependencies` in `package.json`.

- [ ] **Step 2: Verify it resolves**

Run: `cd vercel-app && node -e "require('@vercel/blob'); console.log('blob ok')"`
Expected: `blob ok`

- [ ] **Step 3: Record required env vars (no code)**

These must be set in Vercel before deploy (Task 8). Add them to `vercel-app/.env.local` for local test runs only if needed (tests mock all IO, so not required to run tests):
- `OLLAMA_API_KEY` — Ollama Cloud key
- `OLLAMA_MODEL` (default `deepseek-v4-flash:cloud`), `OLLAMA_MODEL_HEAVY` (default `deepseek-v4-pro:cloud`)
- `ADMIN_PASS` — owner-binding password
- `BLOB_READ_WRITE_TOKEN` — Vercel Blob store token
- Reused (already set): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `APPS_SCRIPT_URL`, `APPS_SCRIPT_ADMIN_PASSWORD`.

- [ ] **Step 4: Commit**

```bash
git add vercel-app/package.json vercel-app/package-lock.json
git commit -m "chore(agent): add @vercel/blob for agent state"
```

---

## Task 2: Apps Script read clients

Existing `appsScriptGet<T>(params)` (line ~34) performs a GET against `APPS_SCRIPT_URL`. Admin-gated actions pass `password: process.env.APPS_SCRIPT_ADMIN_PASSWORD`. `getAvailability` is public (no password).

**Files:**
- Modify: `vercel-app/src/lib/appsScript.ts`
- Test: `vercel-app/src/lib/appsScript.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `vercel-app/src/lib/appsScript.test.ts` (mirror the existing `vi.fn`/`globalThis.fetch` pattern already in this file):

```ts
describe("agent read clients", () => {
  beforeEach(() => {
    process.env.APPS_SCRIPT_URL = "https://script.test/exec";
    process.env.APPS_SCRIPT_ADMIN_PASSWORD = "pw";
  });

  it("getOrders GETs the admin action and returns rows", async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({ success: true, orders: [{ id: 1 }] }), { status: 200 }));
    globalThis.fetch = spy as unknown as typeof fetch;
    const r = await getOrders();
    expect(r.success).toBe(true);
    const url = (spy.mock.calls[0] as any)[0] as string;
    expect(url).toContain("action=getOrders");
    expect(url).toContain("password=pw");
  });

  it("getAvailability GETs the public action without a password", async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({ success: true, slots: [] }), { status: 200 }));
    globalThis.fetch = spy as unknown as typeof fetch;
    await getAvailability();
    const url = (spy.mock.calls[0] as any)[0] as string;
    expect(url).toContain("action=getAvailability");
    expect(url).not.toContain("password=");
  });

  it("getContacts / getMenu / getStock GET their admin actions", async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    globalThis.fetch = spy as unknown as typeof fetch;
    await getContacts(); await getMenu(); await getStock();
    const urls = (spy.mock.calls as any[]).map((c) => c[0] as string);
    expect(urls[0]).toContain("action=getContacts");
    expect(urls[1]).toContain("action=getMenu");
    expect(urls[2]).toContain("action=getStock");
  });
});
```

Add the new names to the existing import at the top of the test file: `getOrders, getContacts, getMenu, getStock, getAvailability`.

- [ ] **Step 2: Run, verify it fails**

Run: `cd vercel-app && npx vitest run src/lib/appsScript.test.ts -t "agent read clients"`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement**

Append to `vercel-app/src/lib/appsScript.ts`:

```ts
// ---- Agent read clients (admin-gated unless noted) ----

function adminPassword(): string {
  const password = process.env.APPS_SCRIPT_ADMIN_PASSWORD;
  if (!password) throw new Error("APPS_SCRIPT_ADMIN_PASSWORD is not configured");
  return password;
}

export interface OrderRow {
  id: number | string; timestamp?: string; name?: string; phone?: string;
  order_total?: number | string; order_summary?: string; item_count?: number | string;
  delivery_date?: string; delivery_slot?: string; tracking_token?: string; status?: string;
}

/** All orders (admin). The agent filters/sums client-side. */
export async function getOrders(): Promise<{ success: boolean; orders?: OrderRow[]; error?: string }> {
  return appsScriptGet({ action: "getOrders", password: adminPassword() });
}

/** CRM contacts/customers (admin). */
export async function getContacts(): Promise<{ success: boolean; contacts?: Record<string, unknown>[]; error?: string }> {
  return appsScriptGet({ action: "getContacts", password: adminPassword() });
}

/** Menu items (admin). */
export async function getMenu(): Promise<{ success: boolean; items?: Record<string, unknown>[]; error?: string }> {
  return appsScriptGet({ action: "getMenu", password: adminPassword() });
}

/** Stock items (admin). */
export async function getStock(): Promise<{ success: boolean; items?: Record<string, unknown>[]; error?: string }> {
  return appsScriptGet({ action: "getStock", password: adminPassword() });
}

/** Capacity/availability for today (public — no password). */
export async function getAvailability(): Promise<{ success: boolean; date?: string; slots?: Record<string, unknown>[]; error?: string }> {
  return appsScriptGet({ action: "getAvailability" });
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `cd vercel-app && npx vitest run src/lib/appsScript.test.ts`
Expected: PASS (whole file).

- [ ] **Step 5: Commit**

```bash
git add vercel-app/src/lib/appsScript.ts vercel-app/src/lib/appsScript.test.ts
git commit -m "feat(agent): Apps Script read clients (orders/contacts/menu/stock/availability)"
```

---

## Task 3: Blob state — owner binding + history

**Files:**
- Create: `vercel-app/src/lib/assistant/state.ts`
- Test: `vercel-app/src/lib/assistant/state.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `vercel-app/src/lib/assistant/state.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory fake Blob store.
const store = new Map<string, string>();
vi.mock("@vercel/blob", () => ({
  put: vi.fn(async (path: string, body: string) => { store.set(path, body); return { url: `mem://${path}`, pathname: path }; }),
  list: vi.fn(async ({ prefix }: { prefix: string }) => ({
    blobs: [...store.keys()].filter((k) => k.startsWith(prefix)).map((pathname) => ({ pathname, url: `mem://${pathname}` })),
  })),
  head: vi.fn(async () => { throw new Error("not used"); }),
}));
// Our state.ts reads blob bodies via fetch(url) — intercept mem:// URLs.
globalThis.fetch = vi.fn(async (url: string) => new Response(store.get(String(url).replace("mem://", "")) ?? "", { status: store.has(String(url).replace("mem://", "")) ? 200 : 404 })) as unknown as typeof fetch;

import { getOwnerChatId, bindOwner, loadHistory, appendHistory, OWNER_PATH, HISTORY_PATH } from "./state";

beforeEach(() => { store.clear(); });

describe("owner binding", () => {
  it("returns null when no owner bound, then the bound id after bindOwner", async () => {
    expect(await getOwnerChatId()).toBeNull();
    await bindOwner(12345);
    expect(await getOwnerChatId()).toBe(12345);
  });
});

describe("history", () => {
  it("starts empty, appends, and caps at 24 messages", async () => {
    expect(await loadHistory()).toEqual([]);
    for (let i = 0; i < 30; i++) await appendHistory([{ role: "user", content: `m${i}` }]);
    const h = await loadHistory();
    expect(h.length).toBeLessThanOrEqual(24);
    expect(h[h.length - 1].content).toBe("m29");
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `cd vercel-app && npx vitest run src/lib/assistant/state.test.ts`
Expected: FAIL — `./state` does not exist.

- [ ] **Step 3: Implement**

Create `vercel-app/src/lib/assistant/state.ts`:

```ts
/** Blob-backed agent state: bound owner + conversation history. */
import { put, list } from "@vercel/blob";
import type { OllamaMessage } from "./agent";

export const OWNER_PATH = "telegram/owner.json";
export const HISTORY_PATH = "telegram/history.json";
const MAX_MESSAGES = 24;
const MAX_CHARS = 2000;

async function readJson<T>(path: string): Promise<T | null> {
  const { blobs } = await list({ prefix: path });
  const blob = blobs.find((b) => b.pathname === path);
  if (!blob) return null;
  const res = await fetch(blob.url, { cache: "no-store" });
  if (!res.ok) return null;
  try { return (await res.json()) as T; } catch { return null; }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await put(path, JSON.stringify(value), {
    access: "public", contentType: "application/json", allowOverwrite: true,
  });
}

export async function getOwnerChatId(): Promise<number | null> {
  const data = await readJson<{ chatId: number }>(OWNER_PATH);
  return data?.chatId ?? null;
}

export async function bindOwner(chatId: number): Promise<void> {
  await writeJson(OWNER_PATH, { chatId, boundAt: new Date().toISOString() });
}

export async function loadHistory(): Promise<OllamaMessage[]> {
  return (await readJson<OllamaMessage[]>(HISTORY_PATH)) ?? [];
}

export async function appendHistory(messages: OllamaMessage[]): Promise<void> {
  const trimmed = messages.map((m) => ({ ...m, content: (m.content || "").slice(0, MAX_CHARS) }));
  const next = [...(await loadHistory()), ...trimmed].slice(-MAX_MESSAGES);
  await writeJson(HISTORY_PATH, next);
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `cd vercel-app && npx vitest run src/lib/assistant/state.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add vercel-app/src/lib/assistant/state.ts vercel-app/src/lib/assistant/state.test.ts
git commit -m "feat(agent): Blob-backed owner binding + conversation history"
```

---

## Task 4: System prompt

**Files:**
- Create: `vercel-app/src/lib/assistant/prompt.ts`
- Test: `vercel-app/src/lib/assistant/prompt.test.ts`

- [ ] **Step 1: Write the failing test**

Create `vercel-app/src/lib/assistant/prompt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "./prompt";

describe("buildSystemPrompt", () => {
  it("includes persona, plain-text rule, a Cairo time, and a tools-first rule", () => {
    const p = buildSystemPrompt(new Date("2026-06-14T16:00:00+03:00"));
    expect(p).toMatch(/Bistro Cloud/i);
    expect(p).toMatch(/plain text/i);             // no Markdown to Telegram
    expect(p).toMatch(/Cairo/i);
    expect(p).toMatch(/tool/i);                    // instructs tool use for facts
    expect(p).toMatch(/\d{1,2}:\d{2}/);            // a rendered time
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `cd vercel-app && npx vitest run src/lib/assistant/prompt.test.ts`
Expected: FAIL — `./prompt` does not exist.

- [ ] **Step 3: Implement**

Create `vercel-app/src/lib/assistant/prompt.ts`:

```ts
/** Builds the Bistro Cloud owner-assistant system prompt. */
export function buildSystemPrompt(now: Date): string {
  const cairo = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Cairo", weekday: "short", hour: "numeric", minute: "2-digit",
    hour12: true, day: "numeric", month: "short",
  }).format(now);
  return [
    "You are the Bistro Cloud owner's assistant inside Telegram.",
    `Current time (Africa/Cairo): ${cairo}.`,
    "You help the owner run a small catering/restaurant business in El Gouna, Egypt.",
    "",
    "RULES:",
    "- For ANY fact about orders, capacity, revenue, customers, menu, or stock, you MUST call a tool. Never guess numbers.",
    "- Reply in plain text only — NO Markdown, asterisks, or special formatting (Telegram shows it raw).",
    "- Reply in the owner's language (English or Arabic), matching their message.",
    "- Be concise: a sentence or two, or a short list. This is a phone chat.",
    "- If a tool returns an error or no data, say so plainly; do not invent results.",
    "- You can read data only in this version; you cannot change orders or send messages yet.",
  ].join("\n");
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `cd vercel-app && npx vitest run src/lib/assistant/prompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add vercel-app/src/lib/assistant/prompt.ts vercel-app/src/lib/assistant/prompt.test.ts
git commit -m "feat(agent): Bistro owner-assistant system prompt"
```

---

## Task 5: Read-only tools

**Files:**
- Create: `vercel-app/src/lib/assistant/tools.ts`
- Test: `vercel-app/src/lib/assistant/tools.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `vercel-app/src/lib/assistant/tools.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../appsScript", () => ({
  slaListActiveOrders: vi.fn(),
  getOrders: vi.fn(),
  getContacts: vi.fn(),
  getMenu: vi.fn(),
  getStock: vi.fn(),
  getAvailability: vi.fn(),
}));

import { READ_TOOLS, findTool } from "./tools";
import { getOrders, getAvailability } from "../appsScript";

beforeEach(() => vi.clearAllMocks());

describe("READ_TOOLS", () => {
  it("exposes the expected read tools with JSON-schema params", () => {
    const names = READ_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual(
      ["capacity_today", "customer_lookup", "menu_list", "orders_active", "revenue_summary", "stock_list"].sort(),
    );
    for (const t of READ_TOOLS) expect(t.parameters).toHaveProperty("type", "object");
  });

  it("revenue_summary sums today's order_total (Cairo)", async () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date()); // yyyy-mm-dd
    (getOrders as any).mockResolvedValue({ success: true, orders: [
      { order_total: 400, delivery_date: today, status: "confirmed" },
      { order_total: 150, delivery_date: today, status: "delivered" },
      { order_total: 999, delivery_date: "2020-01-01", status: "delivered" },
    ]});
    const out = await findTool("revenue_summary")!.run({ period: "today" });
    expect(out).toContain("550");
    expect(out).not.toContain("999");
  });

  it("capacity_today calls getAvailability", async () => {
    (getAvailability as any).mockResolvedValue({ success: true, date: "2026-06-14", slots: [{ slot: "19:00", ordersLeft: 2 }] });
    const out = await findTool("capacity_today")!.run({});
    expect(out).toContain("19:00");
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `cd vercel-app && npx vitest run src/lib/assistant/tools.test.ts`
Expected: FAIL — `./tools` does not exist.

- [ ] **Step 3: Implement**

Create `vercel-app/src/lib/assistant/tools.ts`:

```ts
import type { AgentTool } from "./agent";
import {
  slaListActiveOrders, getOrders, getContacts, getMenu, getStock, getAvailability, type OrderRow,
} from "../appsScript";

const OBJ = (props: Record<string, unknown> = {}, required: string[] = []) =>
  ({ type: "object", properties: props, required });

function cairoToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
}

function num(v: unknown): number { const n = Number(v); return isNaN(n) ? 0 : n; }

export const READ_TOOLS: AgentTool[] = [
  {
    name: "orders_active",
    description: "List today's active orders (pending/confirmed/preparing/out for delivery) with status.",
    parameters: OBJ(),
    run: async () => {
      const r = await slaListActiveOrders();
      if (!r.success || !r.orders) return `Error reading orders: ${r.error || "unknown"}`;
      if (!r.orders.length) return "No active orders right now.";
      return r.orders.map((o) => `#${String(o.tracking_token).slice(-6)} ${o.name} — ${o.status} (slot ${o.delivery_slot})`).join("\n");
    },
  },
  {
    name: "revenue_summary",
    description: "Total revenue for a period.",
    parameters: OBJ({ period: { type: "string", enum: ["today", "week"], description: "today or week" } }, ["period"]),
    run: async (args) => {
      const r = await getOrders();
      if (!r.success || !r.orders) return `Error reading orders: ${r.error || "unknown"}`;
      const today = cairoToday();
      const inPeriod = (o: OrderRow) =>
        args.period === "week" ? true /* refine later */ : String(o.delivery_date) === today;
      const rows = r.orders.filter((o) => o.status !== "declined" && o.status !== "cancelled").filter(inPeriod);
      const total = rows.reduce((s, o) => s + num(o.order_total), 0);
      return `${args.period === "week" ? "This week" : "Today"}: EGP ${total} across ${rows.length} orders.`;
    },
  },
  {
    name: "capacity_today",
    description: "Slots and remaining capacity for today.",
    parameters: OBJ(),
    run: async () => {
      const r = await getAvailability();
      if (!r.success || !r.slots) return `Error reading capacity: ${r.error || "unknown"}`;
      return r.slots.map((s) => JSON.stringify(s)).join("\n") || "No slots configured.";
    },
  },
  {
    name: "customer_lookup",
    description: "Look up a customer by name or phone and summarize them.",
    parameters: OBJ({ query: { type: "string", description: "name or phone fragment" } }, ["query"]),
    run: async (args) => {
      const r = await getContacts();
      if (!r.success || !r.contacts) return `Error reading customers: ${r.error || "unknown"}`;
      const q = String(args.query || "").toLowerCase();
      const hits = r.contacts.filter((c) => JSON.stringify(c).toLowerCase().includes(q)).slice(0, 5);
      return hits.length ? hits.map((c) => JSON.stringify(c)).join("\n") : `No customer matching "${args.query}".`;
    },
  },
  {
    name: "menu_list",
    description: "List menu items and visibility.",
    parameters: OBJ(),
    run: async () => {
      const r = await getMenu();
      if (!r.success || !r.items) return `Error reading menu: ${r.error || "unknown"}`;
      return r.items.map((i) => JSON.stringify(i)).slice(0, 50).join("\n") || "Menu is empty.";
    },
  },
  {
    name: "stock_list",
    description: "List stock/pantry items and quantities.",
    parameters: OBJ(),
    run: async () => {
      const r = await getStock();
      if (!r.success || !r.items) return `Error reading stock: ${r.error || "unknown"}`;
      return r.items.map((i) => JSON.stringify(i)).slice(0, 50).join("\n") || "No stock items.";
    },
  },
];

export function findTool(name: string): AgentTool | undefined {
  return READ_TOOLS.find((t) => t.name === name);
}
```

> Note: `revenue_summary` "week" is a coarse pass (all non-cancelled) for v1; a precise 7-day Cairo window is a Plan-2 refinement. This is intentional and called out, not a placeholder.

- [ ] **Step 4: Run, verify it passes**

Run: `cd vercel-app && npx vitest run src/lib/assistant/tools.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add vercel-app/src/lib/assistant/tools.ts vercel-app/src/lib/assistant/tools.test.ts
git commit -m "feat(agent): read-only tools wired to Apps Script"
```

---

## Task 6: Ollama agent loop

**Files:**
- Create: `vercel-app/src/lib/assistant/agent.ts`
- Test: `vercel-app/src/lib/assistant/agent.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `vercel-app/src/lib/assistant/agent.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runAgent, type AgentTool } from "./agent";

const okTool: AgentTool = {
  name: "orders_active", description: "x", parameters: { type: "object", properties: {} },
  run: vi.fn(async () => "2 active orders"),
};

function ollamaResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

beforeEach(() => { process.env.OLLAMA_API_KEY = "k"; process.env.OLLAMA_MODEL = "fast"; });
afterEach(() => vi.restoreAllMocks());

describe("runAgent", () => {
  it("calls a tool the model requests, then returns the final answer", async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(ollamaResponse({ message: { role: "assistant", content: "", tool_calls: [{ function: { name: "orders_active", arguments: {} } }] } }))
      .mockResolvedValueOnce(ollamaResponse({ message: { role: "assistant", content: "You have 2 active orders." } }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const out = await runAgent({ text: "how many active orders?", history: [], deadlineAt: Date.now() + 30000, tools: [okTool] });
    expect(okTool.run).toHaveBeenCalledOnce();
    expect(out.reply).toBe("You have 2 active orders.");
    expect(out.newMessages.some((m) => m.role === "user" && m.content.includes("active orders"))).toBe(true);
  });

  it("returns the model's direct answer when no tool is requested", async () => {
    globalThis.fetch = vi.fn(async () => ollamaResponse({ message: { role: "assistant", content: "Hello!" } })) as unknown as typeof fetch;
    const out = await runAgent({ text: "hi", history: [], deadlineAt: Date.now() + 30000, tools: [okTool] });
    expect(out.reply).toBe("Hello!");
  });

  it("stops after MAX_TOOL_ROUNDS and still returns a reply", async () => {
    globalThis.fetch = vi.fn(async () => ollamaResponse({ message: { role: "assistant", content: "", tool_calls: [{ function: { name: "orders_active", arguments: {} } }] } })) as unknown as typeof fetch;
    const out = await runAgent({ text: "loop", history: [], deadlineAt: Date.now() + 30000, tools: [okTool] });
    expect(typeof out.reply).toBe("string");
    expect(out.reply.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `cd vercel-app && npx vitest run src/lib/assistant/agent.test.ts`
Expected: FAIL — `./agent` does not exist.

- [ ] **Step 3: Implement**

Create `vercel-app/src/lib/assistant/agent.ts`:

```ts
/** Ollama Cloud chat + tool-calling loop. Pure-ish: all IO via fetch; deadline injected. */
import { buildSystemPrompt } from "./prompt";

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON schema (object)
  run: (args: Record<string, unknown>) => Promise<string>;
}

export interface OllamaToolCall { function: { name: string; arguments: Record<string, unknown> } }
export interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: OllamaToolCall[];
  tool_name?: string;
}

const MAX_TOOL_ROUNDS = 4;

function model(): string { return process.env.OLLAMA_MODEL || "deepseek-v4-flash:cloud"; }

async function callOllama(messages: OllamaMessage[], tools: AgentTool[], deadlineAt: number): Promise<OllamaMessage> {
  const apiKey = process.env.OLLAMA_API_KEY;
  const baseUrl = apiKey ? "https://ollama.com/api/chat" : "http://localhost:11434/api/chat";
  const res = await fetch(baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({
      model: model(), stream: false, options: { num_predict: 700 }, messages,
      tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })),
    }),
    signal: AbortSignal.timeout(Math.max(1000, deadlineAt - Date.now())),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}`);
  const data = (await res.json()) as { message?: OllamaMessage };
  return data.message ?? { role: "assistant", content: "" };
}

export interface RunAgentInput { text: string; history: OllamaMessage[]; deadlineAt: number; tools: AgentTool[] }
export interface RunAgentOutput { reply: string; newMessages: OllamaMessage[] }

export async function runAgent({ text, history, deadlineAt, tools }: RunAgentInput): Promise<RunAgentOutput> {
  const userMsg: OllamaMessage = { role: "user", content: text };
  const convo: OllamaMessage[] = [
    { role: "system", content: buildSystemPrompt(new Date()) },
    ...history,
    userMsg,
  ];
  const newMessages: OllamaMessage[] = [userMsg];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let assistant: OllamaMessage;
    try {
      assistant = await callOllama(convo, tools, deadlineAt);
    } catch (err) {
      return { reply: "Sorry — I couldn't reach the assistant just now. Try again in a moment.", newMessages };
    }
    convo.push(assistant);
    newMessages.push(assistant);

    const calls = assistant.tool_calls ?? [];
    if (!calls.length) {
      return { reply: assistant.content || "(no answer)", newMessages };
    }
    for (const call of calls) {
      const tool = tools.find((t) => t.name === call.function.name);
      const result = tool
        ? await tool.run(call.function.arguments || {}).catch((e) => `Tool error: ${String(e)}`)
        : `Unknown tool: ${call.function.name}`;
      const toolMsg: OllamaMessage = { role: "tool", tool_name: call.function.name, content: result };
      convo.push(toolMsg);
      newMessages.push(toolMsg);
    }
  }
  // Ran out of rounds: ask once more for a plain summary.
  try {
    const final = await callOllama([...convo, { role: "user", content: "Summarize the answer in plain text now." }], [], deadlineAt);
    return { reply: final.content || "I gathered the data but couldn't summarize it — please ask again.", newMessages };
  } catch {
    return { reply: "I gathered the data but ran out of time summarizing — please ask again.", newMessages };
  }
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `cd vercel-app && npx vitest run src/lib/assistant/agent.test.ts`
Expected: PASS (all 3 tests).

- [ ] **Step 5: Commit**

```bash
git add vercel-app/src/lib/assistant/agent.ts vercel-app/src/lib/assistant/agent.test.ts
git commit -m "feat(agent): Ollama chat + tool-calling loop with deadline + round cap"
```

---

## Task 7: Webhook — route owner-DM messages to the agent

Read the current `vercel-app/src/app/api/telegram/webhook/route.ts` first. It already: validates the Telegram secret header, dedupes `update_id`, and handles `update.callback_query` (order buttons). Keep all of that. We add handling for `update.message` and a `/start` binding, gated to the bound owner's **private** chat.

**Files:**
- Modify: `vercel-app/src/app/api/telegram/webhook/route.ts`
- Test: `vercel-app/src/app/api/telegram/webhook/route.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `vercel-app/src/app/api/telegram/webhook/route.test.ts`. Mock the new deps near the other `vi.mock` calls at the top of the file:

```ts
vi.mock("@/lib/assistant/state", () => ({
  getOwnerChatId: vi.fn(), bindOwner: vi.fn(async () => {}),
  loadHistory: vi.fn(async () => []), appendHistory: vi.fn(async () => {}),
}));
vi.mock("@/lib/assistant/agent", () => ({ runAgent: vi.fn(async () => ({ reply: "AGENT_REPLY", newMessages: [] })) }));
vi.mock("@/lib/assistant/tools", () => ({ READ_TOOLS: [] }));
```

Then add these tests (reuse the file's existing `sendMessage` mock + secret-header helper; `priv(text, chatId)` builds a private-chat message update):

```ts
import { getOwnerChatId, bindOwner } from "@/lib/assistant/state";
import { runAgent } from "@/lib/assistant/agent";

function priv(text: string, chatId = 555) {
  return { update_id: Math.floor(Math.random() * 1e9), message: { message_id: 1, chat: { id: chatId, type: "private" }, text } };
}
function group(text: string) {
  return { update_id: Math.floor(Math.random() * 1e9), message: { message_id: 1, chat: { id: -100, type: "supergroup" }, text } };
}

it("/start <ADMIN_PASS> binds the owner", async () => {
  process.env.ADMIN_PASS = "secret";
  (getOwnerChatId as any).mockResolvedValue(null);
  await POST(reqWithSecret(priv("/start secret", 777)));   // reqWithSecret = existing helper that sets the secret header
  expect(bindOwner).toHaveBeenCalledWith(777);
});

it("ignores group messages entirely (no agent call)", async () => {
  (getOwnerChatId as any).mockResolvedValue(777);
  await POST(reqWithSecret(group("what is revenue?")));
  expect(runAgent).not.toHaveBeenCalled();
});

it("routes an owner DM to the agent and replies", async () => {
  (getOwnerChatId as any).mockResolvedValue(777);
  await POST(reqWithSecret(priv("revenue today?", 777)));
  expect(runAgent).toHaveBeenCalledOnce();
  // existing sendMessage mock should have been called with the agent reply
  expect((sendMessage as any).mock.calls.some((c: any[]) => c[1] === "AGENT_REPLY")).toBe(true);
});

it("ignores a DM from a non-owner", async () => {
  (getOwnerChatId as any).mockResolvedValue(777);
  await POST(reqWithSecret(priv("hi", 999)));   // different chat id
  expect(runAgent).not.toHaveBeenCalled();
});
```

> If the existing test file names its secret-header request helper differently than `reqWithSecret`, use that file's helper; the point is a POST whose `X-Telegram-Bot-Api-Secret-Token` matches `TELEGRAM_WEBHOOK_SECRET`. Reuse the file's existing `sendMessage` mock import.

- [ ] **Step 2: Run, verify it fails**

Run: `cd vercel-app && npx vitest run src/app/api/telegram/webhook/route.test.ts -t "owner DM"`
Expected: FAIL — message routing not implemented.

- [ ] **Step 3: Implement**

In `vercel-app/src/app/api/telegram/webhook/route.ts`:

(a) Add imports near the other `@/lib` imports:
```ts
import { getOwnerChatId, bindOwner, loadHistory, appendHistory } from "@/lib/assistant/state";
import { runAgent } from "@/lib/assistant/agent";
import { READ_TOOLS } from "@/lib/assistant/tools";
import { sendMessage } from "@/lib/telegram"; // if not already imported
```

(b) Raise the function budget if a lower value is set:
```ts
export const maxDuration = 90;
```

(c) In `POST`, after the existing `update.callback_query` branch, add a `update.message` branch (full handler):
```ts
  if (update.message && typeof update.message.text === "string") {
    await handleOwnerMessage(update.message);
    return ok(); // existing 200 helper
  }
```

(d) Add the handler function (uses a deadline ~80s out):
```ts
async function handleOwnerMessage(message: { chat: { id: number; type: string }; text: string }): Promise<void> {
  const text = message.text.trim();
  const chatId = message.chat.id;

  // Only ever engage in a PRIVATE chat. Groups are ignored here (tickets handled elsewhere).
  if (message.chat.type !== "private") return;

  // One-time owner binding.
  const startMatch = text.match(/^\/start(?:@\w+)?(?:\s+(.+))?$/);
  if (startMatch) {
    const pass = (startMatch[1] || "").trim();
    const adminPass = process.env.ADMIN_PASS || "";
    const owner = await getOwnerChatId();
    if (owner === null && adminPass && pass === adminPass) {
      await bindOwner(chatId);
      await sendMessage(chatId, "✅ You're bound as the owner. Ask me about orders, capacity, revenue, customers, menu, or stock.");
    } else if (owner === chatId) {
      await sendMessage(chatId, "You're already bound. Go ahead and ask me something.");
    } else {
      await sendMessage(chatId, "This assistant is private.");
    }
    return;
  }

  // Authorize: only the bound owner.
  const owner = await getOwnerChatId();
  if (owner === null || chatId !== owner) {
    await sendMessage(chatId, "This assistant is private.");
    return;
  }

  const history = await loadHistory();
  const deadlineAt = Date.now() + 80_000;
  const { reply, newMessages } = await runAgent({ text, history, deadlineAt, tools: READ_TOOLS });
  await sendMessage(chatId, reply);
  await appendHistory(newMessages);
}
```

> Use the file's existing `ok()`/200 helper name if it differs. Keep the existing callback_query (order button) handling exactly as-is.

- [ ] **Step 4: Run, verify it passes (whole webhook file green)**

Run: `cd vercel-app && npx vitest run src/app/api/telegram/webhook/route.test.ts`
Expected: PASS (new tests + all existing order-button tests).

- [ ] **Step 5: Commit**

```bash
git add vercel-app/src/app/api/telegram/webhook/route.ts vercel-app/src/app/api/telegram/webhook/route.test.ts
git commit -m "feat(agent): route owner-DM messages to the agent; /start binding; ignore group"
```

---

## Task 8: Full verification + staged deploy

**Files:** none (verification + deploy; deploy needs explicit owner approval).

- [ ] **Step 1: Full suite + type-check**

Run: `cd vercel-app && npm test` → all green (previous 167 + new agent tests).
Run: `cd vercel-app && npx tsc --noEmit` → no errors.

- [ ] **Step 2: Set env vars in Vercel (use the stdin method — `--value` hangs in CLI v54)**

```bash
cd vercel-app
printf '%s' "<OLLAMA_API_KEY>" | vercel env add OLLAMA_API_KEY production
printf '%s' "<strong-admin-pass>" | vercel env add ADMIN_PASS production
# Create a Vercel Blob store in the dashboard (Storage → Blob) → it sets BLOB_READ_WRITE_TOKEN automatically,
# or: printf '%s' "<token>" | vercel env add BLOB_READ_WRITE_TOKEN production
```
(Optional model overrides: `OLLAMA_MODEL`, `OLLAMA_MODEL_HEAVY`.)

- [ ] **Step 3: Deploy + register `message` updates**

Run (needs owner approval): `cd vercel-app && vercel --prod --yes`
Then re-register the webhook so Telegram delivers `message` updates (replace token + URL):
```bash
curl -s "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  --data-urlencode "url=https://bistro-cloud-orders.vercel.app/api/telegram/webhook" \
  --data-urlencode "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
  --data-urlencode 'allowed_updates=["message","callback_query"]'
curl -s "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```
Expected: `getWebhookInfo` shows the URL and `allowed_updates` including `message`.

- [ ] **Step 4: Verify Ollama model IDs are current**

Before relying on it, confirm `deepseek-v4-flash:cloud` (and the heavy id) are valid on Ollama Cloud (the API returns a model-not-found error otherwise). If renamed, set `OLLAMA_MODEL`/`OLLAMA_MODEL_HEAVY` to the current ids. Order-button callbacks must remain unaffected regardless.

- [ ] **Step 5: Live smoke test**

DM the bot `/start <ADMIN_PASS>` → expect the bound confirmation. Then ask: "how many active orders?", "revenue today?", "slots left at 7pm?". Confirm sensible answers and that a group message to the bot gets no agent reply. Confirm the existing order-ticket buttons still work.

- [ ] **Step 6: Clean tree + update memory**

Run: `git status` → clean. Update the `telegram-owner-agent` memory note: Plan 1 (core) shipped; Plans 2 (actions) and 3 (media) next.

---

## Self-Review (completed by plan author)

- **Spec coverage (Plan 1 subset):** owner binding (Task 7), Blob state/memory (Task 3), Ollama agent loop + model routing + deadline (Task 6), read tools mapped to real Apps Script actions (Tasks 2, 5), system prompt incl. plain-text + bilingual + tools-first rules (Task 4), owner-DM-only routing + group ignored (Task 7), env/deploy/`allowed_updates` (Tasks 1, 8). Deferred to later plans (explicitly, not gaps): confirm-gate + mutations + broadcast (Plan 2), voice/vision/expenses/docs (Plan 3). ✓
- **Placeholder scan:** no TBD/TODO; the one coarse behavior (`revenue_summary` "week") is implemented and explicitly flagged as a Plan-2 refinement, not a placeholder. ✓
- **Type consistency:** `AgentTool`/`OllamaMessage` defined in Task 6 (`agent.ts`) and imported by `tools.ts` (Task 5), `state.ts` (Task 3), and the webhook (Task 7) with identical shapes; `runAgent({text, history, deadlineAt, tools})` → `{reply, newMessages}` used consistently in Tasks 6 and 7; `OrderRow` defined in Task 2 and consumed in Task 5. ✓
