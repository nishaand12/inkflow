import { eachDayOfInterval, max, min, parseISO } from "date-fns";

function timeToMinutes(t) {
  const [h, m] = String(t || "0:0").split(":").map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/** Inclusive day count of overlap between [rowStart,rowEnd] and [rangeStart,rangeEnd] as yyyy-MM-dd strings. */
export function countOverlappingDays(rowStartStr, rowEndStr, rangeStartStr, rangeEndStr) {
  const rs = parseISO(`${rowStartStr}T12:00:00`);
  const re = parseISO(`${rowEndStr}T12:00:00`);
  const bs = parseISO(`${rangeStartStr}T12:00:00`);
  const be = parseISO(`${rangeEndStr}T12:00:00`);
  const oStart = max([rs, bs]);
  const oEnd = min([re, be]);
  if (oStart > oEnd) return 0;
  return eachDayOfInterval({ start: oStart, end: oEnd }).length;
}

/** Hours represented by one availability row (same hours each day in the date span). */
export function hoursPerDayFromTimeRange(startTime, endTime) {
  const span = timeToMinutes(endTime) - timeToMinutes(startTime);
  return span > 0 ? span / 60 : 0;
}

/**
 * Sum hours from explicit calendar availability rows (availabilities table only), for a date range.
 * @param {Array<{ artist_id?: string, start_date: string, end_date: string, start_time: string, end_time: string, is_blocked?: boolean, location_id?: string | null }>} rows
 */
export function sumExplicitAvailableHoursInRange(rows, {
  rangeStartStr,
  rangeEndStr,
  filterLocationId,
} = {}) {
  let total = 0;
  for (const row of rows || []) {
    if (row.is_blocked) continue;
    if (filterLocationId && filterLocationId !== "all" && row.location_id && row.location_id !== filterLocationId) {
      continue;
    }
    const days = countOverlappingDays(row.start_date, row.end_date, rangeStartStr, rangeEndStr);
    if (days <= 0) continue;
    total += days * hoursPerDayFromTimeRange(row.start_time, row.end_time);
  }
  return total;
}
