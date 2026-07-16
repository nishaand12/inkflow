-- Per-method display order for payment methods in reports.
--
-- reporting_tender_groups gains display_order: where each payment method
-- appears in payment-method lists (reconciliation detail "Totals by payment
-- method"). This is separate from sort_order, which orders the GROUP columns
-- (Plastic / Cash / Other) in the Daily Totals report.
--
--   * report_tender_group() now also returns display_order, defaulting to the
--     checkout list order (Cash, E-Transfer, Amex, Mastercard, Visa, Debit,
--     Other) for unconfigured methods.
--   * get_reconciliation_detail_snapshot orders tender rows by display_order
--     instead of tender_type, and returns it for the UI.
--
-- Managed by Owners/Admins on the Categories page (Payment Methods tab).

alter table public.reporting_tender_groups
  add column if not exists display_order integer;

-- Return type changes (new display_order column), so drop + recreate.
-- Callers (daily totals / detail snapshot RPCs) bind at runtime.
drop function if exists public.report_tender_group(uuid, text);

create or replace function public.report_tender_group(p_studio_id uuid, p_tender_type text)
returns table (group_key text, group_label text, sort_order integer, display_order integer)
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
           else 10 end) as sort_order,
    coalesce(c.display_order,
      case p_tender_type
        when 'Cash' then 10
        when 'E-Transfer' then 20
        when 'Amex' then 30
        when 'Mastercard' then 40
        when 'Visa' then 50
        when 'Debit' then 60
        when 'Other' then 70
        else 100 end) as display_order
  from (select 1) one
  left join public.reporting_tender_groups c
    on c.studio_id = p_studio_id and c.tender_type = p_tender_type
$$;

grant execute on function public.report_tender_group(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- get_reconciliation_detail_snapshot — tender rows ordered by the configured
-- method display_order. Everything else preserved from 20260715120000.
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

  select coalesce(json_agg(row_to_json(t) order by t.display_order, t.tender_type), '[]'::json)
  into v_tenders
  from (
    select
      rt.tender_type, rt.system_amount, rt.pos_amount, rt.variance,
      tg.group_key, tg.group_label, tg.sort_order, tg.display_order
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
