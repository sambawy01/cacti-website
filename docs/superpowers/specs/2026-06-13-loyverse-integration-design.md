# Loyverse Integration — Design Spec (Phase 2)

**Date:** 2026-06-13
**Status:** Draft for approval — touches the live Loyverse POS catalog, so the catalog-sync part needs explicit sign-off.

## Background

bistro-cloud.com orders are now confirmed on-site (Phase 1) and land in Google Sheets + Telegram + email. The owner wants confirmed orders pushed into **Loyverse** (their POS, merchant "Bistro Cloud", EGP) so sales and inventory live in one place. They use Loyverse but have **no KDS app yet** (KDS is a future Loyverse subscription; until then this integration is about getting sales/inventory into the POS, not driving a kitchen screen).

**Key finding:** the website menu (140 daily-style dishes, from menu sheet `1kCS…`) and the existing Loyverse catalog (172 different items) barely overlap — only **13 names match**. The owner chose to **sync the catalog**: create the website menu items in Loyverse, then map orders to them. This modifies the live POS catalog.

## Loyverse account facts (from API research)

- Merchant: Bistro Cloud, currency EGP. One store: `39af263c-0119-49b8-9dc0-4fe99d35acba`.
- Payment types map 1:1 to the website: Cash `1252b529-…`, Card `77c7ac0a-…` (NONINTEGRATEDCARD), Instapay `a2b2d5bb-…`.
- POS devices: "Bistro Cloud" `d565e82e-…`, plus POS 1/2/3, Admin.
- Existing categories include Main Course, Sandwiches, Side orders, Drinks, etc. No "Salads" or "Ramadan" category yet.
- Receipts API (`POST /v1.0/receipts`) creates **completed sales** with line items (catalog variant or custom), a payment, store, and POS device.

## Menu sheet structure (source of truth)

Fields per item: `id, name, description, price, category, image, dietary, status` (status = `visible`/`hidden`). 140 items, all priced. Categories are inconsistent and need normalization:
`Mains` (53) + `main course` (15) → **Main Course**; `Salads` (14) + `salad` (13) → **Salads**; `sandwich` (13) + `Sandwiches` (2) → **Sandwiches**; `Ramadan` (30) → **Ramadan**.

## Goals

1. **Catalog sync:** every orderable website item exists in Loyverse with the right name, price, and category — so order pushes map to real items and inventory/sales attribute correctly. Idempotent (re-runnable without duplicates).
2. **Order push:** every confirmed order becomes a Loyverse receipt with mapped line items, the correct payment type, and useful order context (customer, address, delivery time) — fired on instant-confirm and on Telegram approval.
3. **Never block an order on Loyverse:** a Loyverse failure logs/alerts but the order still stands (it's already in Sheets + Telegram + email).

## Part 1 — Catalog sync (menu sheet → Loyverse)

**Runs as a reviewed local Node script** (`scripts/loyverse-sync.mjs`), executed deliberately with `--dry-run` first, then for real. Not an automatic/continuous process (avoids surprise catalog churn as the menu rotates). Re-runnable.

Logic:
1. Read the menu sheet (via the Apps Script `getMenu` action) → 140 items.
2. Fetch all Loyverse items → build a name→item map.
3. Normalize each website item's category to one of: Main Course, Salads, Sandwiches, Ramadan. Ensure those categories exist in Loyverse (create the missing ones — Salads, Ramadan).
4. For each website item:
   - **No match in Loyverse:** create the item (`POST /v1.0/items`) with name, price (in the store), category, and a single default variant. (~127 creates.)
   - **Match exists:** leave it, OR update its price to the sheet value (decision below).
5. Output a report: created, updated, skipped, and any ambiguous matches for manual review.
6. Persist the resulting **name → variant_id map** (e.g. to `scripts/loyverse-item-map.json`, committed) for the order push to use, and re-fetched live as the source of truth.

**Decisions (approved by owner 2026-06-13):**
- **A. Sync scope:** **all 140 items** (including hidden).
- **B. Existing 13 matches:** **update their price** to the sheet value (sheet is the single source of truth).
- **C. Categories:** **create the missing categories** (Salads, Ramadan) and file items under Main Course / Salads / Sandwiches / Ramadan.

## Part 2 — Order push (confirmed order → Loyverse receipt)

Lives in the Vercel backend: `vercel-app/src/lib/loyverse.ts` (a `pushReceipt(order)` function), called from two places:
- `/api/order` when `placeOrder` returns `status: 'confirmed'` (instant-confirm path).
- `/api/telegram/webhook` after an **Approve** advances a `pending_approval` order to `confirmed`.

`pushReceipt` builds and posts a Loyverse receipt:
- `store_id` = the Bistro Cloud store; `pos_device_id` = the "Bistro Cloud" device.
- `line_items`: for each order item, look up its `variant_id` from the synced map (refreshed from Loyverse); use `variant_id` + `quantity` + `price`. If an item isn't found in the map (e.g. a brand-new dish not yet synced), fall back to a **custom line item** (name + price) so the sale still records — and log it so the owner knows to re-sync.
- `payments`: one payment with the mapped `payment_type_id` (cod→Cash, card_on_delivery→Card, instapay→Instapay) for the order total.
- `note`: customer name, phone, address, delivery slot, and the tracking token (so the POS receipt has delivery context).
- Idempotency: pass a deterministic `receipt` external reference / store the Loyverse receipt number back on the order (sheet `notes` or a future column) so a retried push doesn't double-create. (Loyverse receipts accept a client-supplied `source`/dedupe; confirm exact field during build.)

Env: `LOYVERSE_TOKEN`, `LOYVERSE_STORE_ID`, `LOYVERSE_POS_DEVICE_ID`, and the payment-type IDs (or fetched once and cached). Added to Vercel.

Error handling: wrap the push in try/catch; on failure, log + send a Telegram note to the owner ("⚠️ Order X didn't sync to Loyverse"). Never fail the order.

## Non-goals (this phase)

- Driving a kitchen display (no KDS yet; the existing kitchen Google Calendar remains the interim display). When KDS is added, we'll verify whether API receipts surface as KDS tickets and adjust.
- Two-way sync (Loyverse → website). One-way only: website → Loyverse.
- Real-time continuous catalog sync. The sync is a deliberate, re-runnable script.

## Testing

- Catalog sync: `--dry-run` prints planned creates/updates without calling Loyverse writes; review; then run for real and verify a few items appear in Loyverse with correct price/category.
- Order push: place a test order → confirm a receipt appears in Loyverse with the right items, total, and payment type; verify the custom-line-item fallback; verify a Loyverse outage doesn't fail the order. Clean up test receipts.
- Start small: create 2–3 items + push 1 receipt to validate the API shapes before the bulk 127-item sync.
