-- Make report shop_revenue tax-inclusive so the two split columns partition the
-- gross sale: artist_owed + shop_revenue = service + product + tax + tips.
--
-- Previously shop_revenue = service + product - artist_share, which dropped the
-- sale's tax entirely from the shop side while artist_share (percent splits)
-- already contains the artist's service-tax portion — the columns weren't on the
-- same basis and didn't reconcile back to the gross total.
--
-- Now shop_revenue = service + product + tax - artist_share, i.e. the shop keeps
-- product revenue, product tax, and its ratio share of service + service tax.
-- Tips remain 100% artist (in artist_owed, never in shop_revenue).
--
-- Rebased on 20260705230000 (accrual by sale_date); everything except the
-- shop_revenue expression is preserved verbatim. Closed reconciliations are
-- re-snapshotted at the end; the artist ledger is untouched (artist_share and
-- tip math are unchanged).

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
        select s.id
        from public.sales s
        where s.studio_id = v_recon.studio_id
          and s.location_id = v_recon.location_id
          and s.sale_date = v_recon.business_date
          and s.status = 'completed'
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
    greatest(coalesce(s.tax_total, 0), coalesce(svc.line_tax_total, 0)),
    coalesce(svc.product_total, 0),
    coalesce(s.tip_total, 0),
    coalesce(s.artist_share, 0),
    coalesce(svc.service_total, 0)
      + coalesce(svc.product_total, 0)
      + greatest(coalesce(s.tax_total, 0), coalesce(svc.line_tax_total, 0))
      - coalesce(s.artist_share, 0),
    coalesce(s.artist_share, 0) + coalesce(s.tip_total, 0)
  from public.sales s
  left join lateral (
    select
      sum(case when li.line_type = 'service' then coalesce(li.net_amount, 0) else 0 end) as service_total,
      sum(coalesce(li.tax_amount, 0)) as line_tax_total,
      sum(case when li.line_type <> 'service' then coalesce(li.net_amount, 0) else 0 end) as product_total
    from public.sale_line_items li
    where li.sale_id = s.id and li.studio_id = v_recon.studio_id
  ) svc on true
  where s.studio_id = v_recon.studio_id
    and s.location_id = v_recon.location_id
    and s.sale_date = v_recon.business_date
    and s.status = 'completed';

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

grant execute on function public.snapshot_reconciliation_report(uuid) to authenticated;

-- Re-snapshot every closed reconciliation onto the tax-inclusive shop_revenue
-- basis. Ledger entries are not touched — artist amounts are unchanged.
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
