-- Close the writable and readable surface exposed to the public anon key.
--
-- The anon key ships inside the frontend bundle, so anything it is allowed to
-- do, anyone on the internet can do. Six tables had `INSERT ... WITH CHECK
-- (true)`, which let an anonymous caller write rows directly — most seriously
-- fake `payments`, which feed daily reconciliation.
--
-- Public booking is unaffected by any of this: PublicBooking and
-- ManageAppointment never write directly. Every public write goes through an
-- edge function using the service-role key, which bypasses RLS and grants.
-- The money paths (finalize_sale, record_refund_payment,
-- compute_daily_reconciliation, close_daily_reconciliation) are all
-- SECURITY DEFINER and likewise unaffected.

-- ---------------------------------------------------------------------------
-- Scope inserts to the caller's own studio.
-- current_user_studio() is NULL for anon, so anonymous inserts stop matching.
-- ---------------------------------------------------------------------------

drop policy if exists "appointments_insert" on "public"."appointments";
create policy "appointments_insert" on "public"."appointments"
  for insert with check (studio_id = public.current_user_studio());

drop policy if exists "customers_insert" on "public"."customers";
create policy "customers_insert" on "public"."customers"
  for insert with check (studio_id = public.current_user_studio());

drop policy if exists "availabilities_insert" on "public"."availabilities";
create policy "availabilities_insert" on "public"."availabilities"
  for insert with check (studio_id = public.current_user_studio());

-- No client path inserts these; both are written only by SECURITY DEFINER
-- RPCs. Scoping rather than denying outright keeps any staff-side write that
-- does exist working, while still shutting out anonymous callers.
drop policy if exists "payments_insert" on "public"."payments";
create policy "payments_insert" on "public"."payments"
  for insert with check (studio_id = public.current_user_studio());

drop policy if exists "appointment_charges_insert" on "public"."appointment_charges";
create policy "appointment_charges_insert" on "public"."appointment_charges"
  for insert with check (studio_id = public.current_user_studio());

-- ---------------------------------------------------------------------------
-- Studios are the exception: a user creating their first studio has no
-- studio_id yet, so current_user_studio() is NULL and would lock every new
-- owner out of onboarding. Onboarding already stamps owner_id with the
-- creator, so scope to that instead. Anon has a NULL auth.uid() and is
-- blocked. Joining by invite code is a SELECT and is not affected.
-- ---------------------------------------------------------------------------

drop policy if exists "studios_insert" on "public"."studios";
create policy "studios_insert" on "public"."studios"
  for insert with check (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- get_public_booking_data: return only what the booking page renders.
--
-- It previously returned row_to_json(studios), which published invite_code —
-- the code any authenticated user can redeem to join the studio as staff —
-- along with stripe_account_id and every internal email template, to an
-- unauthenticated endpoint.
--
-- It also returned every non-cancelled appointment ever, including all
-- completed history. The page only uses appointments and availabilities to
-- detect slot conflicts, so past rows are pure leak and unbounded growth.
-- ---------------------------------------------------------------------------

create or replace function public.get_public_booking_data(p_studio_id uuid)
returns json
language plpgsql
stable
security definer
set search_path to 'public'
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
      -- Explicit column list: never row_to_json(studios) here.
      select json_build_object(
        'id', s.id,
        'name', s.name,
        'timezone', s.timezone,
        'currency', s.currency,
        'studio_email', s.studio_email,
        'booking_page_disclaimer_template', s.booking_page_disclaimer_template
      )
      from studios s where s.id = p_studio_id
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
        and av.end_date >= current_date
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
          and appointment_date >= current_date
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
