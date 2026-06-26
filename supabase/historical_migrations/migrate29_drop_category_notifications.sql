-- Migration 29: Remove the legacy per-category notification override system.
-- Going forward, notifications are driven only by:
--   1. Studio default templates (the `studios` table columns / "Default Emails" tab)
--   2. Notification profiles + kind assignments (studio_notification_profiles + assignments)
--
-- The `appointment_kind_notification_settings` table is now redundant. Any studio that
-- relied on per-category overrides should recreate the equivalent behavior as a
-- notification profile assigned to the relevant appointment-kind category.
--
-- This migration is destructive: it drops the table and all of its override rows.
-- Run a backup first if you need to preserve historical override configurations.

drop table if exists public.appointment_kind_notification_settings cascade;
