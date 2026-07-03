-- Per-artist denylist: artist cannot be booked for excluded appointment types.

create table if not exists public.artist_appointment_type_exclusions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id),
  artist_id uuid not null references public.artists (id) on delete cascade,
  appointment_type_id uuid not null references public.appointment_types (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (artist_id, appointment_type_id)
);

create index if not exists artist_appointment_type_exclusions_studio_idx
  on public.artist_appointment_type_exclusions (studio_id);
create index if not exists artist_appointment_type_exclusions_artist_idx
  on public.artist_appointment_type_exclusions (artist_id);
create index if not exists artist_appointment_type_exclusions_type_idx
  on public.artist_appointment_type_exclusions (appointment_type_id);

alter table public.artist_appointment_type_exclusions enable row level security;

drop policy if exists artist_appointment_type_exclusions_select on public.artist_appointment_type_exclusions;
create policy artist_appointment_type_exclusions_select
on public.artist_appointment_type_exclusions
for select
using (studio_id = public.current_user_studio());

drop policy if exists artist_appointment_type_exclusions_insert on public.artist_appointment_type_exclusions;
create policy artist_appointment_type_exclusions_insert
on public.artist_appointment_type_exclusions
for insert
with check (
  studio_id = public.current_user_studio()
  and public.current_user_role() in ('Owner', 'Admin')
);

drop policy if exists artist_appointment_type_exclusions_update on public.artist_appointment_type_exclusions;
create policy artist_appointment_type_exclusions_update
on public.artist_appointment_type_exclusions
for update
using (
  studio_id = public.current_user_studio()
  and public.current_user_role() in ('Owner', 'Admin')
);

drop policy if exists artist_appointment_type_exclusions_delete on public.artist_appointment_type_exclusions;
create policy artist_appointment_type_exclusions_delete
on public.artist_appointment_type_exclusions
for delete
using (
  studio_id = public.current_user_studio()
  and public.current_user_role() in ('Owner', 'Admin')
);

-- Extend public booking RPC to include service exclusions.
create or replace function public.get_public_booking_data(p_studio_id uuid)
returns json
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_result json;
begin
  if not exists (
    select 1 from studios where id = p_studio_id and is_active = true
  ) then
    return null;
  end if;

  select json_build_object(
    'studio', (
      select row_to_json(s) from studios s where s.id = p_studio_id
    ),
    'appointment_types', coalesce((
      select json_agg(row_to_json(at))
      from appointment_types at
      where at.studio_id = p_studio_id
        and at.is_active = true
        and at.is_public_bookable = true
    ), '[]'::json),
    'appointment_kind_categories', coalesce((
      select json_agg(row_to_json(rc))
      from (
        select id, parent_id, name, display_order, category_role, is_active
        from reporting_categories
        where studio_id = p_studio_id
          and category_role = 'appointment_kind'
          and is_active = true
        order by display_order asc, name asc
      ) rc
    ), '[]'::json),
    'artists', coalesce((
      select json_agg(row_to_json(a))
      from artists a
      where a.studio_id = p_studio_id and a.is_active = true
    ), '[]'::json),
    'locations', coalesce((
      select json_agg(row_to_json(l))
      from locations l
      where l.studio_id = p_studio_id and l.is_active = true
    ), '[]'::json),
    'availabilities', coalesce((
      select json_agg(row_to_json(av))
      from availabilities av
      where av.studio_id = p_studio_id
    ), '[]'::json),
    'weekly_schedules', coalesce((
      select json_agg(row_to_json(ws))
      from artist_weekly_schedules ws
      where ws.studio_id = p_studio_id and ws.is_active = true
    ), '[]'::json),
    'appointments', coalesce((
      select json_agg(row_to_json(ap))
      from (
        select id, artist_id, location_id, appointment_date,
               start_time, end_time, work_station_id, status
        from appointments
        where studio_id = p_studio_id
          and status not in ('cancelled', 'no_show')
      ) ap
    ), '[]'::json),
    'workstations', coalesce((
      select json_agg(row_to_json(wst))
      from workstations wst
      where wst.studio_id = p_studio_id and wst.status = 'active'
    ), '[]'::json),
    'artist_appointment_type_exclusions', coalesce((
      select json_agg(row_to_json(ex))
      from artist_appointment_type_exclusions ex
      where ex.studio_id = p_studio_id
    ), '[]'::json)
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.get_public_booking_data(uuid) to anon;
