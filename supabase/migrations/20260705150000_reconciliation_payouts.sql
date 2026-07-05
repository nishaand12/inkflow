-- Post artist earnings into the payout ledger when a reconciliation day is closed.
--
-- Instead of one ledger row per appointment, closing a day writes exactly two
-- consolidated rows per artist for that business date + location:
--   * 'settlement_share'  -> "Service fees — <date>"  (sum of sales.artist_share)
--   * 'tip'               -> "Tips — <date>"          (sum of sales.tip_total)
--
-- The set of sales is the same one the reconciliation detail shows: sales whose
-- cash landed on that business date + location (via payments). Posting is
-- idempotent per reconciliation, so re-closing (or fixing then re-closing) never
-- double-counts.

-- Link ledger rows to the reconciliation that posted them (idempotency + audit).
alter table public.artist_ledger_entries
  add column if not exists reconciliation_id uuid
    references public.daily_reconciliations (id) on delete cascade;

create index if not exists artist_ledger_entries_reconciliation_idx
  on public.artist_ledger_entries (reconciliation_id);

-- ---------------------------------------------------------------------------
-- close_daily_reconciliation — mark closed + post consolidated artist earnings
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

  -- Idempotent: clear any earnings this reconciliation previously posted.
  delete from public.artist_ledger_entries
  where reconciliation_id = p_reconciliation_id and studio_id = v_studio;

  -- Service fees: one row per artist (sum of the sale-level artist_share).
  insert into public.artist_ledger_entries (
    studio_id, artist_id, reconciliation_id, entry_type, amount,
    description, occurred_on, created_by
  )
  select v_studio, s.artist_id, p_reconciliation_id, 'settlement_share',
         sum(coalesce(s.artist_share, 0)),
         'Service fees — ' || v_recon.business_date::text,
         v_recon.business_date, auth.uid()
  from public.sales s
  where s.studio_id = v_studio
    and s.artist_id is not null
    and s.id in (
      select distinct p.sale_id
      from public.payments p
      where p.studio_id = v_studio
        and p.sale_id is not null
        and p.status = 'paid'
        and p.business_date = v_recon.business_date
        and p.location_id = v_recon.location_id
    )
  group by s.artist_id
  having sum(coalesce(s.artist_share, 0)) <> 0;

  -- Tips: one row per artist (100% owed to the artist).
  insert into public.artist_ledger_entries (
    studio_id, artist_id, reconciliation_id, entry_type, amount,
    description, occurred_on, created_by
  )
  select v_studio, s.artist_id, p_reconciliation_id, 'tip',
         sum(coalesce(s.tip_total, 0)),
         'Tips — ' || v_recon.business_date::text,
         v_recon.business_date, auth.uid()
  from public.sales s
  where s.studio_id = v_studio
    and s.artist_id is not null
    and s.id in (
      select distinct p.sale_id
      from public.payments p
      where p.studio_id = v_studio
        and p.sale_id is not null
        and p.status = 'paid'
        and p.business_date = v_recon.business_date
        and p.location_id = v_recon.location_id
    )
  group by s.artist_id
  having sum(coalesce(s.tip_total, 0)) <> 0;

  update public.daily_reconciliations
    set status = 'closed', closed_at = now(), closed_by = auth.uid()
    where id = p_reconciliation_id and studio_id = v_studio;
end;
$$;

grant execute on function public.close_daily_reconciliation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- reopen_daily_reconciliation — reopen a day and unwind its posted earnings
-- ---------------------------------------------------------------------------
create or replace function public.reopen_daily_reconciliation(p_reconciliation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_studio uuid := public.current_user_studio();
begin
  if v_studio is null then
    raise exception 'No studio in session';
  end if;
  if public.current_user_role() not in ('Owner', 'Admin') then
    raise exception 'Only Owner/Admin may reopen a reconciliation';
  end if;

  delete from public.artist_ledger_entries
  where reconciliation_id = p_reconciliation_id and studio_id = v_studio;

  update public.daily_reconciliations
    set status = 'open', closed_at = null, closed_by = null
    where id = p_reconciliation_id and studio_id = v_studio;
end;
$$;

grant execute on function public.reopen_daily_reconciliation(uuid) to authenticated;
