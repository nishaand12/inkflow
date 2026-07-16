-- Configurable tender groups for daily reporting + Stripe deposits out of daily totals.
--
-- Studios (and future clients) group in-person tenders into report columns
-- however they like. Defaults: Cash -> "Cash", Other -> "Other", every other
-- in-person tender (Amex/Mastercard/Visa/Debit/E-Transfer/...) -> "Plastic".
-- Stripe never enters these groups: it is an online-channel tender and lives
-- only in the Stripe Deposits report.
--
--   * reporting_tender_groups — per-studio override: tender_type -> group.
--   * report_tender_group() — resolves a tender to its group (override or
--     default), so every report shares one grouping rule.
--   * get_reconciliation_daily_totals — the single plastic_total column
--     (formerly all of in_person_total, cash and Other included) is replaced by
--     dynamic tender_groups on each row and on the period summary, plus
--     tender_group_defs so the UI knows which columns to render.
--   * snapshot_reconciliation_report — future_deposits_total now counts only
--     in-person deposits; Stripe (online) deposits no longer inflate the day.
--   * get_reconciliation_detail_snapshot — tender rows carry their group so
--     the detail page can show Plastic / Cash / Other cards.
--
-- Closed reconciliations are re-snapshotted at the end to refresh
-- future_deposits_total. Artist ledger amounts are untouched.

