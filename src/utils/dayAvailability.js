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

const DAY_START_MIN = 0;
const DAY_END_MIN = 24 * 60;

/** "HH:MM" → minutes since midnight. Defaults to 0 on bad input. */
function timeToMinutes(t) {
  const [h, m] = String(t || "0:0").split(":").map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/**
 * The time interval an Availability / WeeklySchedule row covers, in minutes.
 * All-day rows span the whole day. Returns null for a zero/invalid span.
 */
function rowInterval(row) {
  if (row.is_all_day) return { start: DAY_START_MIN, end: DAY_END_MIN };
  const start = timeToMinutes(row.start_time);
  const end = timeToMinutes(row.end_time);
  return end > start ? { start, end } : null;
}

/** Merge overlapping/adjacent intervals into a sorted, non-overlapping list. */
function mergeIntervals(intervals) {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged = [];
  for (const iv of sorted) {
    const last = merged[merged.length - 1];
    if (last && iv.start <= last.end) {
      last.end = Math.max(last.end, iv.end);
    } else {
      merged.push({ ...iv });
    }
  }
  return merged;
}

/** Subtract block intervals from base intervals; result is merged & sorted. */
function subtractIntervals(base, blocks) {
  const mergedBlocks = mergeIntervals(blocks);
  let result = mergeIntervals(base);
  for (const block of mergedBlocks) {
    const next = [];
    for (const iv of result) {
      if (block.end <= iv.start || block.start >= iv.end) {
        next.push(iv); // no overlap
        continue;
      }
      if (block.start > iv.start) next.push({ start: iv.start, end: block.start });
      if (block.end < iv.end) next.push({ start: block.end, end: iv.end });
    }
    result = next;
  }
  return result;
}

/** "HH:MM" for a minutes-since-midnight value (used to re-label consolidated ranges). */
function minutesToTime(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Availability chips for a single day, per artist.
 *
 * Precedence: explicit single-day Availability rows override that artist's
 * recurring weekly schedule for the day. Time-off (is_blocked rows) is then
 * subtracted from the resulting window(s):
 *   - fully blocked  → a single "OFF" chip
 *   - partially blocked → the remaining available range(s), consolidated
 *   - no underlying availability → no chip
 *
 * Sorted by artist name. Each chip:
 *   { id, artistId, firstName, artistName, range, color, isAllDay, isOff }.
 */
export function getAvailabilityChipsForDay(
  day,
  { availabilities, weeklySchedules, artists, artistColorMap, artistFilter } = {}
) {
  const dayAvails = getAvailForDay(day, availabilities, artistFilter);
  const dayWeekly = getWeeklyForDay(day, weeklySchedules, artistFilter);
  const findArtist = (id) => (artists || []).find((a) => a.id === id);
  const colorFor = (id) => (artistColorMap && artistColorMap[id]) || "#6366f1";

  // Group the day's rows by artist.
  const byArtist = new Map();
  const bucket = (artistId) => {
    if (!byArtist.has(artistId)) byArtist.set(artistId, { explicit: [], blocks: [], weekly: [] });
    return byArtist.get(artistId);
  };
  for (const avail of dayAvails) {
    bucket(avail.artist_id)[avail.is_blocked ? "blocks" : "explicit"].push(avail);
  }
  for (const ws of dayWeekly) {
    bucket(ws.artist_id).weekly.push(ws);
  }

  const chips = [];
  for (const [artistId, rows] of byArtist) {
    // Explicit single-day availability wins; otherwise fall back to weekly schedule.
    const baseRows = rows.explicit.length > 0 ? rows.explicit : rows.weekly;
    const base = baseRows.map(rowInterval).filter(Boolean);
    if (base.length === 0) continue; // artist isn't working this day

    const blocks = rows.blocks.map(rowInterval).filter(Boolean);
    const available = subtractIntervals(base, blocks);

    const fullName = findArtist(artistId)?.full_name || "Unknown";
    const common = {
      artistId,
      firstName: firstNameOf(fullName),
      artistName: fullName,
      color: colorFor(artistId),
    };

    if (available.length === 0) {
      chips.push({ ...common, id: `off-${artistId}`, range: "OFF", isAllDay: false, isOff: true });
      continue;
    }

    available.forEach((iv, i) => {
      const isAllDay = iv.start === DAY_START_MIN && iv.end === DAY_END_MIN;
      chips.push({
        ...common,
        id: `av-${artistId}-${i}`,
        range: isAllDay ? "All day" : formatCompactHourRange(minutesToTime(iv.start), minutesToTime(iv.end)),
        isAllDay,
        isOff: false,
      });
    });
  }

  chips.sort((a, b) => a.artistName.localeCompare(b.artistName));
  return chips;
}
