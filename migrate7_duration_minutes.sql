-- Migration 7: Switch appointment_types.default_duration to minutes,
-- and replace appointments.duration_hours with end_time.
-- Run after migrate6_appointment_type_service_cost.sql

-- 1. Rename and convert appointment_types.default_duration → default_duration_minutes (integer)
ALTER TABLE appointment_types
  RENAME COLUMN default_duration TO default_duration_minutes;

ALTER TABLE appointment_types
  ALTER COLUMN default_duration_minutes TYPE integer
  USING ROUND(default_duration_minutes * 60)::integer;

-- 2. Add end_time column to appointments
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS end_time text;

-- 3. Backfill end_time from start_time + duration_hours for any existing test data
UPDATE appointments
SET end_time = TO_CHAR(
  ('2000-01-01 ' || start_time)::timestamp
    + (ROUND(duration_hours * 60)::integer || ' minutes')::interval,
  'HH24:MI'
)
WHERE end_time IS NULL
  AND start_time IS NOT NULL
  AND duration_hours IS NOT NULL;

-- 4. Drop duration_hours from appointments
ALTER TABLE appointments
  DROP COLUMN IF EXISTS duration_hours;
