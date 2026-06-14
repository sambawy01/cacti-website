/**
 * Bistro Cloud owner-DM Telegram agent — tool catalog (design §5).
 *
 * Two classes of tools:
 * - READ-ONLY (orders_active, order_lookup, capacity_today, revenue_summary,
 *   customer_lookup, menu_list, stock_list) execute immediately inside the
 *   agent loop.
 * - MUTATING (order_set_status, order_delay, order_finalize,
 *   menu_set_out_of_stock, requisition_decide, broadcast_group, log_expense)
 *   are NEVER executed by the model directly. The agent loop intercepts them,
 *   stores a pending action, and the owner gets a [Confirm | Cancel] inline
 *   keyboard. Only the callback handler calls `executeTool` for these.
 *
 * Unlike the reference (which has an owner-email allowlist that lets
 * email_send-to-self skip the gate), there is NO allowlist concept here —
 * EVERY mutating tool always gates. `describeMutation` builds the
 * confirmation summary structurally so disclosure cannot depend on the
 * model's mood.
 */

import {
  slaListActiveOrders, getOrderStatus, getAvailabilitySummary, getCrmOrdersList,
  getContactsList, getMenuList, getStockList, getPantryList,
  setOrderStatusByToken, delayOrder, orderFinalize,
  toggleMenuVisibility, togglePantryVisibility, decideRequisition, logExpense,
  type OrderStatus, type CrmOrder,
} from "@/lib/appsScript";
import { sendMessage } from "@/lib/telegram";

export interface ToolContext {
  chatId: number;
}

/**
 * Cairo (Africa/Cairo) calendar date as yyyy-MM-dd. Used by revenue_summary to
 * window CRM orders client-side, because getCRMOrders ignores any range param
 * and returns the whole Orders tab. en-CA formats as yyyy-MM-dd.
 */
function cairoDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

// --- Ollama tool schemas ------------------------------------------------------

export interface OllamaTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}

function tool(
  name: string,
  description: string,
  properties: Record<string, unknown> = {},
  required: string[] = []
): OllamaTool {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: { type: "object", properties, required },
    },
  };
}

/**
 * Valid order statuses for the enum check. Declared as a Record keyed by
 * OrderStatus so that adding a new member to the OrderStatus union forces a
 * compile error HERE (missing key) — the list can't silently drift out of sync.
 */
const ORDER_STATUS_SET: Record<OrderStatus, true> = {
  pending_approval: true,
  confirmed: true,
  preparing: true,
  out_for_delivery: true,
  delivered: true,
  declined: true,
  cancelled: true,
};
const ORDER_STATUSES = Object.keys(ORDER_STATUS_SET) as OrderStatus[];

