/**
 * Per-artist appointment type exclusions (denylist).
 * A row in artist_appointment_type_exclusions means the artist cannot be booked for that type.
 */

export function exclusionKey(artistId, appointmentTypeId) {
  return `${artistId}:${appointmentTypeId}`;
}

/** @param {Array<{ artist_id: string, appointment_type_id: string }>} exclusions */
export function buildExclusionKeySet(exclusions) {
  const keys = new Set();
  for (const row of exclusions || []) {
    if (row?.artist_id && row?.appointment_type_id) {
      keys.add(exclusionKey(row.artist_id, row.appointment_type_id));
    }
  }
  return keys;
}

export function canArtistBookAppointmentType(artistId, appointmentTypeId, exclusionKeys) {
  if (!artistId || !appointmentTypeId) return true;
  return !exclusionKeys.has(exclusionKey(artistId, appointmentTypeId));
}

export function filterArtistsForAppointmentType(
  artists,
  appointmentTypeId,
  exclusionKeys,
  { alwaysIncludeArtistId = null } = {}
) {
  if (!appointmentTypeId) return artists || [];
  return (artists || []).filter(
    (a) =>
      a?.id &&
      (a.id === alwaysIncludeArtistId ||
        canArtistBookAppointmentType(a.id, appointmentTypeId, exclusionKeys))
  );
}

export function filterAppointmentTypesForArtist(
  types,
  artistId,
  exclusionKeys,
  { alwaysIncludeTypeId = null } = {}
) {
  if (!artistId) return types || [];
  return (types || []).filter(
    (t) =>
      t?.id &&
      (t.id === alwaysIncludeTypeId ||
        canArtistBookAppointmentType(artistId, t.id, exclusionKeys))
  );
}

/** Count exclusions for a given artist. */
export function countExclusionsForArtist(artistId, exclusions) {
  return (exclusions || []).filter((e) => e.artist_id === artistId).length;
}

/** Count artists excluded from a given appointment type. */
export function countExclusionsForAppointmentType(appointmentTypeId, exclusions) {
  return (exclusions || []).filter((e) => e.appointment_type_id === appointmentTypeId).length;
}

/**
 * Collect appointment type IDs under a booking category (including descendant categories).
 * @param {string} categoryId
 * @param {Array} categories - reporting_categories with category_role appointment_kind
 * @param {Array} appointmentTypes
 */
export function getAppointmentTypeIdsInCategoryTree(categoryId, categories, appointmentTypes) {
  if (!categoryId) return [];

  const childrenByParent = new Map();
  for (const cat of categories || []) {
    const parentId = cat.parent_id || "";
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(cat.id);
  }

  const categoryIds = new Set();
  const stack = [categoryId];
  while (stack.length) {
    const id = stack.pop();
    if (categoryIds.has(id)) continue;
    categoryIds.add(id);
    for (const childId of childrenByParent.get(id) || []) {
      stack.push(childId);
    }
  }

  return (appointmentTypes || [])
    .filter((t) => t.appointment_kind_category_id && categoryIds.has(t.appointment_kind_category_id))
    .map((t) => t.id);
}
