-- Reconciliation report snapshots: frozen revenue breakdowns written when a day is closed.
-- Reports and Reconciliation Detail read these instead of re-joining sales/payments/line items.
--
-- Sale set matches close_daily_reconciliation: sales linked to paid payments on the
-- reconciliation's business_date + location_id.

-- ---------------------------------------------------------------------------
-- Helper: category path label (matches getCategoryPathLabel in the app)
-- ---------------------------------------------------------------------------
create or replace function public.reporting_category_path_label(p_studio_id uuid, p_category_id uuid)
returns text
language sql
stable
set search_path = public
as $$
  with recursive chain as (
    select rc.id, rc.parent_id, rc.name as cat_name, 1 as depth
    from public.reporting_categories rc
    where rc.id = p_category_id
      and rc.studio_id = p_studio_id
      and coalesce(rc.category_role, 'reporting') = 'reporting'
    union all
    select rc.id, rc.parent_id, rc.name as cat_name, chain.depth + 1
    from public.reporting_categories rc
    inner join chain on rc.id = chain.parent_id
    where rc.studio_id = p_studio_id
  )
  select coalesce(string_agg(chain.cat_name, ' › ' order by chain.depth desc), '')
  from chain;
$$;

-- ---------------------------------------------------------------------------
-- Snapshot tables
-- ---------------------------------------------------------------------------
create table if not exists public.reconciliation_report_summaries (
  id                    uuid primary key default gen_random_uuid(),
  reconciliation_id     uuid not null references public.daily_reconciliations (id) on delete cascade,
  studio_id             uuid not null references public.studios (id),
  location_id           uuid not null references public.locations (id),
  business_date         date not null,
  sale_count            integer not null default 0,
  subtotal              numeric not null default 0,
  tax_total             numeric not null default 0,
  discount_total        numeric not null default 0,
  tip_total             numeric not null default 0,
  merchandise_total     numeric not null default 0,  -- subtotal + tax_total
  total                 numeric not null default 0,
  in_person_total       numeric not null default 0,
  online_total          numeric not null default 0,
  refunds_in_person     numeric not null default 0,
  refunds_online        numeric not null default 0,
  future_deposits_total numeric not null default 0,
  pos_reported_total    numeric,
  variance              numeric,
  snapshotted_at        timestamptz not null default now()
);

create unique index if not exists reconciliation_report_summaries_recon_idx
  on public.reconciliation_report_summaries (reconciliation_id);
create index if not exists reconciliation_report_summaries_studio_date_idx
  on public.reconciliation_report_summaries (studio_id, business_date);
create index if not exists reconciliation_report_summaries_studio_location_date_idx
  on public.reconciliation_report_summaries (studio_id, location_id, business_date);

create table if not exists public.reconciliation_report_categories (
  id                    uuid primary key default gen_random_uuid(),
  reconciliation_id     uuid not null references public.daily_reconciliations (id) on delete cascade,
  studio_id             uuid not null references public.studios (id),
  category_key          text not null,
  reporting_category_id uuid references public.reporting_categories (id) on delete set null,
  category_name         text not null,
  gross_total           numeric not null default 0,  -- tax-inclusive line_total (total collected)
  item_count            numeric not null default 0
);

create unique index if not exists reconciliation_report_categories_unique_idx
  on public.reconciliation_report_categories (reconciliation_id, category_key);
create index if not exists reconciliation_report_categories_studio_idx
  on public.reconciliation_report_categories (studio_id);

create table if not exists public.reconciliation_report_artists (
  id                uuid primary key default gen_random_uuid(),
  reconciliation_id uuid not null references public.daily_reconciliations (id) on delete cascade,
  studio_id         uuid not null references public.studios (id),
  artist_id         uuid references public.artists (id) on delete set null,
  service_total     numeric not null default 0,
  product_total     numeric not null default 0,
  tip_total         numeric not null default 0,
  artist_share      numeric not null default 0,
  shop_revenue      numeric not null default 0,
  artist_owed       numeric not null default 0,  -- artist_share + tip_total
  sale_count        integer not null default 0
);