export const TOOLS: OllamaTool[] = [
  // ---- read ----
  tool(
    "orders_active",
    "List today's ACTIVE orders (Cairo time): customer, status, delivery slot, summary. Read-only."
  ),
  tool(
    "order_lookup",
    "Look up one order by its tracking token: customer, status, slot, date, total, summary. Read-only.",
    { token: { type: "string", description: "Order tracking token" } },
    ["token"]
  ),
  tool(
    "capacity_today",
    "Show today's kitchen capacity per delivery slot (orders left / items left). Read-only.",
    { slot: { type: "string", description: "Optional HH:mm slot to filter to one slot" } }
  ),
  tool(
    "revenue_summary",
    "Total revenue today or this week from CRM orders (excludes declined/cancelled). Read-only.",
    { period: { type: "string", enum: ["today", "week"], description: "Time window (default today)" } }
  ),
  tool(
    "customer_lookup",
    "Find a contact by name or phone: name, phone, email. Read-only.",
    { query: { type: "string", description: "Name or phone fragment to search for" } },
    ["query"]
  ),
  tool(
    "menu_list",
    "List menu items with their visibility (hidden = currently off the menu). Read-only."
  ),
  tool(
    "stock_list",
    "List kitchen stock quantities and pantry items with visibility. Read-only."
  ),
  // ---- mutate ----
  tool(
    "order_set_status",
    "Set an order's status by tracking token. MUTATING — requires the owner's button confirmation. The customer is emailed the new status.",
    {
      token: { type: "string", description: "Order tracking token" },
      status: { type: "string", enum: ORDER_STATUSES, description: "New order status" },
    },
    ["token", "status"]
  ),
  tool(
    "order_delay",
    "Push an order's delivery slot forward by N minutes (15/30/60). MUTATING — requires confirmation. The customer is emailed the new ETA.",
    {
      token: { type: "string", description: "Order tracking token" },
      minutes: { type: "number", description: "Minutes to delay (15, 30, or 60)" },
    },
    ["token", "minutes"]
  ),
  tool(
    "order_finalize",
    "Approve/finalize an order (kitchen calendar + confirmation email + customer upsert). MUTATING — requires confirmation.",
    {
      token: { type: "string", description: "Order tracking token" },
      payment: { type: "string", description: "Optional instapay details to thread into the confirmation email" },
    },
    ["token"]
  ),
  tool(
    "menu_set_out_of_stock",
    "Mark a menu item out of stock (hidden) or available again. MUTATING — requires confirmation. Call menu_list FIRST to get the item's row number (the leading #).",
    {
      rowIndex: { type: "number", description: "The item's sheet row number, shown as the leading #N in menu_list output" },
      outOfStock: { type: "boolean", description: "true = mark out of stock/hidden, false = make available" },
      pantry: { type: "boolean", description: "true to target a pantry item instead of a menu item" },
    },
    ["rowIndex", "outOfStock"]
  ),
  tool(
    "requisition_decide",
    "Approve or reject a stock requisition by its sheet row number. MUTATING — requires confirmation. The owner must supply the requisition's row number (there is no requisition-list tool yet).",
    {
      rowIndex: { type: "number", description: "Requisition row number in the Requisitions sheet (>= 2)" },
      decision: { type: "string", enum: ["approve", "reject"], description: "Decision" },
    },
    ["rowIndex", "decision"]
  ),
  tool(
    "broadcast_group",
    "Send a plain-text message to the Sales/Owners Telegram group. MUTATING — requires confirmation.",
    { text: { type: "string", description: "Message to broadcast to the group" } },
    ["text"]
  ),
  tool(
    "log_expense",
    "Log a business expense to the books. MUTATING — requires confirmation. Private — not visible to customers.",
    {
      vendor: { type: "string", description: "Who was paid" },
      amountEgp: { type: "number", description: "Amount in EGP (positive)" },
      date: { type: "string", description: "Optional date (yyyy-MM-dd); defaults to today" },
      category: { type: "string", description: "Optional expense category" },
      note: { type: "string", description: "Optional note" },
    },
    ["vendor", "amountEgp"]
  ),
];

// --- Confirmation gate --------------------------------------------------------

const MUTATING_TOOLS = new Set([
  "order_set_status",
  "order_delay",
  "order_finalize",
  "menu_set_out_of_stock",
  "requisition_decide",
  "broadcast_group",
  "log_expense",
]);

/**
 * Does this tool call need the owner's [Confirm] tap before executing?
 * Every mutating tool always gates — there is no allowlist exception here.
 */
export function requiresConfirmation(name: string, _args: Record<string, unknown>): boolean {
  return MUTATING_TOOLS.has(name);
}

// --- Mutation argument validation ---------------------------------------------

export type ValidatedArgs =
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * Normalize and validate a MUTATING tool call's arguments against its
 * declared schema — ONCE, before the pending action is created. Both the
 * confirmation summary (describeMutation) and the executor consume the
 * returned object, so what the owner confirms is exactly what executes.
 *
 * - string params: type-checked, trimmed, enum-checked (e.g. `status` vs
 *   OrderStatus, `decision` vs approve/reject); a required empty string refuses.
 * - number params (`minutes`, `amountEgp`): a numeric STRING that round-trips
 *   losslessly through Number() is coerced (LLMs emit numbers-as-strings
 *   constantly); anything lossy or non-numeric refuses. `amountEgp` must be > 0.
 * - boolean params: type-checked.
 * - required-but-missing refuses; undeclared params are dropped.
 */
