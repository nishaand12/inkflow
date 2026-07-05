-- Attribute artist accrual AND revenue/category accrual to sale_date instead of
-- payment business_date.
--
-- Context: a reconciliation is a CASH reconciliation, keyed on (business_date,
-- location). Its tender totals (Visa/MC/Cash/Amex), deposits, and variance must
-- keep matching the POS terminal, so those stay on payment business_date and are
-- NOT touched here.
--
-- The accrual side (what was *sold/earned* that day) was previously derived from
-- the same payment-date sale-set: a sale was pulled into a reconciliation if ANY
-- paid payment landed on that business_date. That mis-attributes sales whose
-- deposit and balance fall on different days — e.g. a July-5 tattoo with a $50
-- deposit taken July 4 was counted in BOTH days, and its full artist_share/tip
-- posted to each. It also let the artist ledger (written once at close) and the
-- report snapshot (rebuilt later) diverge.
--
-- Fix: the accrual set for summary revenue, categories, per-sale rows, and the
-- artist ledger is now "completed sales whose sale_date = the reconciliation's
-- business_date at the same location". Cash/tender stays on business_date.
--
-- Rebased on 20260705220000 (tax_total columns + legacy sale-header tax fix);
-- that tax logic is preserved verbatim, only the sale-set predicate changes.

-- ---------------------------------------------------------------------------
-- post_reconciliation_ledger — post consolidated artist earnings (sale_date)
-- Shared by close_daily_reconciliation and the backfill so the two never drift.
-- Idempotent: clears only this reconciliation's settlement_share/tip rows;
-- manual 'payout'/'adjustment' rows (reconciliation_id is null) are preserved.
-- ---------------------------------------------------------------------------
create or replace function public.post_reconciliation_ledger(p_reconciliation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recon public.daily_reconciliations%rowtype;
begin
  select * into v_recon
  from public.daily_reconciliations
  where id = p_reconciliation_id;

  if v_recon.id is null then
    raise exception 'Reconciliation not found: %', p_reconciliation_id;
  end if;

  delete from public.artist_ledger_entries
  where reconciliation_id = p_reconciliation_id
    and entry_type in ('settlement_share', 'tip');

  -- Service fees: one row per artist (sum of sale-level artist_share).
  insert into public.artist_ledger_entries (
    studio_id, artist_id, reconciliation_id, entry_type, amount,
    description, occurred_on, created_by
  )
  select v_recon.studio_id, s.artist_id, p_reconciliation_id, 'settlement_share',
         sum(coalesce(s.artist_share, 0)),
         'Service fees — ' || v_recon.business_date::text,
         v_recon.business_date, v_recon.closed_by
  from public.sales s
  where s.studio_id = v_recon.studio_id
    and s.location_id = v_recon.location_id
    and s.sale_date = v_recon.business_date
    and s.status = 'completed'
    and s.artist_id is not null
  group by s.artist_id
  having sum(coalesce(s.artist_share, 0)) <> 0;

  -- Tips: one row per artist (100% owed to the artist).
  insert into public.artist_ledger_entries (
    studio_id, artist_id, reconciliation_id, entry_type, amount,
    description, occurred_on, created_by
  )
  select v_recon.studio_id, s.artist_id, p_reconciliation_id, 'tip',
         sum(coalesce(s.tip_total, 0)),
         'Tips — ' || v_recon.business_date::text,
         v_recon.business_date, v_recon.closed_by
  from public.sales s
  where s.studio_id = v_recon.studio_id
    and s.location_id = v_recon.location_id
    and s.sale_date = v_recon.business_date
    and s.status = 'completed'
    and s.artist_id is not null
  group by s.artist_id
  having sum(coalesce(s.tip_total, 0)) <> 0;
end;
$$;

grant execute on function public.post_reconciliation_ledger(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- snapshot_reconciliation_report — accrual sections now keyed on sale_date.
-- Cash fields (in_person/online/refunds/pos/variance) and future_deposits stay
-- on the reconciliation / payment business_date. tax_total logic preserved from
-- 20260705220000 (sale-header tax wins when line-item tax is missing).
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
    coalesce(svc.service_total, 0) + coalesce(svc.product_total, 0) - coalesce(s.artist_share, 0),
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

-- ---------------------------------------------------------------------------
-- close_daily_reconciliation — set closed, then post ledger + snapshot report.
-- ---------------------------------------------------------------------------
create or replace function public.close_daily_reconciliation(p_reconciliation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_studio uuid := public.current_user_studio();
  v_recon  record;
begin
  if v_studio is null then
    raise exception 'No studio in session';
  end if;
  if public.current_user_role() not in ('Owner', 'Admin') then
    raise exception 'Only Owner/Admin may close a reconciliation';
  end if;

  select * into v_recon
  from public.daily_reconciliations
  where id = p_reconciliation_id and studio_id = v_studio;

  if v_recon.id is null then
    raise exception 'Reconciliation not found';
  end if;

  -- Mark closed first so closed_by is available to the ledger poster.
  update public.daily_reconciliations
    set status = 'closed', closed_at = now(), closed_by = auth.uid()
    where id = p_reconciliation_id and studio_id = v_studio;

  perform public.post_reconciliation_ledger(p_reconciliation_id);
  perform public.snapshot_reconciliation_report(p_reconciliation_id);
end;
$$;

grant execute on function public.close_daily_reconciliation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Backfill: re-post ledger + re-snapshot every closed reconciliation onto the
-- new sale_date basis. Manual payouts (reconciliation_id is null) are untouched.
-- ---------------------------------------------------------------------------
do $$
declare
  v_recon record;
begin
  for v_recon in
    select id from public.daily_reconciliations where status = 'closed'
  loop
    perform public.post_reconciliation_ledger(v_recon.id);
    perform public.snapshot_reconciliation_report(v_recon.id);
  end loop;
end;
$$;
