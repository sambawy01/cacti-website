# Cacti Website — Phased Build Plan

> **For Hermes:** Use subagent-driven-development to implement this plan task-by-task.

**Goal:** Complete the five remaining Cacti features (checkout, QR dine-in, events booking, admin dashboard, QR code generation) in five sequential phases.

**Architecture:** Vite + React SPA with Vercel serverless API routes. Supabase (project `mmjjphgzzhdifvkrokxz`) as the database with RLS. Frontend uses anon key (public read + insert); serverless APIs use service role key (admin all). Telegram bot for staff notifications. All APIs dual-write: Supabase first, then Telegram notification.

**Tech Stack:** React 18, React Router 7, Vite 6, Tailwind 4, Radix UI, Motion, Supabase JS v2, Vercel serverless functions (plain JS, no Next.js for the SPA APIs).

**Current state:**
- Supabase schema deployed (6 tables, RLS, triggers, helper functions)
- `src/lib/supabase.ts` client wired with types
- `api/order.js` — delivery orders → Supabase + Telegram (working, tested)
- `api/reservation.js` — reservations → Supabase + Telegram (working)
- `CartDrawer.tsx` — cart UI with checkout form, calls `placeOrderOnSite()` → `/api/order`
- `Menu.tsx` — menu page with cart add, reads from Supabase `menu_items`
- `Events.tsx` — display-only, no booking form
- `AdminPage.tsx` — has `OrdersTab` reading from legacy Apps Script CRM, not Supabase
- `Track.tsx` — retired stub
- `vercel.json` — rewrites `/api/*` to serverless, everything else to `index.html`
- No `/order` route exists yet (QR dine-in)
- No `api/event-booking.js` exists yet
- `tables` table is empty — no rows seeded, no QR codes generated

**Key constraints from Hany:**
- Two separate order flows: delivery checkout and dine-in QR ordering. Do NOT confuse or merge them.
- No order flow goes live without Hany's explicit approval.
- Min delivery order: EGP 2,000. VAT 14%. Service 12%.
- Events: NO prices shown to customer. Staff reviews and sends Paymob link privately.
- Review and test before every commit. No commit without passed build + tests + code review.

---

## Phase 1: Delivery Checkout System

**Objective:** Enforce min order, show proper totals breakdown, add payment method selection, validate all fields, and polish the checkout UX. The API (`api/order.js`) already works — this phase is mostly frontend.

### Task 1.1: Enforce minimum order amount in CartDrawer

**Files:**
- Modify: `src/app/components/CartDrawer.tsx`

**Steps:**
1. Add a `MIN_DELIVERY` constant = 2000 (read from `settings` table via supabase client if available, fallback 2000).
2. In the checkout section, show a progress bar / message when `totalPrice < MIN_DELIVERY`: "Add EGP {MIN_DELIVERY - totalPrice} more to checkout (min order EGP 2,000)".
3. Disable the checkout button when `totalPrice < MIN_DELIVERY`.
4. Show the totals breakdown in the cart before checkout: subtotal, VAT (14%), service (12%), total — same calculation as `api/order.js`.

**Verification:**
- `npm run build` passes.
- Cart with EGP 500 worth of items shows the min-order message and disabled button.
- Cart with EGP 2,100 shows the full breakdown and enabled button.

### Task 1.2: Polish payment method selector

**Files:**
- Modify: `src/app/components/CartDrawer.tsx`

**Steps:**
1. Replace the current `paymentMethod` state with proper radio buttons styled as cards: Cash on Delivery, Card on Delivery, InstaPay.
2. Each option shows an icon (💵 / 💳 / 🏦) and short description.
3. InstaPay selection shows a note: "We'll email you our bank details after you place your order."
4. Pass `paymentMethod` through `placeOrderOnSite()` — already wired in the API.

**Verification:**
- Build passes.
- Three payment options render as selectable cards.
- Selected option highlighted with Cacti teal border.

### Task 1.3: Add order tracking page (replace stub)

