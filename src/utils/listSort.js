/** Stable sort helpers so list order does not change when unrelated fields (e.g. updated_at) change. */

function compareIdStrings(a, b) {
  return String(a ?? "").localeCompare(String(b ?? ""));
}

/** Parse "h:mm AM/PM" or 24h-style fragments; aligns with Calendar grid parsing. */
export function parseTimeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const match = String(timeStr).match(/(\d+):(\d+)\s*(AM|PM)?/i);
  if (!match) return 0;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3]?.toUpperCase();
  if (period === "PM" && hours !== 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

export function compareAppointmentsBySchedule(a, b) {
  const sa = parseTimeToMinutes(a?.start_time);
  const sb = parseTimeToMinutes(b?.start_time);
  if (sa !== sb) return sa - sb;
  const ea = a?.end_time ? parseTimeToMinutes(a.end_time) : sa + 60;
  const eb = b?.end_time ? parseTimeToMinutes(b.end_time) : sb + 60;
  if (ea !== eb) return ea - eb;
  return compareIdStrings(a?.id, b?.id);
}

export function compareAppointmentsByDateTimeAsc(a, b) {
  const d = (a?.appointment_date || "").localeCompare(b?.appointment_date || "");
  if (d !== 0) return d;
  return compareAppointmentsBySchedule(a, b);
}

/** Newest calendar day first; within a day, later start times first; then id descending. */
export function compareAppointmentsByDateTimeDesc(a, b) {
  const d = (b?.appointment_date || "").localeCompare(a?.appointment_date || "");
  if (d !== 0) return d;
  const sa = parseTimeToMinutes(a?.start_time);
  const sb = parseTimeToMinutes(b?.start_time);
  if (sa !== sb) return sb - sa;
  return compareIdStrings(b?.id, a?.id);
}

export function sortAppointmentsForCalendarDay(items) {
  return [...items].sort(compareAppointmentsBySchedule);
}

export function sortByLocaleThenId(items, getLabel) {
  return [...items].sort((a, b) => {
    const la = (getLabel(a) ?? "").toString();
    const lb = (getLabel(b) ?? "").toString();
    const c = la.localeCompare(lb);
    if (c !== 0) return c;
    return compareIdStrings(a?.id, b?.id);
  });
}

export function sortByNameThenId(items, nameKey = "name") {
  return sortByLocaleThenId(items, (x) => x?.[nameKey]);
}

export function sortByFullNameThenId(items) {
  return sortByLocaleThenId(items, (x) => x?.full_name);
}
