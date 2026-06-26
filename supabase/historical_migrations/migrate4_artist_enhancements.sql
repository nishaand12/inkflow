-- Migration 4: Artist type, weekly schedules, and related enhancements
-- Run after migrate3_commerce.sql

-- Add artist_type to artists (tattoo, piercer, both)
ALTER TABLE artists ADD COLUMN IF NOT EXISTS artist_type TEXT NOT NULL DEFAULT 'tattoo';

-- Artist weekly recurring schedules (day_of_week: 0=Sunday .. 6=Saturday)
CREATE TABLE IF NOT EXISTS artist_weekly_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id UUID REFERENCES studios(id),
  artist_id UUID REFERENCES artists(id),
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  location_id UUID REFERENCES locations(id),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS artist_weekly_schedules_studio_idx ON artist_weekly_schedules(studio_id);
CREATE INDEX IF NOT EXISTS artist_weekly_schedules_artist_idx ON artist_weekly_schedules(artist_id);

CREATE TRIGGER set_artist_weekly_schedules_updated_at
BEFORE UPDATE ON artist_weekly_schedules
FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- RLS for artist_weekly_schedules
ALTER TABLE artist_weekly_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS aws_select ON artist_weekly_schedules;
CREATE POLICY aws_select ON artist_weekly_schedules
  FOR SELECT USING (
    studio_id IN (SELECT studio_id FROM users WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS aws_insert ON artist_weekly_schedules;
CREATE POLICY aws_insert ON artist_weekly_schedules
  FOR INSERT WITH CHECK (
    studio_id IN (SELECT studio_id FROM users WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS aws_update ON artist_weekly_schedules;
CREATE POLICY aws_update ON artist_weekly_schedules
  FOR UPDATE USING (
    studio_id IN (SELECT studio_id FROM users WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS aws_delete ON artist_weekly_schedules;
CREATE POLICY aws_delete ON artist_weekly_schedules
  FOR DELETE USING (
    studio_id IN (SELECT studio_id FROM users WHERE id = auth.uid())
  );

-- Anonymous read for public booking
DROP POLICY IF EXISTS aws_select_anon ON artist_weekly_schedules;
CREATE POLICY aws_select_anon ON artist_weekly_schedules
  FOR SELECT USING (is_active = true);
