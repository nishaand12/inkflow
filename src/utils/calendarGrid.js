export const HOUR_HEIGHT = 240;
export const CALENDAR_SLOT_MINUTES = 5;
export const CALENDAR_APPOINTMENT_FONT_SIZE = 12;
export const SHORT_APPT_THRESHOLD_MINS = 20;
export const DEFAULT_CALENDAR_START_HOUR = 0;
export const DEFAULT_CALENDAR_END_HOUR = 24;

export function formatHourLabel(h) {
  if (h === 0 || h === 24) return "12 AM";
  if (h === 12) return "12 PM";
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

export function formatSlotLabel(hour, minute) {
  if (minute === 0) return formatHourLabel(hour);
  return `:${String(minute).padStart(2, "0")}`;
}

export function getTimeSlotsList(grid) {
  const slots = [];
  const totalMinutes = grid.gridHours * 60;

  for (let offset = 0; offset < totalMinutes; offset += CALENDAR_SLOT_MINUTES) {
    const hour = grid.startHour + Math.floor(offset / 60);
    const minute = offset % 60;
    slots.push({
      hour,
      minute,
      top: (offset / 60) * grid.hourHeight,
      isHour: minute === 0,
    });
  }

  return slots;
}

export function parseTimeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)?/i);
  if (!match) return 0;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3]?.toUpperCase();
  if (period === "PM" && hours !== 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

export function createCalendarGrid(startHour, endHour) {
  const start = Number.isFinite(startHour) ? startHour : DEFAULT_CALENDAR_START_HOUR;
  const end = Number.isFinite(endHour) ? endHour : DEFAULT_CALENDAR_END_HOUR;
  const safeStart = Math.max(0, Math.min(23, start));
  const safeEnd = Math.max(safeStart + 1, Math.min(24, end));
  const gridHours = safeEnd - safeStart;

  return {
    hourHeight: HOUR_HEIGHT,
    startHour: safeStart,
    endHour: safeEnd,
    gridHours,
    totalHeight: gridHours * HOUR_HEIGHT,
    hoursList: Array.from({ length: gridHours }, (_, i) => safeStart + i),
  };
}

export function topFromTime(timeStr, grid) {
  const mins = parseTimeToMinutes(timeStr);
  return Math.max(0, ((mins - grid.startHour * 60) / 60) * grid.hourHeight);
}

export function getAppointmentDurationMins(apt) {
  const start = parseTimeToMinutes(apt.start_time);
  return apt.end_time ? parseTimeToMinutes(apt.end_time) - start : 60;
}

/** Proportional height — short appointments render at true duration (no minimum floor). */
export function getAppointmentHeight(durationMins, grid) {
  return Math.max(1, (durationMins / 60) * grid.hourHeight - 1);
}

/** Typography never below CALENDAR_APPOINTMENT_FONT_SIZE (12px). */
export function getAppointmentBlockTypography(blockHeightPx) {
  const isCompact = blockHeightPx < 28;

  return {
    fontSize: CALENDAR_APPOINTMENT_FONT_SIZE,
    paddingTop: isCompact ? 2 : 4,
    paddingX: isCompact ? 2 : 4,
    lineHeight: 1,
    iconSize: isCompact ? 10 : 12,
  };
}

export function getNowLineTop(now, grid) {
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const gridStartMins = grid.startHour * 60;
  const gridEndMins = grid.endHour * 60;
  if (nowMinutes < gridStartMins || nowMinutes > gridEndMins) return null;
  return ((nowMinutes - gridStartMins) / 60) * grid.hourHeight;
}

export function getInitialScrollTop(grid, containerHeight) {
  const now = new Date();
  const nowTop = getNowLineTop(now, grid);
  if (nowTop != null) {
    return Math.max(0, Math.min(nowTop - containerHeight / 2, grid.totalHeight - containerHeight));
  }
  return 0;
}

/** Scroll the app main content area so the grid's current-time row is in view. */
export function scrollMainContentToGridTime(gridSectionEl, grid) {
  if (!gridSectionEl) return;
  const scrollParent = gridSectionEl.closest(".overflow-auto");
  if (!scrollParent) return;

  const nowTop = getNowLineTop(new Date(), grid);
  const parentRect = scrollParent.getBoundingClientRect();
  const gridRect = gridSectionEl.getBoundingClientRect();
  const gridOffsetInParent = gridRect.top - parentRect.top + scrollParent.scrollTop;

  if (nowTop != null) {
    scrollParent.scrollTop = Math.max(
      0,
      Math.min(
        gridOffsetInParent + nowTop - scrollParent.clientHeight / 2,
        scrollParent.scrollHeight - scrollParent.clientHeight
      )
    );
  } else {
    scrollParent.scrollTop = Math.max(0, gridOffsetInParent);
  }
}

export const CALENDAR_HOUR_OPTIONS = Array.from({ length: 25 }, (_, h) => ({
  value: h,
  label: h === 24 ? "12 AM (midnight end)" : formatHourLabel(h),
}));
