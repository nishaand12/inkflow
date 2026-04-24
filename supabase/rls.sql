-- Enable RLS and add studio scoping policies.
-- NOTE: This assumes every table has a studio_id column except studios (uses id).

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select user_role from public.users where id = auth.uid();
$$;

create or replace function public.current_user_studio()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select studio_id from public.users where id = auth.uid();
$$;

-- Studios
alter table public.studios enable row level security;

drop policy if exists studios_select on public.studios;
create policy studios_select
on public.studios
for select
using (
  id = public.current_user_studio()
  or (invite_code is not null and auth.role() = 'authenticated')
);

drop policy if exists studios_update on public.studios;
create policy studios_update
on public.studios
for update
using (id = public.current_user_studio());

drop policy if exists studios_delete on public.studios;
create policy studios_delete
on public.studios
for delete
using (id = public.current_user_studio());

drop policy if exists studios_insert on public.studios;
create policy studios_insert
on public.studios
for insert
with check (true);

-- Users (Owner/Admin only for create/update/delete)
alter table public.users enable row level security;

drop policy if exists users_select on public.users;
create policy users_select
on public.users
for select
using (
  id = auth.uid()
  or studio_id = public.current_user_studio()
);

drop policy if exists users_update on public.users;
create policy users_update
on public.users
for update
using (
  studio_id = public.current_user_studio()
  and public.current_user_role() in ('Owner', 'Admin')
);

drop policy if exists users_self_update on public.users;
create policy users_self_update
on public.users
for update
using (id = auth.uid())
with check (
  id = auth.uid()
  and (
    -- Allow all changes during initial onboarding (user currently has no studio)
    (select studio_id from public.users where id = auth.uid()) is null
    -- After onboarding, prevent users from changing their own role
    or user_role = (select user_role from public.users where id = auth.uid())
  )
);

drop policy if exists users_delete on public.users;
create policy users_delete
on public.users
for delete
using (
  studio_id = public.current_user_studio()
  and public.current_user_role() in ('Owner', 'Admin')
);

drop policy if exists users_insert on public.users;
create policy users_insert
on public.users
for insert
with check (id = auth.uid());

-- Locations (Owner/Admin only for create/update/delete)
alter table public.locations enable row level security;

drop policy if exists locations_select on public.locations;
create policy locations_select
on public.locations
for select
using (studio_id = public.current_user_studio());

drop policy if exists locations_update on public.locations;
create policy locations_update
on public.locations
for update
using (
  studio_id = public.current_user_studio()
  and public.current_user_role() in ('Owner', 'Admin')
);

drop policy if exists locations_delete on public.locations;
create policy locations_delete
on public.locations
for delete
using (
  studio_id = public.current_user_studio()
  and public.current_user_role() in ('Owner', 'Admin')
);

drop policy if exists locations_insert on public.locations;
create policy locations_insert
on public.locations
for insert
with check (public.current_user_role() in ('Owner', 'Admin'));

-- Artists (Owner/Admin only for create/update/delete)
alter table public.artists enable row level security;

drop policy if exists artists_select on public.artists;
create policy artists_select
on public.artists
for select
using (studio_id = public.current_user_studio());

drop policy if exists artists_update on public.artists;
create policy artists_update
on public.artists
for update
using (
  studio_id = public.current_user_studio()
  and public.current_user_role() in ('Owner', 'Admin')
);

drop policy if exists artists_self_update on public.artists;
create policy artists_self_update
on public.artists
for update
using (
  studio_id = public.current_user_studio()
  and user_id = auth.uid()
)
with check (
  studio_id = public.current_user_studio()
  and user_id = auth.uid()
);

drop policy if exists artists_delete on public.artists;
create policy artists_delete
on public.artists
for delete
using (
  studio_id = public.current_user_studio()
  and public.current_user_role() in ('Owner', 'Admin')
);

drop policy if exists artists_insert on public.artists;
create policy artists_insert
on public.artists
for insert
with check (public.current_user_role() in ('Owner', 'Admin'));

-- Artist Locations
alter table public.artist_locations enable row level security;

