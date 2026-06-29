-- ============================================================================
-- CACTI — Mazi Feature Migration
-- Adds: phone verification, Paymob payment tracking, Foodics sync
-- ============================================================================

-- ── verified_phones ───────────────────────────────────────────────────────
-- Tracks phones that passed OTP verification (30-minute TTL)
create table if not exists verified_phones (
  phone        text primary key,
  verified_at  timestamptz not null default now()
);

-- Auto-expire: delete rows older than 30 minutes
create or replace function cleanup_verified_phones()
returns void as $$
  delete from verified_phones where verified_at < now() - interval '30 minutes';
$$ language sql;

-- RLS: public can check own phone, admin can do all
alter table verified_phones enable row level security;

drop policy if exists "verified_phones_public_read" on verified_phones;
create policy "verified_phones_public_read" on verified_phones
  for select using (true);  -- need to check by phone value

drop policy if exists "verified_phones_public_insert" on verified_phones;
create policy "verified_phones_public_insert" on verified_phones
  for insert with check (true);

drop policy if exists "verified_phones_admin_all" on verified_phones;
create policy "verified_phones_admin_all" on verified_phones
  for all using (auth.role() = 'service_role');

-- ── payment_intents ───────────────────────────────────────────────────────
-- Tracks Paymob payment intents so the webhook can settle the right order
create table if not exists payment_intents (
  paymob_order_id   text primary key,
  order_id          text not null,           -- Cacti order_ref
  order_db_id       uuid,                    -- Supabase orders.id
  amount            integer not null,        -- EGP (whole pounds)
  method            text not null,           -- 'card' | 'instapay' | 'apple_pay'
  settled           boolean default false,
  created_at        timestamptz default now(),
  settled_at        timestamptz
);

alter table payment_intents enable row level security;

drop policy if exists "payment_intents_admin_all" on payment_intents;
create policy "payment_intents_admin_all" on payment_intents
  for all using (auth.role() = 'service_role');

-- Allow webhook (service_role) to insert/update
drop policy if exists "payment_intents_service_insert" on payment_intents;
create policy "payment_intents_service_insert" on payment_intents
  for insert with check (true);

-- ── Extend orders table ───────────────────────────────────────────────────
-- Add Paymob payment tracking columns
alter table orders add column if not exists paymob_order_id text;
alter table orders add column if not exists paymob_paid boolean default false;
alter table orders add column if not exists paymob_ref text;
alter table orders add column if not exists paid_at timestamptz;

-- Add Foodics sync tracking
alter table orders add column if not exists foodics_order_id text;
alter table orders add column if not exists foodics_synced_at timestamptz;
alter table orders add column if not exists foodics_sync_status text default 'pending';
-- 'pending' | 'synced' | 'failed' | 'not_configured'

-- Add status timeline for real-time tracking
alter table orders add column if not exists status_timeline jsonb default '[]'::jsonb;

-- ── Enable Realtime on orders table ───────────────────────────────────────
-- This allows the frontend to subscribe to order status changes
alter publication supabase_realtime add table orders;

-- ── Indexes ───────────────────────────────────────────────────────────────
create index if not exists idx_payment_intents_order on payment_intents(order_id);
create index if not exists idx_payment_intents_settled on payment_intents(settled);
create index if not exists idx_orders_paymob on orders(paymob_order_id);
create index if not exists idx_orders_foodics on orders(foodics_order_id);

-- ============================================================================
-- DONE
-- ============================================================================