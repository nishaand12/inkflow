-- Optional short label shown on calendar cards (e.g. "Sleeve consult", "Touch-up").
ALTER TABLE appointments
ADD COLUMN IF NOT EXISTS appointment_name text;
