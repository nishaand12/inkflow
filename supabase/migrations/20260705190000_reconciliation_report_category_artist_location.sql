-- Category, artist, and location reports from closed reconciliation snapshots.

-- ---------------------------------------------------------------------------
-- get_reconciliation_category_totals
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
      c.item_count
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
      fl.item_count
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
      round(sum(item_count), 2) as item_count
    from rollup_lines
    group by rollup_key
  ) x;

  return json_build_object('rows', coalesce(v_rows, '[]'::json));
end;
$$;

grant execute on function public.get_reconciliation_category_totals(date, date, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- get_reconciliation_artist_totals
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

grant execute on function public.get_reconciliation_artist_totals(date, date, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- get_reconciliation_location_totals
-- ---------------------------------------------------------------------------
create or replace function public.get_reconciliation_location_totals(
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

  select coalesce(json_agg(row_to_json(x) order by x.merchandise_total desc), '[]'::json)
  into v_rows
  from (
    select
      s.location_id,
      count(*)::integer as closed_day_count,
      sum(s.sale_count)::integer as sale_count,
      round(sum(s.merchandise_total), 2) as merchandise_total,
      round(sum(s.tax_total), 2) as tax_total,
      round(sum(s.discount_total), 2) as discount_total,
      round(sum(s.tip_total), 2) as tip_total,
      round(sum(s.in_person_total), 2) as in_person_total,
      round(sum(s.online_total), 2) as online_total,
      round(sum(s.refunds_in_person + s.refunds_online), 2) as refunds_total
    from public.reconciliation_report_summaries s
    inner join public.daily_reconciliations r on r.id = s.reconciliation_id
    where r.studio_id = v_studio
      and r.status = 'closed'
      and s.studio_id = v_studio
      and s.business_date between p_start_date and p_end_date
      and (p_location_id is null or s.location_id = p_location_id)
    group by s.location_id
  ) x;

  return json_build_object('rows', coalesce(v_rows, '[]'::json));
end;
$$;

grant execute on function public.get_reconciliation_location_totals(date, date, uuid) to authenticated;
