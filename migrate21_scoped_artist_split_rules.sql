-- Migration 21: support appointment-level and appointment+artist split overrides
ALTER TABLE artist_split_rules
ADD COLUMN IF NOT EXISTS appointment_type_id uuid references appointment_types (id) on delete cascade;

-- Existing rows remain valid artist-level defaults (appointment_type_id stays null).
-- Deactivate duplicate active artist defaults so new partial unique indexes can be applied.
WITH ranked_artist_defaults AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY studio_id, artist_id
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM artist_split_rules
  WHERE is_active = true
    AND artist_id IS NOT NULL
    AND appointment_type_id IS NULL
)
UPDATE artist_split_rules r
SET is_active = false
FROM ranked_artist_defaults d
WHERE r.id = d.id
  AND d.rn > 1;

-- Deactivate duplicate active appointment defaults.
WITH ranked_appointment_defaults AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY studio_id, appointment_type_id
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM artist_split_rules
  WHERE is_active = true
    AND appointment_type_id IS NOT NULL
    AND artist_id IS NULL
)
UPDATE artist_split_rules r
SET is_active = false
FROM ranked_appointment_defaults d
WHERE r.id = d.id
  AND d.rn > 1;

-- Deactivate duplicate active appointment+artist overrides.
WITH ranked_appointment_artist_overrides AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY studio_id, appointment_type_id, artist_id
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM artist_split_rules
  WHERE is_active = true
    AND appointment_type_id IS NOT NULL
    AND artist_id IS NOT NULL
)
UPDATE artist_split_rules r
SET is_active = false
FROM ranked_appointment_artist_overrides d
WHERE r.id = d.id
  AND d.rn > 1;

ALTER TABLE artist_split_rules
DROP CONSTRAINT IF EXISTS artist_split_rules_scope_check;

ALTER TABLE artist_split_rules
ADD CONSTRAINT artist_split_rules_scope_check
CHECK (artist_id IS NOT NULL OR appointment_type_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS artist_split_rules_appointment_type_idx
ON artist_split_rules(appointment_type_id);

CREATE UNIQUE INDEX IF NOT EXISTS artist_split_rules_artist_default_unique_idx
ON artist_split_rules(studio_id, artist_id)
WHERE is_active = true
  AND artist_id IS NOT NULL
  AND appointment_type_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS artist_split_rules_appointment_default_unique_idx
ON artist_split_rules(studio_id, appointment_type_id)
WHERE is_active = true
  AND appointment_type_id IS NOT NULL
  AND artist_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS artist_split_rules_appointment_artist_unique_idx
ON artist_split_rules(studio_id, appointment_type_id, artist_id)
WHERE is_active = true
  AND appointment_type_id IS NOT NULL
  AND artist_id IS NOT NULL;
