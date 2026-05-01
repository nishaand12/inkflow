-- Tips, service/product settlement split, and artist payout ledger.

alter table public.appointments
  add column if not exists tip_amount numeric not null default 0;

alter table public.daily_settlements
  add column if not exists tip_total numeric not null default 0,
  add column if not exists cash_collected numeric not null default 0;

alter table public.daily_settlement_lines
  add column if not exists service_amount numeric not null default 0,
  add column if not exists product_amount numeric not null default 0,
  add column if not exists tip_amount numeric not null default 0;

create table if not exists public.artist_payouts (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id),
  artist_id uuid not null references public.artists (id),
  amount numeric not null check (amount > 0),
  payout_method text,
  payout_date date not null default current_date,
  notes text,
  created_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists artist_payouts_studio_idx
  on public.artist_payouts(studio_id);
create index if not exists artist_payouts_artist_date_idx
  on public.artist_payouts(artist_id, payout_date);

create table if not exists public.artist_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id),
  artist_id uuid not null references public.artists (id),
  settlement_id uuid references public.daily_settlements (id) on delete cascade,
  settlement_line_id uuid references public.daily_settlement_lines (id) on delete cascade,
  appointment_id uuid references public.appointments (id) on delete set null,
  payout_id uuid references public.artist_payouts (id) on delete cascade,
  entry_type text not null check (entry_type in ('settlement_share', 'tip', 'payout', 'adjustment')),
  amount numeric not null,
  description text,
  occurred_on date not null default current_date,
  created_by uuid references public.users (id),
  created_at timestamptz not null default now()
);

create index if not exists artist_ledger_entries_studio_idx
  on public.artist_ledger_entries(studio_id);
create index if not exists artist_ledger_entries_artist_date_idx
  on public.artist_ledger_entries(artist_id, occurred_on);
create index if not exists artist_ledger_entries_settlement_idx
  on public.artist_ledger_entries(settlement_id);
create index if not exists artist_ledger_entries_payout_idx
  on public.artist_ledger_entries(payout_id);

drop trigger if exists set_artist_payouts_updated_at on public.artist_payouts;
create trigger set_artist_payouts_updated_at
before update on public.artist_payouts
for each row execute procedure public.set_updated_at();

alter table public.artist_payouts enable row level security;

drop policy if exists artist_payouts_select on public.artist_payouts;
create policy artist_payouts_select
on public.artist_payouts
for select
using (studio_id = public.current_user_studio());

drop policy if exists artist_payouts_insert on public.artist_payouts;
create policy artist_payouts_insert
on public.artist_payouts
for insert
with check (
  studio_id = public.current_user_studio()
  and public.current_user_role() in ('Owner', 'Admin')
);

drop policy if exists artist_payouts_update on public.artist_payouts;
create policy artist_payouts_update
on public.artist_payouts
for update
using (
  studio_id = public.current_user_studio()
  and public.current_user_role() in ('Owner', 'Admin')
);

drop policy if exists artist_payouts_delete on public.artist_payouts;
create policy artist_payouts_delete
on public.artist_payouts
for delete
using (
  studio_id = public.current_user_studio()
  and public.current_user_role() in ('Owner', 'Admin')
);

alter table public.artist_ledger_entries enable row level security;

drop policy if exists artist_ledger_entries_select on public.artist_ledger_entries;
create policy artist_ledger_entries_select
on public.artist_ledger_entries
for select
using (studio_id = public.current_user_studio());

drop policy if exists artist_ledger_entries_insert on public.artist_ledger_entries;
create policy artist_ledger_entries_insert
on public.artist_ledger_entries
for insert
with check (
  studio_id = public.current_user_studio()
  and public.current_user_role() in ('Owner', 'Admin')
);

drop policy if exists artist_ledger_entries_update on public.artist_ledger_entries;
create policy artist_ledger_entries_update
on public.artist_ledger_entries
for update
using (
  studio_id = public.current_user_studio()
  and public.current_user_role() in ('Owner', 'Admin')
);

drop policy if exists artist_ledger_entries_delete on public.artist_ledger_entries;
create policy artist_ledger_entries_delete
on public.artist_ledger_entries
for delete
using (
  studio_id = public.current_user_studio()
  and public.current_user_role() in ('Owner', 'Admin')
);