**Files:**
- Modify: `src/app/pages/Track.tsx` — rewrite from stub
- Modify: `src/services/orderService.ts` — wire `getOrderStatus()` to Supabase
- Modify: `src/app/App.tsx` — add `/track` route (currently missing)

**Steps:**
1. In `orderService.ts`, implement `getOrderStatus(token)`:
   ```ts
   export async function getOrderStatus(token: string): Promise<TrackedOrder | null> {
     const { data, error } = await supabase
       .from('orders')
       .select('customer_name, status, delivery_date, delivery_slot, items, total')
       .eq('tracking_token', token)
       .single();
     if (error || !data) return null;
     return {
       name: data.customer_name,
       status: data.status,
       deliveryDate: data.delivery_date,
       deliverySlot: data.delivery_slot,
       orderSummary: (data.items || []).map((it: any) => `${it.quantity}x ${it.name}`).join(', '),
       orderTotal: data.total,
     };
   }
   ```
2. Rewrite `Track.tsx` as a full page:
   - Reads `?token=...` from URL.
   - Calls `getOrderStatus(token)`.
   - Shows order status timeline: Pending → Confirmed → Preparing → Out for Delivery → Delivered (or Declined).
   - Shows order summary and total.
   - "Back to menu" button.
3. Add route in `App.tsx`: `<Route path="/track" element={<TrackPage />} />` inside the Layout route.

**Verification:**
- Build passes.
- Visit `/track?token=<test-token>` (use a token from a test order) — shows order details.
- Visit `/track?token=invalid` — shows "Order not found" message.

### Task 1.4: Commit Phase 1

```bash
git add -A
git commit -m "feat: delivery checkout — min order enforcement, payment selector, order tracking"
```

**Verification:** `npm run build` passes before commit.

---

## Phase 2: QR Dine-In Ordering (`/order?table=N`)

**Objective:** A separate ordering flow where a guest scans a QR code at their table, sees the menu, adds items, and places a dine-in order. No delivery fields, no address, no minimum order. Order goes to Supabase with `mode='dine_in'` and `table_id` set. Kitchen/bar gets a Telegram notification with the table label.

### Task 2.1: Create dine-in API endpoint

**Files:**
- Create: `api/order-dinein.js`

**Steps:**
1. Create `api/order-dinein.js` — similar structure to `api/order.js` but:
   - Accepts: `tableId`, `items`, `name` (optional — default "Table N guest"), `phone` (optional), `note`, `paymentMethod` (defaults to `cash_on_site`).
   - Looks up the table by `tableId` from Supabase `tables` table to get the `label` and `zone`.
   - Inserts order with `mode: 'dine_in'`, `status: 'pending_approval'`, `table_id: tableId`, `payment_method: 'cash_on_site'`.
   - Calculates totals same as delivery (subtotal + 14% VAT + 12% service).
   - Sends Telegram notification: "🍽️ DINE-IN ORDER — Table {label}" with items and total.
   - Returns `{ ok, orderId, trackingToken, tableLabel, total }`.
2. No minimum order check.

**Verification:**
- `curl -X POST https://cacti-website-mauve.vercel.app/api/order-dinein -H 'Content-Type: application/json' -d '{"tableId":"<uuid>","items":[{"name":"Test","price":100,"quantity":1}]}'` returns `ok: true` with `dbId`.

### Task 2.2: Create dine-in order service (frontend)

**Files:**
- Modify: `src/services/orderService.ts` — add `placeDineInOrder()`

**Steps:**
1. Add interface `DineInOrderInput`:
   ```ts
   export interface DineInOrderInput {
     tableId: string;
     items: { name: string; quantity: number; price: number }[];
     note?: string;
     guestName?: string;
     guestPhone?: string;
   }
   ```
2. Add `placeDineInOrder(input: DineInOrderInput): Promise<OnSiteOrderResult>`:
   - POSTs to `/api/order-dinein`.
   - Returns same `OnSiteOrderResult` shape (reuse type).

