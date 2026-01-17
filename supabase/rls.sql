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
  and user_role = (select user_role from public.users where id = auth.uid())
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