export function validateMutationArgs(name: string, args: Record<string, unknown>): ValidatedArgs {
  const schema = TOOLS.find((t) => t.function.name === name);
  if (!schema) return { ok: false, error: `unknown tool "${name}"` };
  const { properties, required } = schema.function.parameters;
  const requiredSet = new Set(required);
  const normalized: Record<string, unknown> = {};

  for (const [key, spec] of Object.entries(properties)) {
    const declared = (spec as { type?: string; enum?: string[] }) ?? {};
    const value = args[key];

    if (value === undefined || value === null) {
      if (requiredSet.has(key)) return { ok: false, error: `required parameter "${key}" is missing` };
      continue;
    }

    if (declared.type === "string") {
      if (typeof value !== "string") return { ok: false, error: `parameter "${key}" must be a single text value` };
      const trimmed = value.trim();
      if (requiredSet.has(key) && trimmed.length === 0) return { ok: false, error: `required parameter "${key}" is empty` };
      if (declared.enum && !declared.enum.includes(trimmed)) {
        return { ok: false, error: `parameter "${key}" must be one of: ${declared.enum.join(", ")}` };
      }
      normalized[key] = trimmed;
    } else if (declared.type === "number") {
      let num: unknown = value;
      if (typeof num === "string") {
        const trimmed = num.trim();
        const coerced = Number(trimmed);
        if (trimmed.length > 0 && Number.isFinite(coerced) && String(coerced) === trimmed) num = coerced;
      }
      if (typeof num !== "number" || !Number.isFinite(num)) return { ok: false, error: `parameter "${key}" must be a number` };
      if (key === "amountEgp" && num <= 0) return { ok: false, error: `parameter "amountEgp" must be a positive number of EGP` };
      normalized[key] = num;
    } else if (declared.type === "boolean") {
      if (typeof value !== "boolean") return { ok: false, error: `parameter "${key}" must be true or false` };
      normalized[key] = value;
    } else {
      return { ok: false, error: `parameter "${key}" has an unsupported type` };
    }
  }

  return { ok: true, args: normalized };
}

// --- Confirmation summary -----------------------------------------------------

/**
 * Human summary of a mutating call, shown above [Confirm | Cancel]. Built
 * structurally here so the side-effect disclosure is guaranteed by code,
 * never dependent on the model choosing to mention it.
 */
export function describeMutation(name: string, args: Record<string, unknown>): string {
  const s = (k: string) => (typeof args[k] === "string" ? String(args[k]) : "");
  switch (name) {
    case "order_set_status":
      return (
        `Set order ${s("token")} to "${s("status")}"\n` +
        `→ The customer is emailed the new status.`
      );
    case "order_delay": {
      const minutes = typeof args.minutes === "number" ? args.minutes : "?";
      return (
        `Delay order ${s("token")} by ${minutes} min\n` +
        `→ The customer is emailed the new ETA.`
      );
    }
    case "order_finalize":
      return (
        `Approve/finalize order ${s("token")}\n` +
        `→ Books the kitchen slot, emails the customer a confirmation, and upserts the customer record.`
      );
    case "menu_set_out_of_stock": {
      const out = args.outOfStock === true;
      const where = args.pantry ? "pantry item" : "menu item";
      const row = typeof args.rowIndex === "number" ? args.rowIndex : "?";
      return (
        `Mark ${where} (row ${row}) ${out ? "OUT OF STOCK (hidden)" : "available"}\n` +
        `→ The change goes LIVE on the public menu immediately.`
      );
    }
    case "requisition_decide": {
      const reject = args.decision === "reject";
      const row = typeof args.rowIndex === "number" ? args.rowIndex : "?";
      return (
        `${reject ? "Reject" : "Approve"} requisition (row ${row})\n` +
        `→ Updates the requisition's status in the stock books${reject ? "" : " and deducts approved OUT items from stock"}.`
      );
    }
    case "broadcast_group":
      // Preview the SANITIZED text — the owner's confirm card should show exactly
      // what will be sent (executeTool sanitizes again before sending).
      return (
        `Broadcast to the Sales group:\n` +
        `——— message ———\n` +
        `${sanitizeBroadcast(s("text"))}\n` +
        `————————————\n` +
        `→ This exact message is sent to the whole group.`
      );
    case "log_expense": {
      const amount = typeof args.amountEgp === "number" ? args.amountEgp : "?";
      const when = s("date") || "today";
      const category = s("category") || "other";
      return (
        `Log expense: ${amount} EGP · ${s("vendor")} · ${category} · ${when}` +
        `${s("note") ? ` — ${s("note")}` : ""}\n` +
        `→ Logs an expense to your books (private — not visible to customers).`
      );
    }
    default:
      return `Run ${name}.`;
  }
}

// --- Broadcast sanitization ---------------------------------------------------

