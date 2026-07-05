-- Stripe deposits, sales summary, availability filter, and closed reconciliation detail snapshots.

-- ---------------------------------------------------------------------------
-- get_stripe_payments_report
-- ---------------------------------------------------------------------------
create or replace function public.get_stripe_payments_report(
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
  v_by_purpose json;
  v_summary json;
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

  select coalesce(json_agg(row_to_json(p) order by p.occurred_at desc nulls last, p.paid_at desc nulls last), '[]'::json)
  into v_rows
  from (
    select
      pay.id,
      pay.business_date,
      pay.occurred_at,
      pay.paid_at,
      round(pay.amount, 2) as amount,
      pay.purpose,
      pay.appointment_id,
      pay.customer_id,
      pay.stripe_payment_intent_id,
      pay.stripe_checkout_session_id,
      pay.sale_id,
      pay.location_id
    from public.payments pay
    where pay.studio_id = v_studio
      and pay.status = 'paid'
      and pay.channel = 'online'
      and pay.business_date between p_start_date and p_end_date
      and (p_location_id is null or pay.location_id = p_location_id)
  ) p;

  select coalesce(json_agg(row_to_json(g)), '[]'::json)
  into v_by_purpose
  from (
    select
      coalesce(pay.purpose, 'unknown') as purpose,
      round(sum(pay.amount), 2) as total,
      count(*)::integer as payment_count
    from public.payments pay
    where pay.studio_id = v_studio
      and pay.status = 'paid'
      and pay.channel = 'online'
      and pay.business_date between p_start_date and p_end_date
      and (p_location_id is null or pay.location_id = p_location_id)
    group by coalesce(pay.purpose, 'unknown')
    order by sum(pay.amount) desc
  ) g;

  select json_build_object(
    'gross_collected', coalesce(round(sum(pay.amount) filter (where pay.purpose is distinct from 'refund'), 2), 0),
    'refund_total', coalesce(round(-sum(pay.amount) filter (where pay.purpose = 'refund'), 2), 0),
    'net_collected', coalesce(round(sum(pay.amount), 2), 0),
    'payment_count', coalesce(count(*), 0)::integer
  )
  into v_summary
  from public.payments pay
  where pay.studio_id = v_studio
    and pay.status = 'paid'
    and pay.channel = 'online'
    and pay.business_date between p_start_date and p_end_date
    and (p_location_id is null or pay.location_id = p_location_id);

  return json_build_object(
    'rows', coalesce(v_rows, '[]'::json),
    'by_purpose', coalesce(v_by_purpose, '[]'::json),
    'summary', coalesce(v_summary, '{}'::json)
  );
end;
$$;

grant execute on function public.get_stripe_payments_report(date, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- get_sales_summary_report
-- ---------------------------------------------------------------------------
create or replace function public.get_sales_summary_report(
  p_start_date date,
  p_end_date date,
  p_location_id uuid default null,
  p_artist_id uuid default null,
  p_limit integer default 50,
  p_offset integer default 0
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
  v_total integer := 0;
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 500));
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
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

  select count(*)::integer into v_total
  from public.sales s
  where s.studio_id = v_studio
    and s.status = 'completed'
    and s.sale_date between p_start_date and p_end_date
    and (p_location_id is null or s.location_id = p_location_id)
    and (p_artist_id is null or s.artist_id = p_artist_id);

  select coalesce(json_agg(row_to_json(r)), '[]'::json)
  into v_rows
  from (
    select
      s.id,
      s.created_at,
      s.sale_date,
      s.location_id,
      s.artist_id,
      s.customer_id,
      s.appointment_id,
      round(s.subtotal, 2) as subtotal,
      round(s.tax_total, 2) as tax_total,
      round(s.tip_total, 2) as tip_total,
      round(s.total, 2) as total,
      coalesce((
        select json_agg(
          json_build_object(
            'id', li.id,
            'description', li.description,
            'quantity', li.quantity,
            'line_type', li.line_type,
            'line_total', round(li.line_total, 2),
            'net_amount', round(li.net_amount, 2)
          )
          order by li.created_at
        )
        from public.sale_line_items li
        where li.sale_id = s.id and li.studio_id = v_studio
      ), '[]'::json) as lines
    from public.sales s
    where s.studio_id = v_studio
      and s.status = 'completed'
      and s.sale_date between p_start_date and p_end_date
      and (p_location_id is null or s.location_id = p_location_id)
      and (p_artist_id is null or s.artist_id = p_artist_id)
    order by s.created_at desc
    limit v_limit
    offset v_offset
  ) r;

  return json_build_object(
    'rows', coalesce(v_rows, '[]'::json),
    'total_count', v_total,
    'limit', v_limit,
    'offset', v_offset
  );
end;
$$;

grant execute on function public.get_sales_summary_report(date, date, uuid, uuid, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- get_availabilities_for_report — date-overlap filter (Counter / Scrub hours)
-- ---------------------------------------------------------------------------
create or replace function public.get_availabilities_for_report(
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

  select coalesce(json_agg(row_to_json(a)), '[]'::json)
  into v_rows
  from (
    select
      av.id,
      av.artist_id,
      av.location_id,
      av.start_date,
      av.end_date,
      av.start_time,
      av.end_time,
      av.is_all_day,
      av.is_blocked
    from public.availabilities av
    where av.studio_id = v_studio
      and coalesce(av.is_blocked, false) = false
      and av.start_date <= p_end_date
      and av.end_date >= p_start_date
      and (p_location_id is null or av.location_id is null or av.location_id = p_location_id)
  ) a;

  return json_build_object('rows', coalesce(v_rows, '[]'::json));
end;
$$;

grant execute on function public.get_availabilities_for_report(date, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- get_reconciliation_detail_snapshot — frozen breakdown for closed days
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
    select category_key, reporting_category_id, category_name, gross_total, item_count
    from public.reconciliation_report_categories
    where reconciliation_id = p_reconciliation_id
  ) c;

  select coalesce(json_agg(row_to_json(a) order by a.shop_revenue desc), '[]'::json)
  into v_artists
  from (
    select
      artist_id, service_total, product_total, tip_total,
      artist_share, shop_revenue, artist_owed, sale_count
    from public.reconciliation_report_artists
    where reconciliation_id = p_reconciliation_id
  ) a;

  select coalesce(json_agg(row_to_json(s) order by s.sale_date), '[]'::json)
  into v_sales
  from (
    select
      sale_id as id, sale_date, artist_id,
      service_total as service, product_total as product,
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
