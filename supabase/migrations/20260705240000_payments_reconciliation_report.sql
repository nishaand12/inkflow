-- Payment-centric reconciliation report.
-- Lists paid payments by business_date (the day the money moved / POS terminal day),
-- with per-tender totals for matching against the drawer / card terminal.
-- Generalizes get_stripe_payments_report to all tenders, grouped by tender_type.

-- ---------------------------------------------------------------------------
-- get_payments_report
-- ---------------------------------------------------------------------------
create or replace function public.get_payments_report(
  p_start_date date,
  p_end_date date,
  p_location_id uuid default null,
  p_tender_type text default null,
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
  v_by_tender json;
  v_summary json;
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

  -- Total count over the full filtered set (drives pagination).
  select count(*)::integer into v_total
  from public.payments pay
  where pay.studio_id = v_studio
    and pay.status = 'paid'
    and pay.business_date between p_start_date and p_end_date
    and (p_location_id is null or pay.location_id = p_location_id)
    and (p_tender_type is null or pay.tender_type = p_tender_type);

  -- Page of payment rows.
  select coalesce(json_agg(row_to_json(p)), '[]'::json)
  into v_rows
  from (
    select
      pay.id,
      pay.business_date,
      pay.occurred_at,
      pay.paid_at,
      pay.tender_type,
      pay.channel,
      round(pay.amount, 2) as amount,
      pay.purpose,
      pay.sale_id,
      pay.customer_id,
      pay.appointment_id,
      pay.location_id
    from public.payments pay
    where pay.studio_id = v_studio
      and pay.status = 'paid'
      and pay.business_date between p_start_date and p_end_date
      and (p_location_id is null or pay.location_id = p_location_id)
      and (p_tender_type is null or pay.tender_type = p_tender_type)
    order by pay.business_date desc, pay.occurred_at desc nulls last, pay.paid_at desc nulls last
    limit v_limit
    offset v_offset
  ) p;

  -- Per-tender net totals over the full filtered set (the terminal-matching view).
  -- sum(amount) nets refunds, which are stored as negative-amount rows.
  select coalesce(json_agg(row_to_json(g)), '[]'::json)
  into v_by_tender
  from (
    select
      coalesce(pay.tender_type, 'Unspecified') as tender_type,
      round(sum(pay.amount), 2) as net_total,
      count(*)::integer as payment_count
    from public.payments pay
    where pay.studio_id = v_studio
      and pay.status = 'paid'
      and pay.business_date between p_start_date and p_end_date
      and (p_location_id is null or pay.location_id = p_location_id)
      and (p_tender_type is null or pay.tender_type = p_tender_type)
    group by coalesce(pay.tender_type, 'Unspecified')
    order by sum(pay.amount) desc
  ) g;

  -- Range summary over the full filtered set.
  select json_build_object(
    'net_collected', coalesce(round(sum(pay.amount), 2), 0),
    'refund_total', coalesce(round(-sum(pay.amount) filter (where pay.purpose = 'refund'), 2), 0),
    'payment_count', coalesce(count(*), 0)::integer
  )
  into v_summary
  from public.payments pay
  where pay.studio_id = v_studio
    and pay.status = 'paid'
    and pay.business_date between p_start_date and p_end_date
    and (p_location_id is null or pay.location_id = p_location_id)
    and (p_tender_type is null or pay.tender_type = p_tender_type);

  return json_build_object(
    'rows', coalesce(v_rows, '[]'::json),
    'by_tender', coalesce(v_by_tender, '[]'::json),
    'summary', coalesce(v_summary, '{}'::json),
    'total_count', v_total,
    'limit', v_limit,
    'offset', v_offset
  );
end;
$$;

grant execute on function public.get_payments_report(date, date, uuid, text, integer, integer) to authenticated;
