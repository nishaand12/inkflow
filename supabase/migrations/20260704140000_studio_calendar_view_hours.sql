-- Studio-configurable visible hours for the internal calendar time grid.
ALTER TABLE public.studios
  ADD COLUMN IF NOT EXISTS calendar_view_start_hour integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS calendar_view_end_hour integer NOT NULL DEFAULT 24;

ALTER TABLE public.studios
  DROP CONSTRAINT IF EXISTS studios_calendar_view_hours_check;

ALTER TABLE public.studios
  ADD CONSTRAINT studios_calendar_view_hours_check
  CHECK (
    calendar_view_start_hour >= 0
    AND calendar_view_start_hour <= 23
    AND calendar_view_end_hour >= 1
    AND calendar_view_end_hour <= 24
    AND calendar_view_end_hour > calendar_view_start_hour
  );
