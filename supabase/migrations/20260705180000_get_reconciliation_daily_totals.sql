-- Daily Totals report: closed reconciliation snapshots for a date range.

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
      round(s.merchandise_total, 2) as merchandise_total,
      round(s.tax_total, 2) as tax_total,
      round(s.discount_total, 2) as discount_total,
      round(s.tip_total, 2) as tip_total,
      round(s.in_person_total, 2) as in_person_total,
      round(s.online_total, 2) as online_total,
      round(s.refunds_in_person, 2) as refunds_in_person,
      round(s.refunds_online, 2) as refunds_online
    from public.reconciliation_report_summaries s
    inner join public.daily_reconciliations r on r.id = s.reconciliation_id
    where r.studio_id = v_studio
      and r.status = 'closed'
      and s.studio_id = v_studio
      and s.business_date between p_start_date and p_end_date
      and (p_location_id is null or s.location_id = p_location_id)
  ) d;

  select json_build_object(
    'closed_day_count', coalesce(count(*), 0)::integer,
    'sale_count', coalesce(sum(s.sale_count), 0)::integer,
    'merchandise_total', coalesce(round(sum(s.merchandise_total), 2), 0),
    'tax_total', coalesce(round(sum(s.tax_total), 2), 0),
    'discount_total', coalesce(round(sum(s.discount_total), 2), 0),
    'tip_total', coalesce(round(sum(s.tip_total), 2), 0),
    'in_person_total', coalesce(round(sum(s.in_person_total), 2), 0),
    'online_total', coalesce(round(sum(s.online_total), 2), 0),
    'refunds_in_person', coalesce(round(sum(s.refunds_in_person), 2), 0),
    'refunds_online', coalesce(round(sum(s.refunds_online), 2), 0)
  )
  into v_period
  from public.reconciliation_report_summaries s
  inner join public.daily_reconciliations r on r.id = s.reconciliation_id
  where r.studio_id = v_studio
    and r.status = 'closed'
    and s.studio_id = v_studio
    and s.business_date between p_start_date and p_end_date
    and (p_location_id is null or s.location_id = p_location_id);

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
