-- ============================================================================
-- CACTI — Feedback table
-- Allows customers to leave feedback after their order
-- ============================================================================

create table if not exists feedback (
  id            uuid primary key default gen_random_uuid(),
  order_ref     text,                       -- links to orders.order_ref (nullable for walk-in)
  tracking_token text,                       -- alternative link to order
  customer_name text,
  customer_email text,
  rating        integer not null,            -- 1-5 stars
  comment       text default '',
  created_at    timestamptz default now()
);

create index if not exists idx_feedback_order_ref on feedback(order_ref);
create index if not exists idx_feedback_rating on feedback(rating);
create index if not exists idx_feedback_created on feedback(created_at desc);

-- RLS
alter table feedback enable row level security;

drop policy if exists "feedback_public_insert" on feedback;
create policy "feedback_public_insert" on feedback
  for insert with check (true);

drop policy if exists "feedback_admin_all" on feedback;
create policy "feedback_admin_all" on feedback
  for all using (auth.role() = 'service_role');