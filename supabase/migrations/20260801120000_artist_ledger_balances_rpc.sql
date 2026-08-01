-- Artist balances summed in the database rather than the browser.
--
-- ArtistPayouts fetched every ledger entry for the studio and summed them
-- client-side. Once that table passes the API row cap the response is
-- silently truncated, entries drop out of the sum, and the page reports the
-- wrong amount owed to an artist with no error anywhere.
--
-- Returns only the running balance (sum of amount, the same quantity
-- computeBalances derives); the per-bucket earned/paid/payback breakdown is
-- still computed client-side from the date-scoped entries the page fetches.
--
-- SECURITY INVOKER so the existing artist_ledger_entries_select policy still
-- applies: Owners/Admins see the whole studio, an artist sees only their own.

create or replace function public.artist_ledger_balances(
  p_studio_id uuid,
  p_from date default null,
  p_to date default null
)
returns table (
  artist_id uuid,
  balance numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    e.artist_id,
    coalesce(sum(e.amount), 0) as balance
  from public.artist_ledger_entries e
  where e.studio_id = p_studio_id
    and (p_from is null or e.occurred_on >= p_from)
    and (p_to   is null or e.occurred_on <= p_to)
  group by e.artist_id;
$$;

grant execute on function public.artist_ledger_balances(uuid, date, date)
  to authenticated;