drop policy if exists artist_locations_select on public.artist_locations;
create policy artist_locations_select
on public.artist_locations
for select
using (studio_id = public.current_user_studio());

drop policy if exists artist_locations_update on public.artist_locations;
create policy artist_locations_update
on public.artist_locations
for update
using (studio_id = public.current_user_studio());

drop policy if exists artist_locations_delete on public.artist_locations;
create policy artist_locations_delete
on public.artist_locations
for delete
using (studio_id = public.current_user_studio());

drop policy if exists artist_locations_insert on public.artist_locations;
create policy artist_locations_insert
on public.artist_locations
for insert
with check (true);

-- Availabilities
alter table public.availabilities enable row level security;

drop policy if exists availabilities_select on public.availabilities;
create policy availabilities_select
on public.availabilities
for select
using (studio_id = public.current_user_studio());

drop policy if exists availabilities_update on public.availabilities;
create policy availabilities_update
on public.availabilities
for update
using (studio_id = public.current_user_studio());

drop policy if exists availabilities_delete on public.availabilities;
create policy availabilities_delete
on public.availabilities
for delete
using (studio_id = public.current_user_studio());

drop policy if exists availabilities_insert on public.availabilities;
create policy availabilities_insert
on public.availabilities
for insert
with check (true);

-- Workstations (Owner/Admin only for create/update/delete)
alter table public.workstations enable row level security;

drop policy if exists workstations_select on public.workstations;
create policy workstations_select
on public.workstations
for select
using (studio_id = public.current_user_studio());

drop policy if exists workstations_update on public.workstations;
create policy workstations_update
on public.workstations
for update
using (
  studio_id = public.current_user_studio()
  and public.current_user_role() in ('Owner', 'Admin')
);

drop policy if exists workstations_delete on public.workstations;
create policy workstations_delete
on public.workstations
for delete
using (
  studio_id = public.current_user_studio()
  and public.current_user_role() in ('Owner', 'Admin')
);

drop policy if exists workstations_insert on public.workstations;
create policy workstations_insert
on public.workstations
for insert
with check (public.current_user_role() in ('Owner', 'Admin'));

-- Customers
alter table public.customers enable row level security;

drop policy if exists customers_select on public.customers;
create policy customers_select
on public.customers
for select
using (studio_id = public.current_user_studio());

drop policy if exists customers_update on public.customers;
create policy customers_update
on public.customers
for update
using (studio_id = public.current_user_studio());

drop policy if exists customers_delete on public.customers;
create policy customers_delete
on public.customers
for delete
using (studio_id = public.current_user_studio());

drop policy if exists customers_insert on public.customers;
create policy customers_insert
on public.customers
for insert
with check (true);

-- Appointment Types (Owner/Admin only for create/update/delete)
alter table public.appointment_types enable row level security;

drop policy if exists appointment_types_select on public.appointment_types;
create policy appointment_types_select
on public.appointment_types
for select
using (studio_id = public.current_user_studio());

drop policy if exists appointment_types_update on public.appointment_types;
create policy appointment_types_update
on public.appointment_types
for update
using (
  studio_id = public.current_user_studio()
  and public.current_user_role() in ('Owner', 'Admin')
);

drop policy if exists appointment_types_delete on public.appointment_types;
create policy appointment_types_delete
on public.appointment_types
for delete
using (
  studio_id = public.current_user_studio()
  and public.current_user_role() in ('Owner', 'Admin')
);

drop policy if exists appointment_types_insert on public.appointment_types;
create policy appointment_types_insert
on public.appointment_types
for insert
with check (public.current_user_role() in ('Owner', 'Admin'));

-- Appointments
alter table public.appointments enable row level security;

drop policy if exists appointments_select on public.appointments;
create policy appointments_select
on public.appointments
for select
using (studio_id = public.current_user_studio());

drop policy if exists appointments_update on public.appointments;
create policy appointments_update
on public.appointments
for update
using (studio_id = public.current_user_studio());

drop policy if exists appointments_delete on public.appointments;
create policy appointments_delete
on public.appointments
for delete
using (studio_id = public.current_user_studio());

drop policy if exists appointments_insert on public.appointments;
create policy appointments_insert
on public.appointments
for insert
with check (true);