### Task 2.3: Create dine-in ordering page

**Files:**
- Create: `src/app/pages/DineInOrder.tsx`
- Modify: `src/app/App.tsx` — add `/order` route

**Steps:**
1. Create `DineInOrder.tsx`:
   - Reads `?table=N` from URL (N is the table UUID or label).
   - Fetches table info from Supabase `tables` table (public read, RLS allows it).
   - Shows header: "Table {label} — Cacti" with the zone icon (🍽️ dining / 🍸 bar / 🏖️ daybed).
   - Shows the menu (reuse `useMenuData()` from existing `Menu.tsx`).
   - Same cart pattern: add items, cart drawer or inline cart.
   - Checkout form: note field + optional name/phone. NO address, NO delivery slot, NO email required.
   - Calls `placeDineInOrder()`.
   - Success screen: "Order sent to the kitchen!" with table label and order ref. "Place another order" button.
2. Style to match the site's Cacti theme (dark teal, Montserrat font).
3. Add route in `App.tsx`: `<Route path="/order" element={<DineInOrderPage />} />` — outside Layout route (full-screen, no nav bar, like admin).

**Verification:**
- Build passes.
- Visit `/order?table=<test-uuid>` — shows table label, menu, cart.
- Place order → success screen with order ref.
- Check Supabase `orders` table → row with `mode='dine_in'`, `table_id` set.

### Task 2.4: Commit Phase 2

```bash
git add -A
git commit -m "feat: QR dine-in ordering — /order?table=N with separate API and flow"
```

---

## Phase 3: Events Booking Form

**Objective:** Add a booking/enquiry form to the Events page. Customer fills in details (no prices), form saves to `event_bookings` table, staff gets Telegram notification. Staff reviews and sends Paymob link privately.

### Task 3.1: Create event booking API

**Files:**
- Create: `api/event-booking.js`

**Steps:**
1. Create `api/event-booking.js`:
   - Accepts POST: `name`, `phone`, `email`, `eventType` (e.g. "sunset_session", "private_dining", "full_venue"), `eventDate`, `partySize`, `notes`.
   - Validates: name, phone, email required.
   - Inserts into Supabase `event_bookings` table with `status: 'pending'`.
   - Sends Telegram notification: "🎉 EVENT ENQUIRY — {eventType}" with customer details.
   - Returns `{ ok: true, bookingId }`.
2. No prices shown or stored at this stage.

**Verification:**
- `curl -X POST .../api/event-booking -d '{"name":"Test","phone":"01000000000","email":"test@test.com","eventType":"private_dining","eventDate":"2026-07-15","partySize":20}'` returns `ok: true`.
- Row appears in `event_bookings` table.

### Task 3.2: Add booking form to Events page

**Files:**
- Modify: `src/app/pages/Events.tsx`

**Steps:**
1. Add a "Book an Event" section at the bottom of the Events page (before the CTA):
   - Form fields: Name, Phone, Email, Event Type (dropdown: Sunset Session, Live Music Night, Private Dining, Full Venue Hire, Other), Date (date picker), Party Size (number), Notes (textarea).
   - NO price field, NO payment field.
   - Submit button: "Send Enquiry".
   - On submit: POST to `/api/event-booking`.
   - Success state: "Thanks! We'll review your request and send you a quote within 24 hours."
2. Style with Cacti theme. Use existing Radix UI components (Input, Textarea, Select, Button).

**Verification:**
- Build passes.
- Fill out the form on the events page → success message.
- Check Supabase `event_bookings` → row appears.
- Telegram notification received.

### Task 3.3: Commit Phase 3

```bash
git add -A
git commit -m "feat: events booking form — enquiry saves to Supabase + notifies staff"
```

---

## Phase 4: Admin Dashboard (Supabase-backed)

**Objective:** Replace the legacy Apps Script CRM data source with Supabase queries. Admin can view and manage orders, reservations, and event bookings. Status updates write to Supabase. The admin page already has tabs and auth — we're swapping the data layer.