create table if not exists public.reporting_tender_groups (
  id          uuid primary key default gen_random_uuid(),
  studio_id   uuid not null references public.studios (id),
  tender_type text not null,
  group_key   text not null,
  group_label text not null,
  sort_order  integer not null default 50,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists reporting_tender_groups_unique_idx
  on public.reporting_tender_groups (studio_id, tender_type);

drop trigger if exists set_reporting_tender_groups_updated_at on public.reporting_tender_groups;
create trigger set_reporting_tender_groups_updated_at
before update on public.reporting_tender_groups
for each row execute procedure public.set_updated_at();

alter table public.reporting_tender_groups enable row level security;

drop policy if exists reporting_tender_groups_select on public.reporting_tender_groups;
create policy reporting_tender_groups_select on public.reporting_tender_groups
for select using (studio_id = public.current_user_studio());

drop policy if exists reporting_tender_groups_insert on public.reporting_tender_groups;
create policy reporting_tender_groups_insert on public.reporting_tender_groups
for insert with check (
  studio_id = public.current_user_studio()
  and public.current_user_role() in ('Owner', 'Admin')
);

drop policy if exists reporting_tender_groups_update on public.reporting_tender_groups;
create policy reporting_tender_groups_update on public.reporting_tender_groups
for update using (
  studio_id = public.current_user_studio()
  and public.current_user_role() in ('Owner', 'Admin')
);

drop policy if exists reporting_tender_groups_delete on public.reporting_tender_groups;
create policy reporting_tender_groups_delete on public.reporting_tender_groups
for delete using (
  studio_id = public.current_user_studio()
  and public.current_user_role() in ('Owner', 'Admin')
);

-- ---------------------------------------------------------------------------
-- report_tender_group — studio override first, then built-in defaults.
-- Keep the defaults in sync with src/utils/reportTenderGroups.js.
-- ---------------------------------------------------------------------------
create or replace function public.report_tender_group(p_studio_id uuid, p_tender_type text)
returns table (group_key text, group_label text, sort_order integer)
language sql
stable
set search_path = public
as $$
  select
    coalesce(c.group_key,
      case when p_tender_type = 'Cash' then 'cash'
           when p_tender_type = 'Other' then 'other'
           else 'plastic' end) as group_key,
    coalesce(c.group_label,
      case when p_tender_type = 'Cash' then 'Cash'
           when p_tender_type = 'Other' then 'Other'
           else 'Plastic' end) as group_label,
    coalesce(c.sort_order,
      case when p_tender_type = 'Cash' then 20
           when p_tender_type = 'Other' then 30
           else 10 end) as sort_order
  from (select 1) one
  left join public.reporting_tender_groups c
    on c.studio_id = p_studio_id and c.tender_type = p_tender_type
$$;

grant execute on function public.report_tender_group(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- snapshot_reconciliation_report — future deposits are now IN-PERSON only.
-- Stripe (online) deposits belong to the Stripe Deposits report, not the
-- day's cash. Everything else preserved from 20260714140000.
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

  -- Future deposits: unattached paid deposits collected IN PERSON on this
  -- business_date. Online (Stripe) deposits are reconciled against Stripe.
  select coalesce(sum(p.amount), 0) into v_future_deposits
  from public.payments p
  where p.studio_id = v_recon.studio_id
    and p.location_id = v_recon.location_id
    and p.business_date = v_recon.business_date
    and p.status = 'paid'
    and p.purpose = 'deposit'
    and p.channel = 'in_person'
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
      and s.location_id = v_recon.location_id
      and s.sale_date = v_recon.business_date
      and s.status = 'completed'
  ) agg;

  -- Categories: tax-inclusive gross plus the shop's split of each category.
  -- Per sale, artist_share is allocated across service lines proportional to
  -- each line's tax-inclusive total; non-service lines are 100% shop.
  insert into public.reconciliation_report_categories (
    reconciliation_id, studio_id, category_key, reporting_category_id,
    category_name, gross_total, item_count, shop_split
  )
  select
    v_recon.id,
    v_recon.studio_id,
    cat.category_key,
    cat.reporting_category_id,
    cat.category_name,
    cat.gross_total,
    cat.item_count,
    cat.shop_split
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
      sum(coalesce(li.quantity, 1)) as item_count,
      sum(
        coalesce(li.line_total, 0)
        - case
            when li.line_type = 'service' and coalesce(svc.svc_incl, 0) > 0
              then coalesce(s.artist_share, 0) * coalesce(li.line_total, 0) / svc.svc_incl
            else 0
          end
      ) as shop_split
    from public.sale_line_items li
    inner join public.sales s
      on s.id = li.sale_id
     and s.studio_id = v_recon.studio_id
     and s.location_id = v_recon.location_id
     and s.sale_date = v_recon.business_date
     and s.status = 'completed'
    left join lateral (
      select sum(coalesce(l2.line_total, 0)) as svc_incl
      from public.sale_line_items l2
      where l2.sale_id = s.id
        and l2.studio_id = v_recon.studio_id
        and l2.line_type = 'service'
    ) svc on true
    where li.studio_id = v_recon.studio_id
    group by 1, 2, 3
  ) cat;

  insert into public.reconciliation_report_sales (
    reconciliation_id, studio_id, sale_id, sale_date, artist_id,
    service_total, tax_total, service_tax_total, product_tax_total,
    product_total, tip_total, artist_share, shop_revenue, artist_owed
  )
  select
    v_recon.id,
    v_recon.studio_id,
    s.id,
    s.sale_date,
    s.artist_id,
    coalesce(svc.service_total, 0),
    tx.tax_total,
    tx.service_tax,
    tx.tax_total - tx.service_tax,
    coalesce(svc.product_total, 0),
    coalesce(s.tip_total, 0),
    coalesce(s.artist_share, 0),
    coalesce(svc.service_total, 0)
      + coalesce(svc.product_total, 0)
      + tx.tax_total
      - coalesce(s.artist_share, 0),
    coalesce(s.artist_share, 0) + coalesce(s.tip_total, 0)
  from public.sales s
  left join lateral (
    select
      sum(case when li.line_type = 'service' then coalesce(li.net_amount, 0) else 0 end) as service_total,
      sum(coalesce(li.tax_amount, 0)) as line_tax_total,
      sum(case when li.line_type = 'service' then coalesce(li.tax_amount, 0) else 0 end) as service_tax_total,
      sum(case when li.line_type <> 'service' then coalesce(li.net_amount, 0) else 0 end) as product_total
    from public.sale_line_items li
    where li.sale_id = s.id and li.studio_id = v_recon.studio_id
  ) svc on true
  cross join lateral (
    select
      greatest(coalesce(s.tax_total, 0), coalesce(svc.line_tax_total, 0)) as tax_total,
      least(
        greatest(coalesce(svc.service_tax_total, 0), 0),
        greatest(coalesce(s.tax_total, 0), coalesce(svc.line_tax_total, 0))
      ) as service_tax
  ) tx
  where s.studio_id = v_recon.studio_id
    and s.location_id = v_recon.location_id
    and s.sale_date = v_recon.business_date
    and s.status = 'completed';

  insert into public.reconciliation_report_artists (
    reconciliation_id, studio_id, artist_id,
    service_total, tax_total, service_tax_total, product_tax_total,
    product_total, tip_total, artist_share,
    shop_revenue, artist_owed, sale_count
  )
  select
    v_recon.id,
    v_recon.studio_id,
    rs.artist_id,
    sum(rs.service_total),
    sum(rs.tax_total),
    sum(rs.service_tax_total),
    sum(rs.product_tax_total),
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