create unique index if not exists reconciliation_report_artists_unique_idx
  on public.reconciliation_report_artists (
    reconciliation_id,
    coalesce(artist_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
create index if not exists reconciliation_report_artists_studio_idx
  on public.reconciliation_report_artists (studio_id);

create table if not exists public.reconciliation_report_sales (
  id                uuid primary key default gen_random_uuid(),
  reconciliation_id uuid not null references public.daily_reconciliations (id) on delete cascade,
  studio_id         uuid not null references public.studios (id),
  sale_id           uuid not null references public.sales (id) on delete cascade,
  sale_date         date not null,
  artist_id         uuid references public.artists (id) on delete set null,
  service_total     numeric not null default 0,
  product_total     numeric not null default 0,
  tip_total         numeric not null default 0,
  artist_share      numeric not null default 0,
  shop_revenue      numeric not null default 0,
  artist_owed       numeric not null default 0
);

create unique index if not exists reconciliation_report_sales_unique_idx
  on public.reconciliation_report_sales (reconciliation_id, sale_id);
create index if not exists reconciliation_report_sales_studio_idx
  on public.reconciliation_report_sales (studio_id);

-- ---------------------------------------------------------------------------
-- Row Level Security (read-only for studio users; writes via security definer RPCs)
-- ---------------------------------------------------------------------------
alter table public.reconciliation_report_summaries enable row level security;
alter table public.reconciliation_report_categories enable row level security;
alter table public.reconciliation_report_artists enable row level security;
alter table public.reconciliation_report_sales enable row level security;

drop policy if exists reconciliation_report_summaries_select on public.reconciliation_report_summaries;
create policy reconciliation_report_summaries_select on public.reconciliation_report_summaries
for select using (studio_id = public.current_user_studio());

drop policy if exists reconciliation_report_categories_select on public.reconciliation_report_categories;
create policy reconciliation_report_categories_select on public.reconciliation_report_categories
for select using (studio_id = public.current_user_studio());

drop policy if exists reconciliation_report_artists_select on public.reconciliation_report_artists;
create policy reconciliation_report_artists_select on public.reconciliation_report_artists
for select using (studio_id = public.current_user_studio());

drop policy if exists reconciliation_report_sales_select on public.reconciliation_report_sales;
create policy reconciliation_report_sales_select on public.reconciliation_report_sales
for select using (studio_id = public.current_user_studio());

-- ---------------------------------------------------------------------------
-- snapshot_reconciliation_report — compute and persist breakdown for one day
-- ---------------------------------------------------------------------------
create or replace function public.snapshot_reconciliation_report(p_reconciliation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recon public.daily_reconciliations%rowtype;
  v_future_deposits numeric := 0;
begin
  select * into v_recon
  from public.daily_reconciliations
  where id = p_reconciliation_id;

  if v_recon.id is null then
    raise exception 'Reconciliation not found: %', p_reconciliation_id;
  end if;

  delete from public.reconciliation_report_sales where reconciliation_id = p_reconciliation_id;
  delete from public.reconciliation_report_artists where reconciliation_id = p_reconciliation_id;
  delete from public.reconciliation_report_categories where reconciliation_id = p_reconciliation_id;
  delete from public.reconciliation_report_summaries where reconciliation_id = p_reconciliation_id;

  select coalesce(sum(p.amount), 0) into v_future_deposits
  from public.payments p
  where p.studio_id = v_recon.studio_id
    and p.location_id = v_recon.location_id
    and p.business_date = v_recon.business_date
    and p.status = 'paid'
    and p.purpose = 'deposit'
    and p.sale_id is null;

  insert into public.reconciliation_report_summaries (
    reconciliation_id, studio_id, location_id, business_date,
    sale_count, subtotal, tax_total, discount_total, tip_total,
    merchandise_total, total,
    in_person_total, online_total, refunds_in_person, refunds_online,
    future_deposits_total, pos_reported_total, variance
  )
  select
    v_recon.id,
    v_recon.studio_id,
    v_recon.location_id,
    v_recon.business_date,
    coalesce(agg.sale_count, 0),
    coalesce(agg.subtotal, 0),
    coalesce(agg.tax_total, 0),
    coalesce(agg.discount_total, 0),
    coalesce(agg.tip_total, 0),
    coalesce(agg.merchandise_total, 0),
    coalesce(agg.total, 0),
    v_recon.in_person_total,
    v_recon.online_total,
    v_recon.refunds_in_person,
    v_recon.refunds_online,
    v_future_deposits,
    v_recon.pos_reported_total,
    v_recon.variance
  from (
    select
      count(s.id)::integer as sale_count,
      coalesce(sum(s.subtotal), 0) as subtotal,
      coalesce(sum(s.tax_total), 0) as tax_total,
      coalesce(sum(s.discount_total), 0) as discount_total,
      coalesce(sum(s.tip_total), 0) as tip_total,
      coalesce(sum(s.subtotal + s.tax_total), 0) as merchandise_total,
      coalesce(sum(s.total), 0) as total
    from public.sales s
    where s.studio_id = v_recon.studio_id
      and s.id in (
        select distinct p.sale_id
        from public.payments p
        where p.studio_id = v_recon.studio_id
          and p.location_id = v_recon.location_id
          and p.business_date = v_recon.business_date
          and p.status = 'paid'
          and p.sale_id is not null
      )
  ) agg;

  insert into public.reconciliation_report_categories (
    reconciliation_id, studio_id, category_key, reporting_category_id,
    category_name, gross_total, item_count
  )
  select
    v_recon.id,
    v_recon.studio_id,
    cat.category_key,
    cat.reporting_category_id,
    cat.category_name,
    cat.gross_total,
    cat.item_count
  from (
    select
      case
        when li.reporting_category_id is not null then 'id:' || li.reporting_category_id::text
        else 'name:' || coalesce(nullif(trim(li.reporting_category_name), ''), 'Uncategorized')
      end as category_key,
      li.reporting_category_id,
      coalesce(
        nullif(public.reporting_category_path_label(v_recon.studio_id, li.reporting_category_id), ''),
        nullif(trim(li.reporting_category_name), ''),
        'Uncategorized'
      ) as category_name,
      sum(coalesce(li.line_total, 0)) as gross_total,
      sum(coalesce(li.quantity, 1)) as item_count
    from public.sale_line_items li
    where li.studio_id = v_recon.studio_id
      and li.sale_id in (
        select distinct p.sale_id
        from public.payments p
        where p.studio_id = v_recon.studio_id
          and p.location_id = v_recon.location_id
          and p.business_date = v_recon.business_date
          and p.status = 'paid'
          and p.sale_id is not null
      )
    group by 1, 2, 3
  ) cat;

  insert into public.reconciliation_report_sales (
    reconciliation_id, studio_id, sale_id, sale_date, artist_id,
    service_total, product_total, tip_total, artist_share, shop_revenue, artist_owed
  )
  select
    v_recon.id,
    v_recon.studio_id,
    s.id,
    s.sale_date,
    s.artist_id,
    coalesce(svc.service_total, 0),
    coalesce(svc.product_total, 0),
    coalesce(s.tip_total, 0),
    coalesce(s.artist_share, 0),
    coalesce(svc.service_total, 0) + coalesce(svc.product_total, 0) - coalesce(s.artist_share, 0),
    coalesce(s.artist_share, 0) + coalesce(s.tip_total, 0)
  from public.sales s
  inner join (
    select distinct p.sale_id
    from public.payments p
    where p.studio_id = v_recon.studio_id
      and p.location_id = v_recon.location_id
      and p.business_date = v_recon.business_date
      and p.status = 'paid'
      and p.sale_id is not null
  ) recon_sales on recon_sales.sale_id = s.id
  left join lateral (
    select
      sum(case when li.line_type = 'service' then coalesce(li.net_amount, 0) else 0 end) as service_total,
      sum(case when li.line_type <> 'service' then coalesce(li.net_amount, 0) else 0 end) as product_total
    from public.sale_line_items li
    where li.sale_id = s.id and li.studio_id = v_recon.studio_id
  ) svc on true
  where s.studio_id = v_recon.studio_id;

  insert into public.reconciliation_report_artists (
    reconciliation_id, studio_id, artist_id,
    service_total, product_total, tip_total, artist_share,
    shop_revenue, artist_owed, sale_count
  )
  select
    v_recon.id,
    v_recon.studio_id,
    rs.artist_id,
    sum(rs.service_total),
    sum(rs.product_total),
    sum(rs.tip_total),
    sum(rs.artist_share),
    sum(rs.shop_revenue),
    sum(rs.artist_owed),
    count(*)::integer
  from public.reconciliation_report_sales rs
  where rs.reconciliation_id = v_recon.id
  group by rs.artist_id;
end;
$$;

grant execute on function public.reporting_category_path_label(uuid, uuid) to authenticated;
grant execute on function public.snapshot_reconciliation_report(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- close_daily_reconciliation — also snapshot report data
-- ---------------------------------------------------------------------------
create or replace function public.close_daily_reconciliation(p_reconciliation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_studio uuid := public.current_user_studio();
  v_recon  record;
begin
  if v_studio is null then
    raise exception 'No studio in session';
  end if;
  if public.current_user_role() not in ('Owner', 'Admin') then
    raise exception 'Only Owner/Admin may close a reconciliation';
  end if;

  select * into v_recon
  from public.daily_reconciliations
  where id = p_reconciliation_id and studio_id = v_studio;

  if v_recon.id is null then
    raise exception 'Reconciliation not found';
  end if;

  delete from public.artist_ledger_entries
  where reconciliation_id = p_reconciliation_id and studio_id = v_studio;

  insert into public.artist_ledger_entries (
    studio_id, artist_id, reconciliation_id, entry_type, amount,
    description, occurred_on, created_by
  )
  select v_studio, s.artist_id, p_reconciliation_id, 'settlement_share',
         sum(coalesce(s.artist_share, 0)),
         'Service fees — ' || v_recon.business_date::text,
         v_recon.business_date, auth.uid()
  from public.sales s
  where s.studio_id = v_studio
    and s.artist_id is not null
    and s.id in (
      select distinct p.sale_id
      from public.payments p
      where p.studio_id = v_studio
        and p.sale_id is not null
        and p.status = 'paid'
        and p.business_date = v_recon.business_date
        and p.location_id = v_recon.location_id
    )
  group by s.artist_id
  having sum(coalesce(s.artist_share, 0)) <> 0;

  insert into public.artist_ledger_entries (
    studio_id, artist_id, reconciliation_id, entry_type, amount,
    description, occurred_on, created_by
  )
  select v_studio, s.artist_id, p_reconciliation_id, 'tip',
         sum(coalesce(s.tip_total, 0)),
         'Tips — ' || v_recon.business_date::text,
         v_recon.business_date, auth.uid()
  from public.sales s
  where s.studio_id = v_studio
    and s.artist_id is not null
    and s.id in (
      select distinct p.sale_id
      from public.payments p
      where p.studio_id = v_studio
        and p.sale_id is not null
        and p.status = 'paid'
        and p.business_date = v_recon.business_date
        and p.location_id = v_recon.location_id
    )
  group by s.artist_id
  having sum(coalesce(s.tip_total, 0)) <> 0;

  perform public.snapshot_reconciliation_report(p_reconciliation_id);

  update public.daily_reconciliations
    set status = 'closed', closed_at = now(), closed_by = auth.uid()
    where id = p_reconciliation_id and studio_id = v_studio;
end;
$$;

grant execute on function public.close_daily_reconciliation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- reopen_daily_reconciliation — remove snapshots when reopening
-- ---------------------------------------------------------------------------
create or replace function public.reopen_daily_reconciliation(p_reconciliation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_studio uuid := public.current_user_studio();
begin
  if v_studio is null then
    raise exception 'No studio in session';
  end if;
  if public.current_user_role() not in ('Owner', 'Admin') then
    raise exception 'Only Owner/Admin may reopen a reconciliation';
  end if;

  delete from public.artist_ledger_entries
  where reconciliation_id = p_reconciliation_id and studio_id = v_studio;

  delete from public.reconciliation_report_sales where reconciliation_id = p_reconciliation_id;
  delete from public.reconciliation_report_artists where reconciliation_id = p_reconciliation_id;
  delete from public.reconciliation_report_categories where reconciliation_id = p_reconciliation_id;
  delete from public.reconciliation_report_summaries where reconciliation_id = p_reconciliation_id;

  update public.daily_reconciliations
    set status = 'open', closed_at = null, closed_by = null
    where id = p_reconciliation_id and studio_id = v_studio;
end;
$$;

grant execute on function public.reopen_daily_reconciliation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Backfill snapshots for reconciliations already closed before this migration
-- ---------------------------------------------------------------------------
do $$
declare
  v_recon record;
begin
  for v_recon in
    select id from public.daily_reconciliations where status = 'closed'
  loop
    perform public.snapshot_reconciliation_report(v_recon.id);
  end loop;
end;
$$;
