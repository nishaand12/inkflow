-- Daily Totals report v2: explicit shop-side revenue split.
--
-- Row shape changes:
--   * gross_sales — everything collected across shop & artists for the day's
--     sales: service + tax + product (tips excluded; they are pass-through to
--     artists and do not appear in this report).
--   * tattoo_split / piercing_split — the SHOP's take of service revenue
--     (service net + service-line tax − artist_share), bucketed by the sale
--     artist's type ('tattoo' incl. legacy 'both' → tattoo, 'piercer' →
--     piercing). Net of discounts: discounts already reduce line nets before
--     the split is computed.
--   * product_other — the shop's remaining take: product net + product tax
--     (products are 100% shop) plus service take from sales with no artist or
--     a support-staff (counter/scrub) artist.
--   * refunds_in_person — cash-basis refunds paid out in person that day.
--   * shop_total — tattoo_split + piercing_split + product_other −
--     refunds_in_person. The three split buckets partition sum(shop_revenue)
--     exactly, so shop_total + artist shares + tips reconciles to gross + tips.
--   * plastic_total — all revenue collected in person that day (formerly
--     in_person_total). Online (Stripe) totals are dropped from this report.
--
-- Splits are derived at query time from reconciliation_report_sales +
-- sale_line_items (service-line tax) + artists, so already-closed days get the
-- new columns without re-snapshotting.

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
      left join lateral (
        select coalesce(sum(li.tax_amount) filter (where li.line_type = 'service'), 0) as service_tax
        from public.sale_line_items li
        where li.sale_id = rs.sale_id and li.studio_id = rs.studio_id
      ) lt on true
      cross join lateral (
        select
          rs.service_total + least(lt.service_tax, rs.tax_total) - rs.artist_share as service_shop_take,
          rs.shop_revenue
            - (rs.service_total + least(lt.service_tax, rs.tax_total) - rs.artist_share) as other_shop_take
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
      left join lateral (
        select coalesce(sum(li.tax_amount) filter (where li.line_type = 'service'), 0) as service_tax
        from public.sale_line_items li
        where li.sale_id = rs.sale_id and li.studio_id = rs.studio_id
      ) lt on true
      cross join lateral (
        select
          rs.service_total + least(lt.service_tax, rs.tax_total) - rs.artist_share as service_shop_take,
          rs.shop_revenue
            - (rs.service_total + least(lt.service_tax, rs.tax_total) - rs.artist_share) as other_shop_take
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
