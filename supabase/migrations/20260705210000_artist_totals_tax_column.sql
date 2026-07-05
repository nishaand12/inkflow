-- Add tax_total to artist/sale reconciliation snapshots and report RPCs.

alter table public.reconciliation_report_sales
  add column if not exists tax_total numeric not null default 0;

alter table public.reconciliation_report_artists
  add column if not exists tax_total numeric not null default 0;

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
    service_total, tax_total, product_total, tip_total, artist_share, shop_revenue, artist_owed
  )
  select
    v_recon.id,
    v_recon.studio_id,
    s.id,
    s.sale_date,
    s.artist_id,
    coalesce(svc.service_total, 0),
    coalesce(svc.tax_total, 0),
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
      sum(coalesce(li.tax_amount, 0)) as tax_total,
      sum(case when li.line_type <> 'service' then coalesce(li.net_amount, 0) else 0 end) as product_total
    from public.sale_line_items li
    where li.sale_id = s.id and li.studio_id = v_recon.studio_id
  ) svc on true
  where s.studio_id = v_recon.studio_id;

  insert into public.reconciliation_report_artists (
    reconciliation_id, studio_id, artist_id,
    service_total, tax_total, product_total, tip_total, artist_share,
    shop_revenue, artist_owed, sale_count
  )
  select
    v_recon.id,
    v_recon.studio_id,
    rs.artist_id,
    sum(rs.service_total),
    sum(rs.tax_total),
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
    select category_key, reporting_category_id, category_name, gross_total, item_count
    from public.reconciliation_report_categories
    where reconciliation_id = p_reconciliation_id
  ) c;

  select coalesce(json_agg(row_to_json(a) order by a.shop_revenue desc), '[]'::json)
  into v_artists
  from (
    select
      artist_id, service_total, tax_total, product_total, tip_total,
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

-- Backfill tax_total on existing closed-day snapshots
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
