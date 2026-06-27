ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS is_all_day boolean NOT NULL DEFAULT false;

ALTER TABLE public.appointments
  ALTER COLUMN start_time DROP NOT NULL,
  ALTER COLUMN end_time DROP NOT NULL;

ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_times_required_unless_all_day
  CHECK (
    is_all_day = true
    OR (start_time IS NOT NULL AND end_time IS NOT NULL)
  );
