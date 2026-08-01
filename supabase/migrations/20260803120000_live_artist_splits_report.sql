-- Live artist splits report — same accrual math as snapshot_reconciliation_report
-- / reconciliation detail "Totals by artist", but read from completed sales as
-- they check out (no closed-day snapshot required).
--
-- Date basis: sales.sale_date (matches closed reconciliation artist totals).

create or replace function public.get_live_artist_splits_report(
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
  v_result json;
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

  with sale_rows as (
    -- Same tax-inclusive split math as snapshot_reconciliation_report →
    -- reconciliation_report_sales.
    select
      s.id,
      s.sale_date,
      s.location_id,
      s.artist_id,
      coalesce(svc.service_total, 0) as service_total,
      tx.tax_total,
      coalesce(svc.product_total, 0) as product_total,
      round(coalesce(svc.service_total, 0) + tx.service_tax, 2) as service_incl_tax,
      round(coalesce(svc.product_total, 0) + (tx.tax_total - tx.service_tax), 2) as product_incl_tax,
      coalesce(s.tip_total, 0) as tip_total,
      coalesce(s.artist_share, 0) as artist_share,
      coalesce(svc.service_total, 0)
        + coalesce(svc.product_total, 0)
        + tx.tax_total
        - coalesce(s.artist_share, 0) as shop_revenue,
      coalesce(s.artist_share, 0) + coalesce(s.tip_total, 0) as artist_owed
    from public.sales s
    left join lateral (
      select
        sum(case when li.line_type = 'service' then coalesce(li.net_amount, 0) else 0 end) as service_total,
        sum(coalesce(li.tax_amount, 0)) as line_tax_total,
        sum(case when li.line_type = 'service' then coalesce(li.tax_amount, 0) else 0 end) as service_tax_total,
        sum(case when li.line_type <> 'service' then coalesce(li.net_amount, 0) else 0 end) as product_total
      from public.sale_line_items li
      where li.sale_id = s.id and li.studio_id = v_studio
    ) svc on true
    cross join lateral (
      select
        greatest(coalesce(s.tax_total, 0), coalesce(svc.line_tax_total, 0)) as tax_total,
        least(
          greatest(coalesce(svc.service_tax_total, 0), 0),
          greatest(coalesce(s.tax_total, 0), coalesce(svc.line_tax_total, 0))
        ) as service_tax
    ) tx
    where s.studio_id = v_studio
      and s.status = 'completed'
      and s.sale_date between p_start_date and p_end_date
      and (p_location_id is null or s.location_id = p_location_id)
      and (p_artist_id is null or s.artist_id = p_artist_id)
  ),
  artists as (
    select
      sr.artist_id,
      count(*)::integer as sale_count,
      round(sum(sr.service_total), 2) as service_total,
      round(sum(sr.tax_total), 2) as tax_total,
      round(sum(sr.product_total), 2) as product_total,
      round(sum(sr.service_incl_tax), 2) as service_incl_tax,
      round(sum(sr.product_incl_tax), 2) as product_incl_tax,
      round(sum(sr.tip_total), 2) as tip_total,
      round(sum(sr.artist_share), 2) as artist_share,
      round(sum(sr.shop_revenue), 2) as shop_revenue,
      round(sum(sr.artist_owed), 2) as artist_owed
    from sale_rows sr
    group by sr.artist_id
  ),
  sales_out as (
    select
      sr.id,
      sr.sale_date,
      sr.location_id,
      sr.artist_id,
      round(sr.service_total, 2) as service,
      round(sr.tax_total, 2) as tax,
      round(sr.product_total, 2) as product,
      sr.service_incl_tax,
      sr.product_incl_tax,
      round(sr.tip_total, 2) as tips,
      round(sr.artist_share, 2) as artist_share,
      round(sr.shop_revenue, 2) as shop_revenue,
      round(sr.artist_owed, 2) as artist_owed
    from sale_rows sr
  ),
  summary as (
    select
      count(*)::integer as sale_count,
      round(coalesce(sum(sr.service_incl_tax), 0), 2) as service_incl_tax,
      round(coalesce(sum(sr.product_incl_tax), 0), 2) as product_incl_tax,
      round(coalesce(sum(sr.tip_total), 0), 2) as tip_total,
      round(coalesce(sum(sr.artist_share), 0), 2) as artist_share,
      round(coalesce(sum(sr.shop_revenue), 0), 2) as shop_revenue,
      round(coalesce(sum(sr.artist_owed), 0), 2) as artist_owed
    from sale_rows sr
  )
  select json_build_object(
    'artists', coalesce((select json_agg(row_to_json(a) order by a.shop_revenue desc) from artists a), '[]'::json),
    'sales', coalesce((select json_agg(row_to_json(s) order by s.sale_date, s.id) from sales_out s), '[]'::json),
    'summary', coalesce((select row_to_json(x) from summary x), json_build_object(
      'sale_count', 0,
      'service_incl_tax', 0,
      'product_incl_tax', 0,
      'tip_total', 0,
      'artist_share', 0,
      'shop_revenue', 0,
      'artist_owed', 0
    ))
  )
  into v_result;

  return v_result;
end;
$$;

grant execute on function public.get_live_artist_splits_report(date, date, uuid, uuid) to authenticated;

comment on function public.get_live_artist_splits_report(date, date, uuid, uuid) is
  'Live artist split totals and per-sale rows from completed sales by sale_date; mirrors closed reconciliation artist splits.';
