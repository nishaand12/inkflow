-- Allow artists to read their own ledger entries while keeping Owners/Admins
-- studio-wide. Front desk and other roles lose ledger read access.

create or replace function public.current_user_artist_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.artists where user_id = auth.uid();
$$;

drop policy if exists artist_ledger_entries_select on public.artist_ledger_entries;
create policy artist_ledger_entries_select
on public.artist_ledger_entries
for select
using (
  studio_id = public.current_user_studio()
  and (
    public.current_user_role() in ('Owner', 'Admin')
    or artist_id = public.current_user_artist_id()
  )
);