grant execute on function public.snapshot_reconciliation_report(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- get_reconciliation_detail_snapshot — tender rows carry their report group
-- so the detail page can render group cards. Everything else preserved.
-- ---------------------------------------------------------------------------
create or replace function public.get_reconciliation_detail_snapshot(p_reconciliation_id uuid)
returns json
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_studio uuid := public.current_user_studio();
  v_recon record;
  v_summary json;
  v_categories json;
  v_artists json;
  v_sales json;
  v_tenders json;
begin
  if v_studio is null then
    raise exception 'No studio in session';
  end if;
  if public.current_user_role() not in ('Owner', 'Admin') then
    raise exception 'Only Owner/Admin may view reconciliation detail';
  end if;

  select * into v_recon
  from public.daily_reconciliations
  where id = p_reconciliation_id and studio_id = v_studio;

  if v_recon.id is null then
    raise exception 'Reconciliation not found';
  end if;
  if v_recon.status <> 'closed' then
    return null;
  end if;

  select row_to_json(s) into v_summary
  from public.reconciliation_report_summaries s
  where s.reconciliation_id = p_reconciliation_id;

  select coalesce(json_agg(row_to_json(c) order by c.gross_total desc), '[]'::json)
  into v_categories
  from (
    select category_key, reporting_category_id, category_name, gross_total, item_count, shop_split
    from public.reconciliation_report_categories
    where reconciliation_id = p_reconciliation_id
  ) c;

  select coalesce(json_agg(row_to_json(a) order by a.shop_revenue desc), '[]'::json)
  into v_artists
  from (
    select
      artist_id, service_total, tax_total, product_total, tip_total,
      round(service_total + service_tax_total, 2) as service_incl_tax,
      round(product_total + product_tax_total, 2) as product_incl_tax,
      artist_share, shop_revenue, artist_owed, sale_count
    from public.reconciliation_report_artists
    where reconciliation_id = p_reconciliation_id
  ) a;

  select coalesce(json_agg(row_to_json(s) order by s.sale_date), '[]'::json)
  into v_sales
  from (
    select
      sale_id as id, sale_date, artist_id,
      service_total as service, tax_total as tax, product_total as product,
      round(service_total + service_tax_total, 2) as service_incl_tax,
      round(product_total + product_tax_total, 2) as product_incl_tax,
      tip_total as tips, artist_share, shop_revenue, artist_owed
    from public.reconciliation_report_sales
    where reconciliation_id = p_reconciliation_id
  ) s;

  select coalesce(json_agg(row_to_json(t) order by t.sort_order, t.tender_type), '[]'::json)
  into v_tenders
  from (
    select
      rt.tender_type, rt.system_amount, rt.pos_amount, rt.variance,
      tg.group_key, tg.group_label, tg.sort_order
    from public.reconciliation_tenders rt
    cross join lateral public.report_tender_group(v_studio, rt.tender_type) tg
    where rt.reconciliation_id = p_reconciliation_id
  ) t;

  return json_build_object(
    'summary', v_summary,
    'categories', coalesce(v_categories, '[]'::json),
    'artists', coalesce(v_artists, '[]'::json),
    'sales', coalesce(v_sales, '[]'::json),
    'tenders', coalesce(v_tenders, '[]'::json)
  );
end;
$$;

grant execute on function public.get_reconciliation_detail_snapshot(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- get_reconciliation_daily_totals — plastic_total (all in-person money) is
-- replaced by per-group tender columns. Groups come from reconciliation_tenders
-- (in-person only, frozen per closed day), so Stripe never appears here.
-- Response adds top-level tender_group_defs: the columns the UI should render,
-- in order (studio overrides union the built-in Plastic/Cash/Other).
-- ---------------------------------------------------------------------------
create or replace function public.get_reconciliation_daily_totals(
  p_start_date date,
  p_end_date date,
  p_location_id uuid default null
)
returns json
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_studio uuid := public.current_user_studio();
  v_rows json;
  v_period json;
  v_period_groups json;
  v_group_defs json;
  v_unreconciled_count integer := 0;
begin
  if v_studio is null then
    raise exception 'No studio in session';
  end if;
  if public.current_user_role() not in ('Owner', 'Admin') then
    raise exception 'Only Owner/Admin may view reports';
  end if;
  if p_start_date is null or p_end_date is null or p_start_date > p_end_date then
    raise exception 'Invalid date range';
  end if;

  -- Columns to render: studio-configured groups (label/sort win) union the
  -- built-in defaults, so Plastic / Cash / Other always show even when empty.
  select coalesce(
    json_agg(json_build_object('key', d.group_key, 'label', d.group_label)
             order by d.sort_order, d.group_key),
    '[]'::json)
  into v_group_defs
  from (
    select distinct on (u.group_key) u.group_key, u.group_label, u.sort_order
    from (
      select g.group_key, g.group_label, g.sort_order, 0 as src_rank
      from public.reporting_tender_groups g
      where g.studio_id = v_studio
      union all
      select b.group_key, b.group_label, b.sort_order, 1 as src_rank
      from (values ('plastic', 'Plastic', 10), ('cash', 'Cash', 20), ('other', 'Other', 30))
        as b(group_key, group_label, sort_order)
    ) u
    order by u.group_key, u.src_rank
  ) d;

  select coalesce(json_agg(row_to_json(d) order by d.business_date desc, d.location_id), '[]'::json)
  into v_rows
  from (
    select
      s.reconciliation_id,
      s.business_date,
      s.location_id,
      s.sale_count,
      round(s.merchandise_total, 2) as gross_sales,
      round(sp.tattoo_split, 2) as tattoo_split,
      round(sp.piercing_split, 2) as piercing_split,
      round(sp.product_other, 2) as product_other,
      round(s.refunds_in_person, 2) as refunds_in_person,
      round(sp.tattoo_split + sp.piercing_split + sp.product_other - s.refunds_in_person, 2) as shop_total,
      tg.groups as tender_groups
    from public.reconciliation_report_summaries s
    inner join public.daily_reconciliations r on r.id = s.reconciliation_id
    left join lateral (
      select
        coalesce(sum(case when art.artist_type in ('tattoo', 'both')
                          then tk.service_shop_take else 0 end), 0) as tattoo_split,
        coalesce(sum(case when art.artist_type = 'piercer'
                          then tk.service_shop_take else 0 end), 0) as piercing_split,
        coalesce(sum(tk.other_shop_take
                     + case when art.artist_type in ('tattoo', 'both', 'piercer')
                            then 0 else tk.service_shop_take end), 0) as product_other
      from public.reconciliation_report_sales rs
      left join public.artists art on art.id = rs.artist_id
      cross join lateral (
        select
          rs.service_total + rs.service_tax_total - rs.artist_share as service_shop_take,
          rs.product_total + rs.product_tax_total as other_shop_take
      ) tk
      where rs.reconciliation_id = s.reconciliation_id
        and rs.studio_id = s.studio_id
    ) sp on true
    left join lateral (
      select coalesce(
        json_agg(json_build_object('key', g.group_key, 'label', g.group_label, 'amount', g.amount)
                 order by g.sort_order, g.group_key),
        '[]'::json) as groups
      from (
        select gt.group_key, gt.group_label, min(gt.sort_order) as sort_order,
               round(sum(t.system_amount), 2) as amount
        from public.reconciliation_tenders t
        cross join lateral public.report_tender_group(v_studio, t.tender_type) gt
        where t.reconciliation_id = s.reconciliation_id
          and t.studio_id = s.studio_id
        group by gt.group_key, gt.group_label
      ) g
    ) tg on true
    where r.studio_id = v_studio
      and r.status = 'closed'
      and s.studio_id = v_studio
      and s.business_date between p_start_date and p_end_date
      and (p_location_id is null or s.location_id = p_location_id)
  ) d;

  select coalesce(
    json_agg(json_build_object('key', g.group_key, 'label', g.group_label, 'amount', g.amount)
             order by g.sort_order, g.group_key),
    '[]'::json)
  into v_period_groups
  from (
    select gt.group_key, gt.group_label, min(gt.sort_order) as sort_order,
           round(sum(t.system_amount), 2) as amount
    from public.reconciliation_tenders t
    inner join public.daily_reconciliations r on r.id = t.reconciliation_id
    cross join lateral public.report_tender_group(v_studio, t.tender_type) gt
    where r.studio_id = v_studio
      and r.status = 'closed'
      and t.studio_id = v_studio
      and r.business_date between p_start_date and p_end_date
      and (p_location_id is null or r.location_id = p_location_id)
    group by gt.group_key, gt.group_label
  ) g;

  select json_build_object(
    'closed_day_count', coalesce(count(*), 0)::integer,
    'sale_count', coalesce(sum(d.sale_count), 0)::integer,
    'gross_sales', coalesce(round(sum(d.gross_sales), 2), 0),
    'tax_total', coalesce(round(sum(d.tax_total), 2), 0),
    'tip_total', coalesce(round(sum(d.tip_total), 2), 0),
    'tattoo_split', coalesce(round(sum(d.tattoo_split), 2), 0),
    'piercing_split', coalesce(round(sum(d.piercing_split), 2), 0),
    'product_other', coalesce(round(sum(d.product_other), 2), 0),
    'refunds_in_person', coalesce(round(sum(d.refunds_in_person), 2), 0),
    'shop_total', coalesce(round(sum(d.shop_total), 2), 0),
    'tender_groups', coalesce(v_period_groups, '[]'::json)
  )
  into v_period
  from (
    select
      s.sale_count,
      s.merchandise_total as gross_sales,
      s.tax_total,
      s.tip_total,
      sp.tattoo_split,
      sp.piercing_split,
      sp.product_other,
      s.refunds_in_person,
      sp.tattoo_split + sp.piercing_split + sp.product_other - s.refunds_in_person as shop_total
    from public.reconciliation_report_summaries s
    inner join public.daily_reconciliations r on r.id = s.reconciliation_id
    left join lateral (
      select
        coalesce(sum(case when art.artist_type in ('tattoo', 'both')
                          then tk.service_shop_take else 0 end), 0) as tattoo_split,
        coalesce(sum(case when art.artist_type = 'piercer'
                          then tk.service_shop_take else 0 end), 0) as piercing_split,
        coalesce(sum(tk.other_shop_take
                     + case when art.artist_type in ('tattoo', 'both', 'piercer')
                            then 0 else tk.service_shop_take end), 0) as product_other
      from public.reconciliation_report_sales rs
      left join public.artists art on art.id = rs.artist_id
      cross join lateral (
        select
          rs.service_total + rs.service_tax_total - rs.artist_share as service_shop_take,
          rs.product_total + rs.product_tax_total as other_shop_take
      ) tk
      where rs.reconciliation_id = s.reconciliation_id
        and rs.studio_id = s.studio_id
    ) sp on true
    where r.studio_id = v_studio
      and r.status = 'closed'
      and s.studio_id = v_studio
      and s.business_date between p_start_date and p_end_date
      and (p_location_id is null or s.location_id = p_location_id)
  ) d;

  with date_span as (
    select generate_series(p_start_date, p_end_date, interval '1 day')::date as business_date
  ),
  scoped_locations as (
    select l.id as location_id
    from public.locations l
    where l.studio_id = v_studio
      and (p_location_id is null or l.id = p_location_id)
  ),
  expected as (
    select d.business_date, sl.location_id
    from date_span d
    cross join scoped_locations sl
  ),
  closed as (
    select dr.business_date, dr.location_id
    from public.daily_reconciliations dr
    where dr.studio_id = v_studio
      and dr.status = 'closed'
      and dr.business_date between p_start_date and p_end_date
      and (p_location_id is null or dr.location_id = p_location_id)
  )
  select count(*)::integer
  into v_unreconciled_count
  from expected e
  left join closed c
    on c.business_date = e.business_date and c.location_id = e.location_id
  where c.business_date is null;

  return json_build_object(
    'rows', coalesce(v_rows, '[]'::json),
    'period_summary', coalesce(v_period, '{}'::json),
    'tender_group_defs', coalesce(v_group_defs, '[]'::json),
    'unreconciled_day_count', coalesce(v_unreconciled_count, 0)
  );
end;
$$;

grant execute on function public.get_reconciliation_daily_totals(date, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Re-snapshot every closed reconciliation so future_deposits_total drops
-- online (Stripe) deposits. Artist ledger entries are not touched.
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