### Task 4.1: Create admin API for Supabase reads

**Files:**
- Create: `api/admin.js`

**Steps:**
1. Create `api/admin.js` — single endpoint that handles admin operations:
   - `GET /api/admin?action=orders` — list all orders (newest first).
   - `GET /api/admin?action=reservations` — list all reservations.
   - `GET /api/admin?action=events` — list all event bookings.
   - `PATCH /api/admin?action=update_order` — update order status (body: `id`, `status`).
   - `PATCH /api/admin?action=update_reservation` — update reservation status.
   - `PATCH /api/admin?action=update_event` — update event booking status.
   - Uses service role key (bypasses RLS).
   - Simple bearer token auth: check `Authorization: Bearer <ADMIN_PASSWORD>` against `process.env.ADMIN_PASSWORD` (same password the admin login uses).
2. Returns JSON arrays.

**Verification:**
- `curl -H "Authorization: Bearer <password>" https://...vercel.app/api/admin?action=orders` returns order list.
- `curl -X PATCH -H "Authorization: Bearer <password>" -H "Content-Type: application/json" -d '{"id":"<uuid>","status":"confirmed"}' .../api/admin?action=update_order` updates the row.

### Task 4.2: Rewrite OrdersTab to use Supabase

**Files:**
- Modify: `src/app/pages/admin/OrdersTab.tsx`
- Modify: `src/services/adminService.ts` — add Supabase fetch/update functions

**Steps:**
1. In `adminService.ts`, add:
   ```ts
   export async function fetchOrdersFromSupabase(token: string): Promise<SupabaseOrder[]>
   export async function updateOrderStatusInSupabase(token: string, orderId: string, status: string): Promise<void>
   ```
   These call `/api/admin` with the bearer token.
2. Rewrite `OrdersTab.tsx`:
   - Call `fetchOrdersFromSupabase()` instead of `getCRMOrders()`.
   - Map Supabase order fields to the existing table columns.
   - Status update buttons call `updateOrderStatusInSupabase()`.
   - Add a "Dine-In" badge for orders with `mode='dine_in'` and show table label.
   - Auto-refresh every 30 seconds (optional, or manual refresh button).

**Verification:**
- Build passes.
- Admin dashboard → Orders tab shows orders from Supabase (including the test orders from earlier).
- Clicking "Approve" on a pending order updates its status in Supabase.

### Task 4.3: Add Reservations tab to admin

**Files:**
- Create: `src/app/pages/admin/ReservationsTab.tsx`
- Modify: `src/app/pages/admin/AdminPage.tsx` — add Reservations tab to the Orders section

**Steps:**
1. Create `ReservationsTab.tsx`:
   - Fetches reservations from `/api/admin?action=reservations`.
   - Table: Date, Time, Type (Beach/Restaurant), Name, Phone, Party Size/Sunbeds, Status.
   - Actions: Confirm, Decline.
2. Add to AdminPage under the "orders" section as a new tab, or rename the section to "Operations" with sub-tabs: Orders, Reservations, Events.

**Verification:**
- Build passes.
- Admin dashboard shows reservations from Supabase.
- Confirm/Decline buttons work.

### Task 4.4: Add Event Bookings tab to admin

**Files:**
- Create: `src/app/pages/admin/EventsTab.tsx`
- Modify: `src/app/pages/admin/AdminPage.tsx` — add Events tab

**Steps:**
1. Create `EventsTab.tsx`:
   - Fetches event bookings from `/api/admin?action=events`.
   - Table: Date, Event Type, Name, Phone, Party Size, Status, Notes.
   - Actions: Approve, Decline, Mark Completed.
   - Internal-only fields: `quoted_price` and `paymob_link` columns (editable inline) — visible to admin only, never shown to customer.
2. Add to AdminPage as a tab in the operations section.

