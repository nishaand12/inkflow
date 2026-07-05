-- Unified financial accounting core.
--
-- Introduces two clean ledgers plus a POS daily close:
--   * sales / sale_line_items  -> revenue (accrual), keyed by sale_date
--   * payments (extended)       -> cash movements, keyed by business_date + tender + channel
--   * daily_reconciliations / reconciliation_tenders -> end-of-day POS reconciliation
--
-- This migration is ADDITIVE ONLY. No existing table is dropped and no existing
-- column is removed, so the running app keeps working. Backfill happens in a
-- separate migration (20260705130000_accounting_backfill.sql).

-- ---------------------------------------------------------------------------
-- Sales (revenue header)
-- ---------------------------------------------------------------------------
create table if not exists public.sales (
  id             uuid primary key default gen_random_uuid(),
  studio_id      uuid not null references public.studios (id),
  location_id    uuid references public.locations (id),
  artist_id      uuid references public.artists (id),
  customer_id    uuid references public.customers (id),
  appointment_id uuid references public.appointments (id) on delete set null,
  sale_date      date not null default current_date,
  status         text not null default 'completed'
                   check (status in ('open', 'completed', 'voided')),
  subtotal       numeric not null default 0,
  tax_total      numeric not null default 0,
  discount_total numeric not null default 0,
  tip_total      numeric not null default 0,
  total          numeric not null default 0,
  notes          text,
  created_by     uuid references public.users (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists sales_studio_date_idx on public.sales (studio_id, sale_date);
create index if not exists sales_location_date_idx on public.sales (location_id, sale_date);
create index if not exists sales_appointment_idx on public.sales (appointment_id);
create index if not exists sales_artist_idx on public.sales (artist_id);
-- One migrated sale per appointment (partial: standalone retail sales have null appointment_id).
create unique index if not exists sales_appointment_unique_idx
  on public.sales (appointment_id)
  where appointment_id is not null;

-- ---------------------------------------------------------------------------
-- Sale line items (canonical itemized revenue; replaces appointment_charges)
-- ---------------------------------------------------------------------------
create table if not exists public.sale_line_items (
  id                      uuid primary key default gen_random_uuid(),
  studio_id               uuid not null references public.studios (id),
  sale_id                 uuid not null references public.sales (id) on delete cascade,
  line_type               text not null default 'product'
                            check (line_type in ('service', 'product', 'adjustment', 'gift_card')),
  reporting_category_id   uuid references public.reporting_categories (id),
  reporting_category_name text,
  product_id              uuid references public.products (id),
  description             text not null,
  quantity                numeric not null default 1,
  unit_price              numeric not null default 0,
  discount_amount         numeric not null default 0,
  tax_rate                numeric not null default 0,
  tax_inclusive           boolean not null default false,
  net_amount              numeric not null default 0,   -- signed pre-tax net (canonical)
  tax_amount              numeric not null default 0,   -- exact per-line tax
  line_total              numeric not null default 0,   -- net_amount + tax_amount
  revenue_sign            smallint not null default 1,  -- +1 normal, -1 negative-revenue
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists sale_line_items_sale_idx on public.sale_line_items (sale_id);
create index if not exists sale_line_items_studio_idx on public.sale_line_items (studio_id);
create index if not exists sale_line_items_category_idx on public.sale_line_items (reporting_category_id);
create index if not exists sale_line_items_product_idx on public.sale_line_items (product_id);

-- ---------------------------------------------------------------------------
-- Payments: extend into a tender/date-aware cash ledger.
-- All columns nullable / defaulted so existing inserts keep working.
-- ---------------------------------------------------------------------------
alter table public.payments
  add column if not exists location_id   uuid references public.locations (id),
  add column if not exists sale_id       uuid references public.sales (id) on delete set null,
  add column if not exists business_date date,
  add column if not exists tender_type   text,   -- Cash|E-Transfer|Amex|Mastercard|Visa|Debit|Other|Stripe
  add column if not exists channel        text,  -- in_person | online
  add column if not exists purpose        text,  -- deposit|balance|retail|tip|refund|gift_card_sale|gift_card_redeem
  add column if not exists occurred_at   timestamptz default now();

create index if not exists payments_close_idx
  on public.payments (studio_id, location_id, business_date, channel, status);
create index if not exists payments_sale_idx on public.payments (sale_id);
create index if not exists payments_business_date_idx on public.payments (business_date);

-- ---------------------------------------------------------------------------
-- Daily reconciliation (POS close)
-- ---------------------------------------------------------------------------
create table if not exists public.daily_reconciliations (
  id                 uuid primary key default gen_random_uuid(),
  studio_id          uuid not null references public.studios (id),
  location_id        uuid not null references public.locations (id),
  business_date      date not null,
  status             text not null default 'open' check (status in ('open', 'closed')),
  in_person_total    numeric not null default 0,   -- system: what the POS batch should total
  online_total       numeric not null default 0,   -- system: Stripe that day (reconciled elsewhere)
  refunds_in_person  numeric not null default 0,
  refunds_online     numeric not null default 0,
  pos_reported_total numeric,                       -- entered from the POS machine
  variance           numeric,                       -- in_person_total - pos_reported_total
  notes              text,
  closed_at          timestamptz,
  closed_by          uuid references public.users (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists daily_reconciliations_unique_idx
  on public.daily_reconciliations (studio_id, location_id, business_date);
create index if not exists daily_reconciliations_studio_date_idx
  on public.daily_reconciliations (studio_id, business_date);

-- Per-tender breakdown (system vs POS printout).
create table if not exists public.reconciliation_tenders (
  id                uuid primary key default gen_random_uuid(),
  studio_id         uuid not null references public.studios (id),
  reconciliation_id uuid not null references public.daily_reconciliations (id) on delete cascade,
  tender_type       text not null,
  system_amount     numeric not null default 0,   -- from payments
  pos_amount        numeric,                       -- entered from POS printout
  variance          numeric,                       -- system_amount - pos_amount
  created_at        timestamptz not null default now()
);

create index if not exists reconciliation_tenders_recon_idx
  on public.reconciliation_tenders (reconciliation_id);
create unique index if not exists reconciliation_tenders_unique_idx
  on public.reconciliation_tenders (reconciliation_id, tender_type);

-- Artist accrual now originates from sales (at checkout), so link ledger entries to a sale.
alter table public.artist_ledger_entries
  add column if not exists sale_id uuid references public.sales (id) on delete set null;
create index if not exists artist_ledger_entries_sale_idx
  on public.artist_ledger_entries (sale_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
drop trigger if exists set_sales_updated_at on public.sales;
create trigger set_sales_updated_at
before update on public.sales
for each row execute procedure public.set_updated_at();

drop trigger if exists set_sale_line_items_updated_at on public.sale_line_items;
create trigger set_sale_line_items_updated_at
before update on public.sale_line_items
for each row execute procedure public.set_updated_at();

drop trigger if exists set_daily_reconciliations_updated_at on public.daily_reconciliations;
create trigger set_daily_reconciliations_updated_at
before update on public.daily_reconciliations
for each row execute procedure public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security (studio scoped; writes for Owner/Admin on close records)
-- ---------------------------------------------------------------------------
alter table public.sales enable row level security;

drop policy if exists sales_select on public.sales;
create policy sales_select on public.sales
for select using (studio_id = public.current_user_studio());

drop policy if exists sales_insert on public.sales;
create policy sales_insert on public.sales
for insert with check (studio_id = public.current_user_studio());

drop policy if exists sales_update on public.sales;
create policy sales_update on public.sales
for update using (studio_id = public.current_user_studio());

drop policy if exists sales_delete on public.sales;
create policy sales_delete on public.sales
for delete using (
  studio_id = public.current_user_studio()
  and public.current_user_role() in ('Owner', 'Admin')
);

alter table public.sale_line_items enable row level security;

drop policy if exists sale_line_items_select on public.sale_line_items;
create policy sale_line_items_select on public.sale_line_items
for select using (studio_id = public.current_user_studio());

drop policy if exists sale_line_items_insert on public.sale_line_items;
create policy sale_line_items_insert on public.sale_line_items
for insert with check (studio_id = public.current_user_studio());

drop policy if exists sale_line_items_update on public.sale_line_items;
create policy sale_line_items_update on public.sale_line_items
for update using (studio_id = public.current_user_studio());

drop policy if exists sale_line_items_delete on public.sale_line_items;
create policy sale_line_items_delete on public.sale_line_items
for delete using (studio_id = public.current_user_studio());

alter table public.daily_reconciliations enable row level security;

drop policy if exists daily_reconciliations_select on public.daily_reconciliations;
create policy daily_reconciliations_select on public.daily_reconciliations
for select using (studio_id = public.current_user_studio());

drop policy if exists daily_reconciliations_insert on public.daily_reconciliations;
create policy daily_reconciliations_insert on public.daily_reconciliations
for insert with check (
  studio_id = public.current_user_studio()
  and public.current_user_role() in ('Owner', 'Admin')
);

drop policy if exists daily_reconciliations_update on public.daily_reconciliations;
create policy daily_reconciliations_update on public.daily_reconciliations
for update using (
  studio_id = public.current_user_studio()
  and public.current_user_role() in ('Owner', 'Admin')
);

drop policy if exists daily_reconciliations_delete on public.daily_reconciliations;
create policy daily_reconciliations_delete on public.daily_reconciliations
for delete using (
  studio_id = public.current_user_studio()
  and public.current_user_role() in ('Owner', 'Admin')
);

alter table public.reconciliation_tenders enable row level security;

drop policy if exists reconciliation_tenders_select on public.reconciliation_tenders;
create policy reconciliation_tenders_select on public.reconciliation_tenders
for select using (studio_id = public.current_user_studio());

drop policy if exists reconciliation_tenders_insert on public.reconciliation_tenders;
create policy reconciliation_tenders_insert on public.reconciliation_tenders
for insert with check (
  studio_id = public.current_user_studio()
  and public.current_user_role() in ('Owner', 'Admin')
);

drop policy if exists reconciliation_tenders_update on public.reconciliation_tenders;
create policy reconciliation_tenders_update on public.reconciliation_tenders
for update using (
  studio_id = public.current_user_studio()
  and public.current_user_role() in ('Owner', 'Admin')
);

drop policy if exists reconciliation_tenders_delete on public.reconciliation_tenders;
create policy reconciliation_tenders_delete on public.reconciliation_tenders
for delete using (
  studio_id = public.current_user_studio()
  and public.current_user_role() in ('Owner', 'Admin')
);
