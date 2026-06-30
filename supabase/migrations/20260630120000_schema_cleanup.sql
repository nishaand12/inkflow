-- Schema cleanup before first customer go-live.
-- Drops unused tables/columns and legacy notification tracking fields
-- superseded by reminder_*_sent_at columns and studio_notification_profiles.

-- ---------------------------------------------------------------------------
-- appointments: unused + legacy notification columns
-- ---------------------------------------------------------------------------
alter table public.appointments
  drop column if exists invitees,
  drop column if exists reminder_sent_week,
  drop column if exists reminder_sent_day,
  drop column if exists reminder_sent_at,
  drop column if exists reminder_minutes_before;

-- ---------------------------------------------------------------------------
-- daily_settlements: unused notes column
-- ---------------------------------------------------------------------------
alter table public.daily_settlements
  drop column if exists notes;

-- ---------------------------------------------------------------------------
-- artist_split_rules: eligible_category_ids never applied in settlement logic
-- ---------------------------------------------------------------------------
alter table public.artist_split_rules
  drop column if exists eligible_category_ids;

-- ---------------------------------------------------------------------------
-- artist_locations: replaced by artist_weekly_schedules + availabilities
-- ---------------------------------------------------------------------------
drop trigger if exists set_artist_locations_updated_at on public.artist_locations;

drop policy if exists artist_locations_select on public.artist_locations;
drop policy if exists artist_locations_update on public.artist_locations;
drop policy if exists artist_locations_delete on public.artist_locations;
drop policy if exists artist_locations_insert on public.artist_locations;

drop table if exists public.artist_locations;
