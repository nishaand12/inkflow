-- Migration 6: Add service_cost to appointment_types
ALTER TABLE appointment_types
ADD COLUMN IF NOT EXISTS service_cost numeric;
