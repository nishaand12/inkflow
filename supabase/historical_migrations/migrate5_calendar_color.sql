-- Migration 5: Add calendar_color to artists
ALTER TABLE artists
ADD COLUMN IF NOT EXISTS calendar_color TEXT;
