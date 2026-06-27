-- ============================================================================
-- CACTI — Supabase Database Schema
-- Project: mmjjphgzzhdifvkrokxz
-- Run: psql "postgresql://postgres:[PASSWORD]@db.mmjjphgzzhdifvkrokxz.supabase.co:5432/postgres" -f schema.sql
-- ============================================================================

-- Extensions
create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";

-- ============================================================================
-- ENUMS
-- ============================================================================
do $$ begin
  create type order_mode as enum ('delivery', 'dine_in');
exception when duplicate_object then null; end $$;

do $$ begin
  create type order_status as enum (
    'pending_approval',
    'confirmed',
    'preparing',
    'out_for_delivery',
    'delivered',
    'served',           -- dine-in equivalent of delivered
    'declined',
    'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type reservation_type as enum ('beach', 'restaurant');
exception when duplicate_object then null; end $$;

do $$ begin
  create type reservation_status as enum (
    'pending',
    'confirmed',
    'declined',
    'cancelled',
    'completed',
    'no_show'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_method as enum ('cod', 'card_on_delivery', 'instapay', 'paymob', 'cash_on_site');
exception when duplicate_object then null; end $$;

do $$ begin
  create type table_zone as enum ('dining', 'bar', 'daybed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type menu_section as enum (
    'catch_of_the_day',
    'raw_bar',
    'cold_mezze',
    'hot_mezze',
    'seafood_mains',
    'pasta_risotto',
    'land_mains',
    'desserts',
    'beach_bar',
    'bar'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type event_status as enum ('pending', 'approved', 'declined', 'completed');
exception when duplicate_object then null; end $$;

-- ============================================================================
-- TABLES
-- ============================================================================

-- ── Menu Items ────────────────────────────────────────────────────────────
create table if not exists menu_items (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text default '',
  price       integer not null,           -- EGP, whole pounds
  section     menu_section not null,
  dietary     text[] default '{}',         -- e.g. ['Vegetarian','Gluten-Free']
  image_url   text default '',
  is_active   boolean default true,
  sort_order  integer default 0,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ── Tables / Floor Plan ───────────────────────────────────────────────────
create table if not exists tables (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,              -- "D1", "B3", "Daybed-1"
  zone        table_zone not null,
  capacity    integer not null default 2,
  qr_code     text,                       -- QR payload or image URL
  is_active   boolean default true,
  created_at  timestamptz default now()
);

-- ── Orders (delivery + dine-in) ───────────────────────────────────────────
create table if not exists orders (
  id              uuid primary key default gen_random_uuid(),
  order_ref       text unique not null,   -- "O..." human-readable ref
  mode            order_mode not null default 'delivery',
  status          order_status not null default 'pending_approval',

  -- customer
  customer_name   text not null,
  customer_phone text not null,
  customer_email  text not null,

  -- delivery-only
  delivery_address text,
  delivery_location text,                  -- maps link / lat,lng
  delivery_date    date,
  delivery_slot    text,                   -- "14:30"
  note             text,

  -- dine-in only
  table_id        uuid references tables(id),

  -- items as JSONB snapshot (denormalized for order history)
  items           jsonb not null default '[]',
  -- [{"name":"Grilled Calamari","price":240,"quantity":2,"section":"hot_mezze"}]

  -- totals (in piasters to avoid float issues? no — EGP whole pounds is fine)
  subtotal        integer not null default 0,
  vat_amount      integer not null default 0,    -- 14% of subtotal
  service_amount  integer not null default 0,    -- 12% of subtotal
  total           integer not null default 0,    -- subtotal + vat + service

  payment_method  payment_method,
  tracking_token  text unique not null,   -- for /track?token=...

  -- timestamps
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  confirmed_at    timestamptz,
  delivered_at    timestamptz,
  served_at       timestamptz
);

create index if not exists idx_orders_status on orders(status);
create index if not exists idx_orders_mode on orders(mode);
create index if not exists idx_orders_token on orders(tracking_token);
create index if not exists idx_orders_phone on orders(customer_phone);
create index if not exists idx_orders_date on orders(created_at desc);

-- ── Reservations (beach + restaurant) ─────────────────────────────────────
create table if not exists reservations (
  id            uuid primary key default gen_random_uuid(),
  type          reservation_type not null,
  status        reservation_status not null default 'pending',

  customer_name  text not null,
  customer_phone text not null,
  customer_email text not null,

  res_date      date not null,
  res_time      text not null,             -- "1:00 PM"
  party_size    integer default 0,         -- restaurant
  sunbeds       integer default 0,         -- beach
  notes         text default '',

  -- payment
  paymob_link   text,                     -- sent after approval
  paymob_paid    boolean default false,
  paymob_ref    text,                      -- Paymob transaction ref

  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  confirmed_at   timestamptz,
  declined_at    timestamptz,
  cancelled_at  timestamptz
);

create index if not exists idx_reservations_status on reservations(status);
create index if not exists idx_reservations_date on reservations(res_date);
create index if not exists idx_reservations_email on reservations(customer_email);

-- ── Event Bookings ────────────────────────────────────────────────────────
create table if not exists event_bookings (
  id            uuid primary key default gen_random_uuid(),
  status        event_status not null default 'pending',

  customer_name  text not null,
  customer_phone text not null,
  customer_email text not null,

  event_type    text,                      -- "sunset_session", "private_dining", "full_venue"
  event_date    date,
  party_size    integer,
  budget_note   text,                       -- staff enters privately
  notes         text,

  -- internal pricing (NOT shown to customer)
  quoted_price  integer,                   -- EGP, staff fills after review
  paymob_link   text,
  paymob_paid   boolean default false,

  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index if not exists idx_events_status on event_bookings(status);
create index if not exists idx_events_date on event_bookings(event_date);

-- ── Settings (key-value) ──────────────────────────────────────────────────
create table if not exists settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz default now()
);

-- Seed defaults (values must be valid JSON)
insert into settings (key, value) values
  ('vat_rate', '0.14'),
  ('service_rate', '0.12'),
  ('min_delivery_order', '2000'),
  ('delivery_radius_km', '10'),
  ('delivery_area', '"Marsa Baghush + 10km"'),
  ('currency', '"EGP"'),
  ('language', '"en"'),
  ('ordering_paused', 'false'),
  ('reservations_paused', 'false')
on conflict (key) do nothing;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
alter table menu_items enable row level security;
alter table tables enable row level security;
alter table orders enable row level security;
alter table reservations enable row level security;
alter table event_bookings enable row level security;
alter table settings enable row level security;

-- ── menu_items: public read, admin write (via service_role) ───────────────
drop policy if exists "menu_items_public_read" on menu_items;
create policy "menu_items_public_read" on menu_items
  for select using (is_active = true);

drop policy if exists "menu_items_admin_all" on menu_items;
create policy "menu_items_admin_all" on menu_items
  for all using (auth.role() = 'service_role');

-- ── tables: public read (so QR scan can find table info), admin write ─────
drop policy if exists "tables_public_read" on tables;
create policy "tables_public_read" on tables
  for select using (is_active = true);

drop policy if exists "tables_admin_all" on tables;
create policy "tables_admin_all" on tables
  for all using (auth.role() = 'service_role');

-- ── orders: public can insert + read own (by tracking_token), admin all ──
-- The frontend has no auth, so we allow anon insert + limited select by token.
drop policy if exists "orders_public_insert" on orders;
create policy "orders_public_insert" on orders
  for insert with check (true);

drop policy if exists "orders_public_read_own" on orders;
create policy "orders_public_read_own" on orders
  for select using (tracking_token = current_setting('app.tracking_token', true));

drop policy if exists "orders_admin_all" on orders;
create policy "orders_admin_all" on orders
  for all using (auth.role() = 'service_role');

-- ── reservations: public insert, admin all ────────────────────────────────
drop policy if exists "reservations_public_insert" on reservations;
create policy "reservations_public_insert" on reservations
  for insert with check (true);

drop policy if exists "reservations_admin_all" on reservations;
create policy "reservations_admin_all" on reservations
  for all using (auth.role() = 'service_role');

-- ── event_bookings: public insert, admin all ──────────────────────────────
drop policy if exists "events_public_insert" on event_bookings;
create policy "events_public_insert" on event_bookings
  for insert with check (true);

drop policy if exists "events_admin_all" on event_bookings;
create policy "events_admin_all" on event_bookings
  for all using (auth.role() = 'service_role');

-- ── settings: public read non-sensitive, admin all ────────────────────────
drop policy if exists "settings_public_read" on settings;
create policy "settings_public_read" on settings
  for select using (
    key in ('vat_rate','service_rate','min_delivery_order','delivery_area',
            'currency','language','ordering_paused','reservations_paused',
            'delivery_radius_km')
  );

drop policy if exists "settings_admin_all" on settings;
create policy "settings_admin_all" on settings
  for all using (auth.role() = 'service_role');

-- ============================================================================
-- TRIGGERS: auto-update updated_at
-- ============================================================================
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$ begin
  create trigger trg_menu_items_updated
    before update on menu_items
    for each row execute function update_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger trg_orders_updated
    before update on orders
    for each row execute function update_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger trg_reservations_updated
    before update on reservations
    for each row execute function update_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger trg_events_updated
    before update on event_bookings
    for each row execute function update_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger trg_settings_updated
    before update on settings
    for each row execute function update_updated_at();
exception when duplicate_object then null; end $$;

-- ============================================================================
-- HELPER: generate order_ref
-- ============================================================================
create or replace function generate_order_ref()
returns text as $$
  select 'O' || upper(to_char(now(), 'YYMMDDHH24MI')) || substr(replace(gen_random_uuid()::text, '-', ''), 1, 4);
$$ language sql volatile;

-- ============================================================================
-- HELPER: calculate totals (returns subtotal, vat, service, total)
-- Usage: select * from calculate_totals(1000);
-- ============================================================================
create or replace function calculate_totals(p_subtotal integer)
returns table(subtotal integer, vat_amount integer, service_amount integer, total integer) as $$
  select
    p_subtotal,
    round(p_subtotal * 0.14),
    round(p_subtotal * 0.12),
    p_subtotal + round(p_subtotal * 0.14) + round(p_subtotal * 0.12);
$$ language sql immutable;

-- ============================================================================
-- DONE
-- ============================================================================