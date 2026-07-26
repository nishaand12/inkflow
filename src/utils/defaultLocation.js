/**
 * Temporary single-client preferred default until studios can configure
 * a studio-level default_location_id in settings.
 */
export const PREFERRED_DEFAULT_LOCATION_NAME = "New Tribe Studio";

/** Active locations sorted by created_at ascending (stable fallback order). */
export function sortLocationsByCreatedAt(locationsList) {
  return [...(locationsList || [])].sort((a, b) =>
    String(a.created_at || "").localeCompare(String(b.created_at || ""))
  );
}

/**
 * Resolve the preferred default location id among active locations.
 * Prefers an active location named PREFERRED_DEFAULT_LOCATION_NAME
 * (case-insensitive), else the earliest active location by created_at.
 */
export function resolvePreferredDefaultLocationId(locations) {
  const activeSorted = sortLocationsByCreatedAt(
    (locations || []).filter((location) => location?.is_active)
  );
  if (activeSorted.length === 0) return "";

  const preferredName = PREFERRED_DEFAULT_LOCATION_NAME.trim().toLowerCase();
  const namedMatch = activeSorted.find(
    (location) => String(location.name || "").trim().toLowerCase() === preferredName
  );
  return (namedMatch || activeSorted[0]).id || "";
}
