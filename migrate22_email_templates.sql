-- Migration 22: studio-level confirmation/reminder email template settings
ALTER TABLE studios
ADD COLUMN IF NOT EXISTS email_confirmations_enabled boolean NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS booking_confirmation_subject_template text,
ADD COLUMN IF NOT EXISTS booking_confirmation_body_template text,
ADD COLUMN IF NOT EXISTS booking_reminder_subject_template text,
ADD COLUMN IF NOT EXISTS booking_reminder_body_template text;

-- Backfill legacy studios that may have null from manual edits/imports.
UPDATE studios
SET email_confirmations_enabled = true
WHERE email_confirmations_enabled IS NULL;
