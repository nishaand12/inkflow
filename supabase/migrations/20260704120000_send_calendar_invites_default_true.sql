-- Default calendar invites to on for newly created customers.
ALTER TABLE customers
ALTER COLUMN send_calendar_invites SET DEFAULT true;
