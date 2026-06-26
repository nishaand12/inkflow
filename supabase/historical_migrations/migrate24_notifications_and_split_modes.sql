-- Migration 24: multi-step notifications and split modes

-- Studio notification settings (5 independent notification types).
ALTER TABLE studios
ADD COLUMN IF NOT EXISTS reminder_secondary_enabled boolean default true,
ADD COLUMN IF NOT EXISTS reminder_secondary_minutes_before integer default 4320,
ADD COLUMN IF NOT EXISTS booking_reminder_secondary_subject_template text,
ADD COLUMN IF NOT EXISTS booking_reminder_secondary_body_template text,
ADD COLUMN IF NOT EXISTS followup_quick_enabled boolean default true,
ADD COLUMN IF NOT EXISTS followup_quick_minutes_after integer default 180,
ADD COLUMN IF NOT EXISTS booking_followup_quick_subject_template text,
ADD COLUMN IF NOT EXISTS booking_followup_quick_body_template text,
ADD COLUMN IF NOT EXISTS followup_longterm_enabled boolean default true,
ADD COLUMN IF NOT EXISTS followup_longterm_minutes_after integer default 30240,
ADD COLUMN IF NOT EXISTS booking_followup_longterm_subject_template text,
ADD COLUMN IF NOT EXISTS booking_followup_longterm_body_template text;

-- Appointment-level per-notification send tracking.
ALTER TABLE appointments
ADD COLUMN IF NOT EXISTS reminder_primary_sent_at timestamptz,
ADD COLUMN IF NOT EXISTS reminder_secondary_sent_at timestamptz,
ADD COLUMN IF NOT EXISTS followup_quick_sent_at timestamptz,
ADD COLUMN IF NOT EXISTS followup_longterm_sent_at timestamptz;

-- Backfill existing reminder state into new primary reminder field.
UPDATE appointments
SET reminder_primary_sent_at = reminder_sent_at
WHERE reminder_sent_at IS NOT NULL
  AND reminder_primary_sent_at IS NULL;

-- Revenue split mode support.
ALTER TABLE artist_split_rules
ADD COLUMN IF NOT EXISTS split_mode text not null default 'percent',
ADD COLUMN IF NOT EXISTS split_value numeric;

UPDATE artist_split_rules
SET split_value = split_percent
WHERE split_value IS NULL;

ALTER TABLE artist_split_rules
DROP CONSTRAINT IF EXISTS artist_split_rules_split_mode_check;

ALTER TABLE artist_split_rules
ADD CONSTRAINT artist_split_rules_split_mode_check
CHECK (split_mode IN ('percent', 'fixed_amount'));

-- Snapshot split mode/value in settlement lines.
ALTER TABLE daily_settlement_lines
ADD COLUMN IF NOT EXISTS split_mode text not null default 'percent',
ADD COLUMN IF NOT EXISTS split_value numeric not null default 0;

UPDATE daily_settlement_lines
SET split_value = split_percent
WHERE split_mode = 'percent'
  AND (split_value = 0 OR split_value IS NULL)
  AND split_percent IS NOT NULL;
