-- Migration 8: Update get_public_booking_data to use end_time instead of duration_hours
-- Run this after migrate7_duration_minutes.sql

CREATE OR REPLACE FUNCTION public.get_public_booking_data(p_studio_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result json;
BEGIN
  SELECT json_build_object(
    'studio', (
      SELECT row_to_json(s)
      FROM studios s
      WHERE s.id = p_studio_id
    ),
    'locations', coalesce((
      SELECT json_agg(row_to_json(l))
      FROM locations l
      WHERE l.studio_id = p_studio_id AND l.is_active = true
    ), '[]'::json),
    'artists', coalesce((
      SELECT json_agg(row_to_json(a))
      FROM artists a
      WHERE a.studio_id = p_studio_id AND a.is_active = true
    ), '[]'::json),
    'appointment_types', coalesce((
      SELECT json_agg(row_to_json(at))
      FROM appointment_types at
      WHERE at.studio_id = p_studio_id AND at.is_active = true AND at.is_public_bookable = true
    ), '[]'::json),
    'availabilities', coalesce((
      SELECT json_agg(row_to_json(av))
      FROM availabilities av
      WHERE av.studio_id = p_studio_id
    ), '[]'::json),
    'weekly_schedules', coalesce((
      SELECT json_agg(row_to_json(ws))
      FROM artist_weekly_schedules ws
      WHERE ws.studio_id = p_studio_id AND ws.is_active = true
    ), '[]'::json),
    'appointments', coalesce((
      SELECT json_agg(row_to_json(ap))
      FROM (
        SELECT id, artist_id, location_id, appointment_date,
               start_time, end_time, work_station_id, status
        FROM appointments
        WHERE studio_id = p_studio_id
          AND status NOT IN ('cancelled', 'no_show')
      ) ap
    ), '[]'::json),
    'workstations', coalesce((
      SELECT json_agg(row_to_json(wst))
      FROM workstations wst
      WHERE wst.studio_id = p_studio_id AND wst.status = 'active'
    ), '[]'::json)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_booking_data(uuid) TO anon;