/**
 * Strip control + bidi/directional-override characters before any text is
 * broadcast to the group. \t, \n and \r are preserved; everything else in the
 * C0/C1 control range and the Unicode bidi-control range is removed so a
 * crafted message cannot visually spoof the group feed (e.g. U+202E
 * RIGHT-TO-LEFT OVERRIDE).
 */
function sanitizeBroadcast(text: string): string {
  return text
    // C0/C1 control chars; \t \n \r are preserved.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
    // Unicode bidi/directional controls (incl. U+202E RIGHT-TO-LEFT OVERRIDE).
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069\u061C]/g, "")
    .trim();
}

// --- Executor -----------------------------------------------------------------

/**
 * Execute a tool by name. Reads run inline; mutations are only reached AFTER
 * the confirm gate (the loop never calls this for an unconfirmed mutation).
 * Every branch is wrapped so a client failure becomes a returned string — the
 * executor never throws into the agent loop.
 */
export async function executeTool(name: string, args: Record<string, unknown>, _ctx: ToolContext): Promise<string> {
  try {
    switch (name) {
      // ---- read ----
      case "orders_active": {
        const r = await slaListActiveOrders();
        if (!r.success || !r.orders) return "No active orders, or the orders source is unavailable.";
        if (r.orders.length === 0) return "No active orders right now.";
        return r.orders.map((o) => `• ${o.name} — ${o.status} — slot ${o.delivery_slot} — ${o.order_summary}`).join("\n");
      }
      case "order_lookup": {
        const r = await getOrderStatus(String(args.token ?? ""), true);
        if (!r.success || !r.order) return "Order not found.";
        const o = r.order;
        return `${o.name}: ${o.status}, slot ${o.deliverySlot} on ${o.deliveryDate}, ${o.orderTotal} EGP — ${o.orderSummary}`;
      }
      case "capacity_today": {
        // getAvailability ignores any slot param and returns { availability:
        // { slots: [{ time, status }] } }, so filter to one slot client-side.
        const r = await getAvailabilitySummary();
        const slots = r.availability?.slots;
        if (!r.success || !slots) return "Capacity info unavailable.";
        const wanted = args.slot ? String(args.slot).trim() : "";
        const shown = wanted ? slots.filter((s) => s.time === wanted) : slots;
        const lines = shown.map((s) => `${s.time}: ${s.status === "busy" ? "full/busy" : "open"}`);
        if (!lines.length) return wanted ? `No slot ${wanted} today.` : "No slots configured.";
        return (r.availability?.paused ? "Ordering is PAUSED.\n" : "") + lines.join("\n");
      }
      case "revenue_summary": {
        const period = args.period === "week" ? "week" : "today";
        // getCRMOrders is the real revenue source (order_total is numeric there);
        // getOrders reads the legacy People sheet and has no usable totals. The
        // server ignores range, so window the rows by Cairo date here.
        const crm = await getCrmOrdersList();
        // Never fabricate a zero: if the source failed, say so rather than report
        // "0 EGP" — a misleading answer to a money question.
        if (!crm.success || !crm.items) return "Revenue is temporarily unavailable.";
        const today = cairoDate();
        const start = period === "week" ? cairoDate(new Date(Date.now() - 6 * 86_400_000)) : today;
        const realized = (o: CrmOrder) => {
          const st = String(o.status || "").toLowerCase();
          if (st === "declined" || st === "cancelled") return false;
          const d = String(o.delivery_date || "") || (o.timestamp ? cairoDate(new Date(o.timestamp)) : "");
          return d !== "" && d >= start && d <= today;
        };
        const rows = crm.items.filter(realized);
        const total = rows.reduce((sum, o) => sum + (Number(o.order_total) || 0), 0);
        return `Revenue (${period}): ${total} EGP across ${rows.length} orders.`;
      }
      case "customer_lookup": {
        // getContacts ignores `q` and returns the whole Contacts tab under
        // `items`, so match client-side. Contacts carry no order count.
        const q = String(args.query ?? args.name ?? args.phone ?? "").trim().toLowerCase();
        const r = await getContactsList();
        if (!r.success || !r.items) return "Customer lookup is unavailable.";
        const matches = q
          ? r.items.filter((c) => `${c.name ?? ""} ${c.phone ?? ""} ${c.email ?? ""}`.toLowerCase().includes(q))
          : r.items;
        if (!matches.length) return "No matching customer.";
        return matches.slice(0, 20).map((c) => `${c.name}${c.phone ? ` — ${c.phone}` : ""}${c.email ? ` — ${c.email}` : ""}`).join("\n");
      }
      case "menu_list": {
        // Lead each line with the row number so the owner/model can pass it to
        // menu_set_out_of_stock (the toggle is keyed on rowIndex, not id).
        const r = await getMenuList();
        if (!r.success || !r.items) return "Menu unavailable.";
        return r.items.map((i) => {
          const hidden = String(i.status ?? "").toLowerCase() === "hidden";
          return `#${i._rowIndex} ${i.name}${i.status ? ` — ${i.status}` : ""}${hidden ? " (hidden)" : ""}`;
        }).join("\n") || "No menu items.";
      }
      case "stock_list": {
        const [stock, pantry] = await Promise.all([getStockList(), getPantryList()]);
        const lines = [
          ...(stock.items ?? []).map((s) => `${s.name}: ${s.qty_on_hand ?? "?"} ${s.unit ?? ""}`.trim()),
          ...(pantry.items ?? []).map((p) => `#${p._rowIndex} ${p.name}${String(p.status ?? "").toLowerCase() === "hidden" ? " (hidden)" : ""}`),
        ];
        return lines.join("\n") || "Stock unavailable.";
      }
      // ---- mutating (only reached post-confirm) ----
      case "order_set_status": {
        const r = await setOrderStatusByToken(String(args.token), args.status as OrderStatus);
        return r.success ? `Order set to ${r.status}.` : `Failed: ${r.error ?? "unknown"}`;
      }
      case "order_delay": {
        const minutes = Number(args.minutes);
        if (!Number.isFinite(minutes) || minutes <= 0) return "Delay must be a positive number of minutes.";
        const r = await delayOrder(String(args.token), minutes);
        return r.success ? `Delayed to ${r.newLabel}.` : `Failed: ${r.error ?? "unknown"}`;
      }
      case "order_finalize": {
        const r = await orderFinalize(String(args.token), args.payment ? String(args.payment) : undefined);
        return r.success ? "Order approved/finalized." : `Failed: ${r.error ?? "unknown"}`;
      }
      case "menu_set_out_of_stock": {
        const rowIndex = Number(args.rowIndex);
        if (!Number.isInteger(rowIndex) || rowIndex < 2) return "A valid menu row number (from menu_list) is required.";
        // The server writes this literal string into the sheet's status column;
        // 'hidden' / 'available' match what the admin UI uses.
        const status = args.outOfStock === true ? "hidden" : "available";
        const r = args.pantry ? await togglePantryVisibility(rowIndex, status) : await toggleMenuVisibility(rowIndex, status);
        return r.success ? `Item ${status === "hidden" ? "marked out of stock (hidden)" : "available"}.` : `Failed: ${r.error ?? "unknown"}`;
      }
      case "requisition_decide": {
        const rowIndex = Number(args.rowIndex);
        if (!Number.isInteger(rowIndex) || rowIndex < 2) return "A valid requisition row number is required.";
        const decision = args.decision === "reject" ? "reject" : "approve";
        const r = await decideRequisition(rowIndex, decision);
        if (!r.success) return `Failed: ${r.error ?? "unknown"}`;
        const verb = decision === "reject" ? "rejected" : "approved";
        return r.warning ? `Requisition ${verb} (${r.warning}).` : `Requisition ${verb}.`;
      }
      case "broadcast_group": {
        const group = process.env.TELEGRAM_OWNER_CHAT_ID;
        if (!group) return "Group chat id is not configured.";
        const text = sanitizeBroadcast(String(args.text ?? ""));
        if (!text) return "Nothing to broadcast.";
        const r = await sendMessage(group, text);
        return r.ok ? "Broadcast sent to the Sales group." : "Broadcast failed.";
      }
      case "log_expense": {
        const r = await logExpense({
          vendor: String(args.vendor ?? ""),
          amountEgp: Number(args.amountEgp),
          date: args.date ? String(args.date) : undefined,
          category: args.category ? String(args.category) : undefined,
          note: args.note ? String(args.note) : undefined,
        });
        return r.success ? `Expense logged (#${r.id}).` : `Failed: ${r.error ?? "unknown"}`;
      }
      default:
        return `Unknown tool: ${name}`;
    }
  } catch (err) {
    console.error(`[agent] tool ${name} failed:`, err);
    return `The ${name} tool hit an error. Please try again.`;
  }
}
