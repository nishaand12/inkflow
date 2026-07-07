import { isWithinInterval, parseISO, startOfDay } from "date-fns";

/**
 * Explicit availability rows (Availability entity) that cover the given day.
 * Normalizes `day` to local midnight so single-day entries (start_date === end_date)
 * still match when `day` carries a wall-clock time.
 */
export function getAvailForDay(day, availabilities, artistFilter) {
  const target = startOfDay(day);
  return (availabilities || []).filter((avail) => {
    if (artistFilter && artistFilter !== "all" && avail.artist_id !== artistFilter) return false;
    const startDate = parseISO(avail.start_date + "T00:00:00");
    const endDate = parseISO(avail.end_date + "T00:00:00");
    return isWithinInterval(target, { start: startDate, end: endDate });
  });
}

/** Recurring weekly schedule rows that apply to the given day of week. */
export function getWeeklyForDay(day, weeklySchedules, artistFilter) {
  const dow = day.getDay();
  return (weeklySchedules || []).filter((ws) => {
    if (!ws.is_active) return false;
    if (artistFilter && artistFilter !== "all" && ws.artist_id !== artistFilter) return false;
    return ws.day_of_week === dow;
  });
}

/** First word of a name, e.g. "Kaay Smith" → "Kaay". */
export function firstNameOf(fullName) {
  return String(fullName || "").trim().split(/\s+/)[0] || "Unknown";
}

/**
 * Compact hour label for availability chips: 24h "HH:MM" → 12h without period,
 * dropping ":00" minutes. "12:00" → "12", "19:00" → "7", "15:30" → "3:30".
 */
export function formatCompactHour(timeStr) {
  if (timeStr == null || timeStr === "") return "";
  const parts = String(timeStr).trim().split(":");
  let h = parseInt(parts[0], 10);
  const min = parseInt(parts[1] || "0", 10);
  if (!Number.isFinite(h)) return String(timeStr);
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return Number.isFinite(min) && min > 0 ? `${h12}:${String(min).padStart(2, "0")}` : `${h12}`;
}

/** Compact hour range, e.g. "12-7" or "3:30-7". */
export function formatCompactHourRange(startStr, endStr) {
  const start = formatCompactHour(startStr);
  const end = formatCompactHour(endStr);
  if (start && end) return `${start}-${end}`;
  return start || end || "";
}

/**
 * Availability chips for a single day, merging explicit availability rows and
 * recurring weekly schedules. Blocked / day-off rows are excluded. Sorted by
 * artist name. Each chip: { id, artistId, firstName, artistName, range, color, isAllDay }.
 */
export function getAvailabilityChipsForDay(
  day,
  { availabilities, weeklySchedules, artists, artistColorMap, artistFilter } = {}
) {
  const dayAvails = getAvailForDay(day, availabilities, artistFilter);
  const dayWeekly = getWeeklyForDay(day, weeklySchedules, artistFilter);
  const findArtist = (id) => (artists || []).find((a) => a.id === id);
  const colorFor = (id) => (artistColorMap && artistColorMap[id]) || "#6366f1";
  const chips = [];

  for (const avail of dayAvails) {
    if (avail.is_blocked) continue;
    const artist = findArtist(avail.artist_id);
    const fullName = artist?.full_name || "Unknown";
    chips.push({
      id: `av-${avail.id}`,
      artistId: avail.artist_id,
      firstName: firstNameOf(fullName),
      artistName: fullName,
      range: avail.is_all_day ? "All day" : formatCompactHourRange(avail.start_time, avail.end_time),
      color: colorFor(avail.artist_id),
      isAllDay: !!avail.is_all_day,
    });
  }

  for (const ws of dayWeekly) {
    const artist = findArtist(ws.artist_id);
    const fullName = artist?.full_name || "Unknown";
    chips.push({
      id: `ws-${ws.id}`,
      artistId: ws.artist_id,
      firstName: firstNameOf(fullName),
      artistName: fullName,
      range: formatCompactHourRange(ws.start_time, ws.end_time),
      color: colorFor(ws.artist_id),
      isAllDay: false,
    });
  }

  chips.sort((a, b) => a.artistName.localeCompare(b.artistName));
  return chips;
}
