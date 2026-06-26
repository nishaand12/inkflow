-- Migration 16: email event delivery status and public booking hierarchy data.

alter table public.email_events
add column if not exists delivery_status text default 'sent',
add column if not exists provider_event_type text,
add column if not exists provider_event_at timestamptz;

update public.email_events
set delivery_status = 'sent'
where delivery_status is null;

create index if not exists email_events_studio_event_time_idx
on public.email_events (studio_id, event_type, occurred_at);

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
    ), '[]'::json)
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.get_public_booking_data(uuid) to anon;
