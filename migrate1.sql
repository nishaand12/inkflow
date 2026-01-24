-- migrate1.sql: migrate to updated schema additions for Plus tier

-- Studios: add email/tier/reminder/timezone columns
ALTER TABLE studios
ADD COLUMN IF NOT EXISTS studio_email text,
ADD COLUMN IF NOT EXISTS timezone text DEFAULT 'UTC',
ADD COLUMN IF NOT EXISTS subscription_tier text DEFAULT 'basic',
ADD COLUMN IF NOT EXISTS email_reminders_enabled boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS reminder_minutes_before integer DEFAULT 1440;

-- Ensure existing studios default to basic tier
UPDATE studios
SET subscription_tier = 'basic'
WHERE subscription_tier IS NULL;

-- Customers: allow null email + add calendar invite & bounce tracking
ALTER TABLE customers
ALTER COLUMN email DROP NOT NULL;

ALTER TABLE customers
ADD COLUMN IF NOT EXISTS send_calendar_invites boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS email_bounced boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS email_bounce_reason text,
ADD COLUMN IF NOT EXISTS email_bounced_at timestamptz,
ADD COLUMN IF NOT EXISTS email_unsubscribed boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS email_unsubscribed_at timestamptz;

-- Appointments: email delivery status + reminder tracking
ALTER TABLE appointments
ADD COLUMN IF NOT EXISTS email_send_status text DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS email_send_failed_reason text,
ADD COLUMN IF NOT EXISTS email_sent_at timestamptz,
ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz,
ADD COLUMN IF NOT EXISTS reminder_minutes_before integer;

-- Email events audit table
CREATE TABLE IF NOT EXISTS email_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id uuid REFERENCES studios (id),
  customer_id uuid REFERENCES customers (id),
  appointment_id uuid REFERENCES appointments (id),
  email text NOT NULL,
  event_type text NOT NULL,
  reason text,
  occurred_at timestamptz DEFAULT now(),
  metadata jsonb
);

CREATE INDEX IF NOT EXISTS email_events_email_idx ON email_events (email);
CREATE INDEX IF NOT EXISTS email_events_appointment_idx ON email_events (appointment_id);
