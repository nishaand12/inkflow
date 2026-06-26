-- Migration 23: allow deleting appointments that have email event history
-- Keep email_events rows for audit, but detach appointment_id on delete.
ALTER TABLE email_events
DROP CONSTRAINT IF EXISTS email_events_appointment_id_fkey;

ALTER TABLE email_events
ADD CONSTRAINT email_events_appointment_id_fkey
FOREIGN KEY (appointment_id)
REFERENCES appointments(id)
ON DELETE SET NULL;
