// 20 visually distinct, saturated colors for artist calendar display
export const ARTIST_PALETTE = [
  '#4f46e5', // indigo
  '#db2777', // pink
  '#0d9488', // teal
  '#d97706', // amber
  '#059669', // emerald
  '#7c3aed', // violet
  '#ea580c', // orange
  '#0284c7', // sky
  '#65a30d', // lime
  '#dc2626', // red
  '#2563eb', // blue
  '#9333ea', // purple
  '#16a34a', // green
  '#ca8a04', // yellow
  '#e11d48', // rose
  '#0891b2', // cyan
  '#c026d3', // fuchsia
  '#0f766e', // teal-dark
  '#c2410c', // orange-dark
  '#475569', // slate
];

/**
 * Returns the calendar color for an artist.
 * Uses the artist's saved calendar_color if set, otherwise falls back
 * to a deterministic color from the palette based on the artist's index.
 */
export function getArtistColor(artist, fallbackIndex = 0) {
  return artist?.calendar_color || ARTIST_PALETTE[fallbackIndex % ARTIST_PALETTE.length];
}

/**
 * Returns the first palette color not already used by the given artists array.
 * Used when auto-assigning a color to a newly created artist.
 */
export function autoAssignColor(existingArtists = []) {
  const usedColors = new Set(existingArtists.map(a => a.calendar_color).filter(Boolean));
  return ARTIST_PALETTE.find(c => !usedColors.has(c)) ?? ARTIST_PALETTE[0];
}

/**
 * Converts a hex color string to an rgba() value with the given alpha (0–1).
 */
export function hexToRgba(hex, alpha) {
  if (!hex || hex.length < 7) return `rgba(79, 70, 229, ${alpha})`;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