-- Payments
alter table public.payments enable row level security;

drop policy if exists payments_select on public.payments;
create policy payments_select
on public.payments
for select
using (studio_id = public.current_user_studio());

drop policy if exists payments_insert on public.payments;
create policy payments_insert
on public.payments
for insert
with check (true);

drop policy if exists payments_update on public.payments;
create policy payments_update
on public.payments
for update
using (studio_id = public.current_user_studio());

drop policy if exists payments_delete on public.payments;
create policy payments_delete
on public.payments
for delete
using (
  studio_id = public.current_user_studio()
  and public.current_user_role() in ('Owner', 'Admin')
);

-- Public booking: all data is accessed exclusively through security definer
-- functions that are explicitly scoped to a single studio_id. Anon users have
-- no direct table access, preventing cross-studio data enumeration.

-- Studios: anon may read basic info for active studios only (used for slug resolution).
drop policy if exists studios_select_anon on public.studios;
create policy studios_select_anon
on public.studios
for select
to anon
using (is_active = true);

-- Drop any previously broad anon policies on sensitive booking tables.
drop policy if exists appointment_types_select_anon on public.appointment_types;
drop policy if exists artists_select_anon on public.artists;
drop policy if exists locations_select_anon on public.locations;
drop policy if exists availabilities_select_anon on public.availabilities;
drop policy if exists workstations_select_anon on public.workstations;
drop policy if exists appointments_select_anon on public.appointments;

-- Returns all data needed for the public booking page, scoped to a single
-- studio. Running as security definer means it bypasses RLS and applies its
-- own explicit studio_id filter — anon callers cannot access other studios.
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
               start_time, duration_hours, work_station_id, status
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

-- Reporting Categories (Owner/Admin manage, all studio members read)
alter table public.reporting_categories enable row level security;

drop policy if exists reporting_categories_select on public.reporting_categories;
create policy reporting_categories_select
on public.reporting_categories
for select
using (studio_id = public.current_user_studio());

drop policy if exists reporting_categories_insert on public.reporting_categories;
create policy reporting_categories_insert
on public.reporting_categories
for insert
with check (public.current_user_role() in ('Owner', 'Admin'));

drop policy if exists reporting_categories_update on public.reporting_categories;
create policy reporting_categories_update
on public.reporting_categories
for update
using (
  studio_id = public.current_user_studio()
  and public.current_user_role() in ('Owner', 'Admin')
);

drop policy if exists reporting_categories_delete on public.reporting_categories;
create policy reporting_categories_delete
on public.reporting_categories
for delete
using (
  studio_id = public.current_user_studio()
  and public.current_user_role() in ('Owner', 'Admin')
);

-- Products (Owner/Admin manage, all studio members read)
alter table public.products enable row level security;

drop policy if exists products_select on public.products;
create policy products_select
on public.products
for select
using (studio_id = public.current_user_studio());

drop policy if exists products_insert on public.products;
create policy products_insert
on public.products
for insert
with check (public.current_user_role() in ('Owner', 'Admin'));

drop policy if exists products_update on public.products;
create policy products_update
on public.products
for update
using (
  studio_id = public.current_user_studio()
  and public.current_user_role() in ('Owner', 'Admin')
);

drop policy if exists products_delete on public.products;
create policy products_delete
on public.products
for delete
using (
  studio_id = public.current_user_studio()
  and public.current_user_role() in ('Owner', 'Admin')
);

-- Appointment Charges (studio members create/read, admin manage)
alter table public.appointment_charges enable row level security;

drop policy if exists appointment_charges_select on public.appointment_charges;
create policy appointment_charges_select
on public.appointment_charges
for select
using (studio_id = public.current_user_studio());

drop policy if exists appointment_charges_insert on public.appointment_charges;
create policy appointment_charges_insert
on public.appointment_charges
for insert
with check (true);

drop policy if exists appointment_charges_update on public.appointment_charges;
create policy appointment_charges_update
on public.appointment_charges
for update
using (studio_id = public.current_user_studio());

drop policy if exists appointment_charges_delete on public.appointment_charges;
create policy appointment_charges_delete
on public.appointment_charges
for delete
using (studio_id = public.current_user_studio());

