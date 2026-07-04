/**
 * Shared work station selection helpers used by the internal calendar
 * (AppointmentDialog) and the public/self-service booking flows
 * (PublicBooking, ManageAppointment, bookingSlots). Kept here so all booking
 * surfaces default to the artist's preferred work station consistently.
 */

/**
 * Deterministic ordering used when no preferred station applies: oldest station
 * first (by created_at), then alphabetical by name.
 */
export function sortStationsForDefault(stations) {
  return [...stations].sort(
    (a, b) =>
      String(a.created_at || "").localeCompare(String(b.created_at || "")) ||
      String(a.name || "").localeCompare(String(b.name || ""))
  );
}

/**
 * Pick the work station id to default to from a set of available stations.
 * Prefers the artist's saved station when it is present in the available set;
 * otherwise falls back to the first station by the default ordering.
 *
 * @param {Array} availableStations - stations free for the slot/location
 * @param {string|null} [preferredWorkStationId] - artist's preferred station id
 * @returns {string} the chosen station id, or "" when none are available
 */
export function pickPreferredWorkStationId(availableStations, preferredWorkStationId = null) {
  const sorted = sortStationsForDefault(availableStations);
  if (
    preferredWorkStationId &&
    sorted.some((s) => s.id === preferredWorkStationId)
  ) {
    return preferredWorkStationId;
  }
  return sorted[0]?.id || "";
}
