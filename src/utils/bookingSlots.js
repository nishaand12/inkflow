/**
 * Shared availability/slot computation for the public booking flow and the
 * customer self-service reschedule flow. Kept as pure functions so both
 * `PublicBooking` and `ManageAppointment` produce identical availability.
 */

import { pickPreferredWorkStationId } from "./workStationSelection";

export const timeToMinutes = (t) => {
  const [h, m] = String(t).split(":").map(Number);
  return h * 60 + m;
};

export const minutesToTime = (m) => {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
};

/**
 * Compute bookable slots for a single artist on a given date/location.
 *
 * @param {Object} params
 * @param {string} params.artistId
 * @param {string} params.date - yyyy-MM-dd
 * @param {number} params.durationMinutes
 * @param {string} params.locationId
 * @param {Array} params.availabilities - explicit availability/blocked windows
 * @param {Array} params.weeklySchedules - recurring weekly schedules
 * @param {Array} params.appointments - existing appointments (active only)
 * @param {Array} params.workStations - workstations for the studio
 * @param {string|null} [params.excludeAppointmentId] - appointment to ignore for
 *        conflict checks (used when rescheduling an existing appointment).
 * @param {string|null} [params.preferredWorkStationId] - artist's preferred work
 *        station; selected for each slot when it is free at the location.
 * @returns {Array<{ time: string, stationId: string|null, artistId: string }>}
 */
export function computeArtistSlots({
  artistId,
  date,
  durationMinutes,
  locationId,
  availabilities = [],
  weeklySchedules = [],
  appointments = [],
  workStations = [],
  excludeAppointmentId = null,
  preferredWorkStationId = null,
}) {
  if (!artistId || !locationId || !date || !durationMinutes) return [];

  // All-day blocked entries block the entire day — no slots available
  const hasAllDayBlock = availabilities.some(
    (a) =>
      a.artist_id === artistId &&
      a.is_blocked &&
      a.is_all_day &&
      date >= a.start_date &&
      date <= a.end_date &&
      (!a.location_id || a.location_id === locationId)
  );
  if (hasAllDayBlock) return [];

  const dateObj = new Date(date + "T00:00:00");
  const dayOfWeek = dateObj.getDay();

  const artistAvail = availabilities.filter((a) => {
    if (a.artist_id !== artistId) return false;
    if (a.is_blocked) return false;
    return date >= a.start_date && date <= a.end_date;
  });

  const weeklyAvail = weeklySchedules
    .filter((ws) => ws.artist_id === artistId && ws.day_of_week === dayOfWeek)
    .map((ws) => ({
      start_time: ws.start_time,
      end_time: ws.end_time,
      location_id: ws.location_id,
      _isWeekly: true,
    }));

  const combinedAvail = [...artistAvail, ...weeklyAvail];
  if (combinedAvail.length === 0) return [];

  const blockedSlots = availabilities.filter((a) => {
    if (a.artist_id !== artistId) return false;
    if (!a.is_blocked) return false;
    if (a.is_all_day) return false; // handled above as full-day block
    return date >= a.start_date && date <= a.end_date;
  });

  const dayAppointments = appointments.filter(
    (a) =>
      a.artist_id === artistId &&
      a.appointment_date === date &&
      (!excludeAppointmentId || a.id !== excludeAppointmentId)
  );

  const activeDayAppointments = dayAppointments.filter(
    (a) => a.status !== "cancelled" && a.status !== "no_show"
  );

  const hasAllDayAppointment = activeDayAppointments.some((a) => a.is_all_day);
  if (hasAllDayAppointment) return [];

  const timedDayAppointments = activeDayAppointments.filter((a) => !a.is_all_day);

  const locationStations = workStations.filter((ws) => ws.location_id === locationId);
  const slots = [];

  for (const avail of combinedAvail) {
    if (avail.location_id && avail.location_id !== locationId) continue;

    const availStart = timeToMinutes(avail.start_time);
    const availEnd = timeToMinutes(avail.end_time);

    for (let slotStart = availStart; slotStart + durationMinutes <= availEnd; slotStart += 30) {
      const slotEnd = slotStart + durationMinutes;

      const isBlocked = blockedSlots.some((b) => {
        const bs = timeToMinutes(b.start_time);
        const be = timeToMinutes(b.end_time);
        return slotStart < be && slotEnd > bs;
      });
      if (isBlocked) continue;

      const hasConflict = timedDayAppointments.some((apt) => {
        const as = timeToMinutes(apt.start_time);
        const ae = apt.end_time ? timeToMinutes(apt.end_time) : as + 60;
        return slotStart < ae && slotEnd > as;
      });
      if (hasConflict) continue;

      const occupiedStations = timedDayAppointments
        .filter((apt) => {
          if (apt.location_id !== locationId) return false;
          const as = timeToMinutes(apt.start_time);
          const ae = apt.end_time ? timeToMinutes(apt.end_time) : as + 60;
          return slotStart < ae && slotEnd > as;
        })
        .map((apt) => apt.work_station_id)
        .filter(Boolean);

      const freeStations = locationStations.filter(
        (ws) => !occupiedStations.includes(ws.id)
      );
      if (freeStations.length === 0 && locationStations.length > 0) continue;

      slots.push({
        time: minutesToTime(slotStart),
        stationId: pickPreferredWorkStationId(freeStations, preferredWorkStationId) || null,
        artistId,
      });
    }
  }
  return slots;
}

/**
 * Compute the merged set of available slots across many artists (used for the
 * "Any available artist" option). De-dupes by time, keeping the first artist
 * found for each slot.
 *
 * @param {Array} [params.artists] - artist rows used to resolve each artist's
 *        `preferred_work_station_id` for the slots they own.
 */
export function computeAnyArtistSlots({ artistIds = [], artists = [], ...rest }) {
  const allSlots = new Map();
  for (const artistId of artistIds) {
    const preferredWorkStationId =
      artists.find((a) => a.id === artistId)?.preferred_work_station_id || null;
    for (const slot of computeArtistSlots({ artistId, preferredWorkStationId, ...rest })) {
      if (!allSlots.has(slot.time)) {
        allSlots.set(slot.time, slot);
      }
    }
  }
  return Array.from(allSlots.values()).sort((a, b) => a.time.localeCompare(b.time));
}