**Verification:**
- Build passes.
- Admin dashboard shows event bookings.
- Admin can set quoted price and Paymob link on a booking.

### Task 4.5: Commit Phase 4

```bash
git add -A
git commit -m "feat: admin dashboard reads from Supabase — orders, reservations, events"
```

---

## Phase 5: QR Code Generation

**Objective:** Populate the `tables` table with 51 tables (30 dining, 15 bar, 6 daybeds) and generate QR codes for each, linking to `https://cacti.restaurant/order?table=<uuid>`. Output a printable PDF or individual PNG files.

### Task 5.1: Seed the tables table

**Files:**
- Create: `scripts/seed-tables.js`

**Steps:**
1. Create a Node script that:
   - Connects to Supabase using the service role key (from `.env`).
   - Inserts 30 dining tables: labels D1–D30, zone='dining', capacity=4.
   - Inserts 15 bar tables: labels B1–B15, zone='bar', capacity=2.
   - Inserts 6 daybeds: labels Daybed-1–Daybed-6, zone='daybed', capacity=2.
   - Each row gets a UUID `id` — save the mapping (label → id) to a JSON file for QR generation.
2. Run it once locally: `node scripts/seed-tables.js`.
3. Save output to `scripts/table-ids.json`.

**Verification:**
- `node scripts/seed-tables.js` runs successfully.
- Supabase `tables` table has 51 rows.
- `scripts/table-ids.json` exists with label→UUID mapping.

### Task 5.2: Generate QR codes

**Files:**
- Create: `scripts/generate-qr.js`
- Output: `public/qr-codes/` directory with 51 PNG files + one combined PDF

**Steps:**
1. Install `qrcode` npm package (dev dependency).
2. Create `scripts/generate-qr.js`:
   - Reads `scripts/table-ids.json`.
   - For each table, generates a QR PNG encoding `https://cacti.restaurant/order?table=<uuid>`.
   - Saves to `public/qr-codes/<label>.png` (e.g. `D1.png`, `B1.png`, `Daybed-1.png`).
   - Also generates a combined A4 PDF with all 51 QR codes labeled and laid out 6-per-page for easy printing.
3. Run: `node scripts/generate-qr.js`.

**Verification:**
- `public/qr-codes/` contains 51 PNG files.
- Each QR code scans to `https://cacti.restaurant/order?table=<uuid>`.
- PDF file exists at `public/qr-codes/all-tables.pdf`.
- Scan a code with a phone → opens the dine-in ordering page with the correct table label.

### Task 5.3: Commit Phase 5

```bash
git add -A
git commit -m "feat: seed 51 tables + generate QR codes for dine-in ordering"
```

---

## Summary

| Phase | Feature | New Files | Modified Files | Est. Tasks |
|-------|---------|-----------|----------------|------------|
| 1 | Delivery Checkout | — | `CartDrawer.tsx`, `Track.tsx`, `orderService.ts`, `App.tsx` | 4 |
| 2 | QR Dine-In Ordering | `api/order-dinein.js`, `DineInOrder.tsx` | `orderService.ts`, `App.tsx` | 4 |
| 3 | Events Booking | `api/event-booking.js` | `Events.tsx` | 3 |
| 4 | Admin Dashboard | `api/admin.js`, `ReservationsTab.tsx`, `EventsTab.tsx` | `OrdersTab.tsx`, `adminService.ts`, `AdminPage.tsx` | 5 |
| 5 | QR Code Generation | `scripts/seed-tables.js`, `scripts/generate-qr.js` | — | 3 |

**Total:** 19 tasks across 5 phases. Each phase ends with a commit. Each task is 2–10 minutes of focused work.

**Dependencies:** Phases are sequential but independent in scope — Phase 2 doesn't require Phase 1, etc. However, Phase 5 (QR codes) should come after Phase 2 (dine-in page) so the QR links actually go somewhere.

**Recommended execution order:** 1 → 2 → 5 → 3 → 4 (or 1 → 2 → 3 → 4 → 5 as listed).