-- Artist Split Rules (Owner/Admin only)
alter table public.artist_split_rules enable row level security;

drop policy if exists artist_split_rules_select on public.artist_split_rules;
create policy artist_split_rules_select
on public.artist_split_rules
for select
using (studio_id = public.current_user_studio());

drop policy if exists artist_split_rules_insert on public.artist_split_rules;
create policy artist_split_rules_insert
on public.artist_split_rules
for insert
with check (public.current_user_role() in ('Owner', 'Admin'));

drop policy if exists artist_split_rules_update on public.artist_split_rules;
create policy artist_split_rules_update
on public.artist_split_rules
for update
using (
  studio_id = public.current_user_studio()
  and public.current_user_role() in ('Owner', 'Admin')
);

drop policy if exists artist_split_rules_delete on public.artist_split_rules;
create policy artist_split_rules_delete
on public.artist_split_rules
for delete
using (
  studio_id = public.current_user_studio()
  and public.current_user_role() in ('Owner', 'Admin')
);

-- Daily Settlements (Owner/Admin manage)
alter table public.daily_settlements enable row level security;

drop policy if exists daily_settlements_select on public.daily_settlements;
create policy daily_settlements_select
on public.daily_settlements
for select
using (studio_id = public.current_user_studio());

drop policy if exists daily_settlements_insert on public.daily_settlements;
create policy daily_settlements_insert
on public.daily_settlements
for insert
with check (public.current_user_role() in ('Owner', 'Admin'));

drop policy if exists daily_settlements_update on public.daily_settlements;
create policy daily_settlements_update
on public.daily_settlements
for update
using (
  studio_id = public.current_user_studio()
  and public.current_user_role() in ('Owner', 'Admin')
);

drop policy if exists daily_settlements_delete on public.daily_settlements;
create policy daily_settlements_delete
on public.daily_settlements
for delete
using (
  studio_id = public.current_user_studio()
  and public.current_user_role() in ('Owner', 'Admin')
);

-- Daily Settlement Lines
alter table public.daily_settlement_lines enable row level security;

drop policy if exists daily_settlement_lines_select on public.daily_settlement_lines;
create policy daily_settlement_lines_select
on public.daily_settlement_lines
for select
using (studio_id = public.current_user_studio());

drop policy if exists daily_settlement_lines_insert on public.daily_settlement_lines;
create policy daily_settlement_lines_insert
on public.daily_settlement_lines
for insert
with check (public.current_user_role() in ('Owner', 'Admin'));

drop policy if exists daily_settlement_lines_delete on public.daily_settlement_lines;
create policy daily_settlement_lines_delete
on public.daily_settlement_lines
for delete
using (
  studio_id = public.current_user_studio()
  and public.current_user_role() in ('Owner', 'Admin')
);

-- Email Events
alter table public.email_events enable row level security;

drop policy if exists email_events_select on public.email_events;
create policy email_events_select
on public.email_events
for select
using (studio_id = public.current_user_studio());

drop policy if exists email_events_insert on public.email_events;
create policy email_events_insert
on public.email_events
for insert
with check (studio_id = public.current_user_studio());

-- Artist Weekly Schedules
alter table public.artist_weekly_schedules enable row level security;

drop policy if exists aws_select on public.artist_weekly_schedules;
create policy aws_select
on public.artist_weekly_schedules
for select
using (studio_id = public.current_user_studio());

drop policy if exists aws_insert on public.artist_weekly_schedules;
create policy aws_insert
on public.artist_weekly_schedules
for insert
with check (studio_id = public.current_user_studio());

drop policy if exists aws_update on public.artist_weekly_schedules;
create policy aws_update
on public.artist_weekly_schedules
for update
using (studio_id = public.current_user_studio());

drop policy if exists aws_delete on public.artist_weekly_schedules;
create policy aws_delete
on public.artist_weekly_schedules
for delete
using (studio_id = public.current_user_studio());

-- artist_weekly_schedules anon access is handled by get_public_booking_data().
drop policy if exists aws_select_anon on public.artist_weekly_schedules;
