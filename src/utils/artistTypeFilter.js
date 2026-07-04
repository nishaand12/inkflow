import { normalizeArtistType } from "./artistTypes";

export function isArtistTypeFilter(filter) {
  return filter.startsWith("type:");
}

export function getDistinctArtistTypes(artists) {
  const seen = [];
  for (const artist of artists || []) {
    const type = normalizeArtistType(artist.artist_type);
    if (!seen.includes(type)) seen.push(type);
  }
  return seen;
}

export function getArtistIdsForFilter(filter, activeArtists) {
  if (filter === "all") return null;
  if (isArtistTypeFilter(filter)) {
    const type = filter.slice("type:".length);
    return new Set(
      (activeArtists || [])
        .filter((artist) => normalizeArtistType(artist.artist_type) === type)
        .map((artist) => artist.id)
    );
  }
  return new Set([filter]);
}

export function appointmentMatchesArtistFilter(appointment, filter, activeArtists) {
  const ids = getArtistIdsForFilter(filter, activeArtists);
  if (!ids) return true;
  return ids.has(appointment.artist_id);
}
