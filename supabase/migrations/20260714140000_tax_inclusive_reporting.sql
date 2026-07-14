-- Tax-inclusive, shop-centric reporting across reconciliation detail + Reports.
--
-- Owners/admins split the tax-inclusive amount with artists, so every revenue
-- figure they see should be tax-inclusive and on the same basis:
--   * reconciliation_report_sales/artists gain service_tax_total and
--     product_tax_total so "Service (incl. tax)" and "Products (incl. tax)"
--     are exact per sale (per-line tax, not proration). product_tax_total
--     absorbs any legacy header-tax residual so the two always sum to the
--     sale's tax_total.
--   * reconciliation_report_categories gains shop_split: the shop's take of
--     each category's tax-inclusive gross. Per sale, artist_share is allocated
--     across its service lines proportional to each line's tax-inclusive
--     total; product/adjustment lines are 100% shop.
--   * get_reconciliation_detail_snapshot, get_reconciliation_artist_totals,
--     get_reconciliation_category_totals return the new fields.
--   * get_reconciliation_daily_totals now reads the stored per-sale tax split
--     instead of re-deriving it from line items.
--
-- Closed reconciliations are re-snapshotted at the end. Artist ledger amounts
-- are untouched (artist_share/tips math is unchanged).

alter table public.reconciliation_report_sales
  add column if not exists service_tax_total numeric not null default 0,
  add column if not exists product_tax_total numeric not null default 0;

alter table public.reconciliation_report_artists
  add column if not exists service_tax_total numeric not null default 0,
  add column if not exists product_tax_total numeric not null default 0;

alter table public.reconciliation_report_categories
  add column if not exists shop_split numeric not null default 0;

-- ---------------------------------------------------------------------------
-- snapshot_reconciliation_report — adds per-sale service/product tax split and
-- per-category shop_split. Everything else preserved from 20260714120000.
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

  -- Future deposits are CASH: unattached paid deposits on this business_date.
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
-- get_reconciliation_detail_snapshot — expose tax-inclusive service/product
-- and category shop_split for the reconciliation detail page.
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

  select coalesce(json_agg(row_to_json(t) order by t.tender_type), '[]'::json)
  into v_tenders
  from (
    select tender_type, system_amount, pos_amount, variance
    from public.reconciliation_tenders
    where reconciliation_id = p_reconciliation_id
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
-- get_reconciliation_artist_totals — tax-inclusive service/product columns.
-- ---------------------------------------------------------------------------
create or replace function public.get_reconciliation_artist_totals(
  p_start_date date,
  p_end_date date,
  p_location_id uuid default null,
  p_artist_id uuid default null
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

  select coalesce(json_agg(row_to_json(x) order by x.shop_revenue desc), '[]'::json)
  into v_rows
  from (
    select
      a.artist_id,
      sum(a.sale_count)::integer as sale_count,
      round(sum(a.service_total), 2) as service_total,
      round(sum(a.tax_total), 2) as tax_total,
      round(sum(a.product_total), 2) as product_total,
      round(sum(a.service_total + a.service_tax_total), 2) as service_incl_tax,
      round(sum(a.product_total + a.product_tax_total), 2) as product_incl_tax,
      round(sum(a.tip_total), 2) as tip_total,
      round(sum(a.artist_share), 2) as artist_share,
      round(sum(a.shop_revenue), 2) as shop_revenue,
      round(sum(a.artist_owed), 2) as artist_owed
    from public.reconciliation_report_artists a
    inner join public.daily_reconciliations r on r.id = a.reconciliation_id
    where r.studio_id = v_studio
      and r.status = 'closed'
      and a.studio_id = v_studio
      and r.business_date between p_start_date and p_end_date
      and (p_location_id is null or r.location_id = p_location_id)
      and (p_artist_id is null or a.artist_id = p_artist_id)
    group by a.artist_id
  ) x;

  return json_build_object('rows', coalesce(v_rows, '[]'::json));
end;
$$;

grant execute on function public.get_reconciliation_artist_totals(date, date, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- get_reconciliation_category_totals — carry shop_split through leaf/root
-- rollups alongside the tax-inclusive gross.
-- ---------------------------------------------------------------------------
create or replace function public.get_reconciliation_category_totals(
  p_start_date date,
  p_end_date date,
  p_location_id uuid default null,
  p_rollup_mode text default 'leaf'
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
  v_mode text := coalesce(nullif(trim(p_rollup_mode), ''), 'leaf');
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
  if v_mode not in ('leaf', 'root') then
    raise exception 'Invalid rollup mode: %', v_mode;
  end if;

  with recursive
  filtered_lines as (
    select
      c.reporting_category_id,
      c.category_key,
      c.category_name,
      c.gross_total,
      c.item_count,
      c.shop_split
    from public.reconciliation_report_categories c
    inner join public.daily_reconciliations r on r.id = c.reconciliation_id
    where r.studio_id = v_studio
      and r.status = 'closed'
      and c.studio_id = v_studio
      and r.business_date between p_start_date and p_end_date
      and (p_location_id is null or r.location_id = p_location_id)
  ),
  ancestry as (
    select
      rc.id as leaf_id,
      rc.id as current_id,
      rc.parent_id,
      rc.name as current_name,
      0 as depth
    from public.reporting_categories rc
    where rc.studio_id = v_studio
      and coalesce(rc.category_role, 'reporting') = 'reporting'
    union all
    select
      a.leaf_id,
      parent.id,
      parent.parent_id,
      parent.name,
      a.depth + 1
    from ancestry a
    inner join public.reporting_categories parent on parent.id = a.parent_id
    where parent.studio_id = v_studio
  ),
  root_map as (
    select distinct on (leaf_id)
      leaf_id,
      current_id as root_id,
      current_name as root_name
    from ancestry
    order by leaf_id, depth desc
  ),
  rollup_lines as (
    select
      case
        when v_mode = 'root' and fl.reporting_category_id is not null then
          'id:' || rm.root_id::text
        else fl.category_key
      end as rollup_key,
      case
        when v_mode = 'root' and fl.reporting_category_id is not null then
          coalesce(rm.root_name, fl.category_name)
        else fl.category_name
      end as category_name,
      fl.gross_total,
      fl.item_count,
      fl.shop_split
    from filtered_lines fl
    left join root_map rm on rm.leaf_id = fl.reporting_category_id
  )
  select coalesce(json_agg(row_to_json(x) order by x.gross_total desc), '[]'::json)
  into v_rows
  from (
    select
      rollup_key as category_key,
      max(category_name) as category_name,
      round(sum(gross_total), 2) as gross_total,
      round(sum(item_count), 2) as item_count,
      round(sum(shop_split), 2) as shop_split
    from rollup_lines
    group by rollup_key
  ) x;

  return json_build_object('rows', coalesce(v_rows, '[]'::json));
end;
$$;

grant execute on function public.get_reconciliation_category_totals(date, date, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- get_reconciliation_daily_totals — same output as 20260714130000, but the
-- service/product tax split now comes from the stored per-sale columns
-- instead of a per-line lateral.
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
      round(s.in_person_total, 2) as plastic_total
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
    'plastic_total', coalesce(round(sum(d.plastic_total), 2), 0)
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
      sp.tattoo_split + sp.piercing_split + sp.product_other - s.refunds_in_person as shop_total,
      s.in_person_total as plastic_total
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
    'unreconciled_day_count', coalesce(v_unreconciled_count, 0)
  );
end;
$$;

grant execute on function public.get_reconciliation_daily_totals(date, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Re-snapshot every closed reconciliation to populate the new columns.
-- Artist ledger entries are not touched.
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
