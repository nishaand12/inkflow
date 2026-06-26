-- Migrate legacy "both" artist type to tattoo; new types: counter, scrub (non-bookable support roles).
UPDATE public.artists SET artist_type = 'tattoo' WHERE artist_type = 'both';
