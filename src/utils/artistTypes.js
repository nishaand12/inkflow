/** Values stored on `artists.artist_type`. Bookable = can be assigned client appointments (internal + online). */
export const ARTIST_TYPES = {
  TATTOO: "tattoo",
  PIERCER: "piercer",
  COUNTER: "counter",
  SCRUB: "scrub",
};

const BOOKABLE = new Set([ARTIST_TYPES.TATTOO, ARTIST_TYPES.PIERCER]);

/** @deprecated Legacy value; migrated to tattoo in migrate19. */
const LEGACY_BOTH = "both";

export function isBookableArtistType(artistType) {
  const t = artistType || ARTIST_TYPES.TATTOO;
  if (t === LEGACY_BOTH) return true;
  return BOOKABLE.has(t);
}

/** Public piercing flow only lists piercers. */
export function isPublicPiercingBookableArtistType(artistType) {
  const t = artistType || ARTIST_TYPES.TATTOO;
  if (t === LEGACY_BOTH) return true;
  return t === ARTIST_TYPES.PIERCER;
}

export function isSupportStaffArtistType(artistType) {
  const t = artistType || ARTIST_TYPES.TATTOO;
  return t === ARTIST_TYPES.COUNTER || t === ARTIST_TYPES.SCRUB;
}

export function getArtistTypeLabel(artistType) {
  switch (artistType) {
    case ARTIST_TYPES.PIERCER:
      return "Piercer";
    case ARTIST_TYPES.COUNTER:
      return "Counter";
    case ARTIST_TYPES.SCRUB:
      return "Scrub";
    case LEGACY_BOTH:
      return "Tattoo & Piercer (legacy)";
    default:
      return "Tattoo Artist";
  }
}

/** Group label for filtering by type, e.g. "All Piercers". */
export function getArtistTypeGroupLabel(artistType) {
  switch (artistType) {
    case ARTIST_TYPES.PIERCER:
      return "All Piercers";
    case ARTIST_TYPES.TATTOO:
      return "All Tattoo Artists";
    default:
      return `All ${getArtistTypeLabel(artistType)}s`;
  }
}

/** Normalized type for grouping; null/legacy values fold into tattoo. */
export function normalizeArtistType(artistType) {
  const t = artistType || ARTIST_TYPES.TATTOO;
  return t === LEGACY_BOTH ? ARTIST_TYPES.TATTOO : t;
}

/**
 * @param {Array<{ id?: string, artist_type?: string }>} artists
 * @param {{ alwaysIncludeArtistId?: string | null }} [opts]
 */
export function filterArtistsSelectableForBooking(artists, opts = {}) {
  const keepId = opts.alwaysIncludeArtistId || null;
  return (artists || []).filter(
    (a) => isBookableArtistType(a?.artist_type) || (keepId && a.id === keepId)
  );
}
