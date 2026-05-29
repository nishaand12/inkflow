-- Migration 20: Optional image URL for appointment types (shown on public booking)
ALTER TABLE appointment_types
ADD COLUMN IF NOT EXISTS image_url text;
