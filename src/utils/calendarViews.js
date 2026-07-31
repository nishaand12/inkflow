import {
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
  addDays,
  subDays,
  format,
} from "date-fns";

/**
 * Returns the array of days to render for a given view and anchor date.
 */
export function getDaysToShow(currentDate, view) {
  switch (view) {
    case "month": {
      const start = startOfWeek(startOfMonth(currentDate));
      const end = endOfWeek(endOfMonth(currentDate));
      return eachDayOfInterval({ start, end });
    }
    case "week": {
      const start = startOfWeek(currentDate);
      const end = endOfWeek(currentDate);
      return eachDayOfInterval({ start, end });
    }
    case "day":
    default:
      return [currentDate];
  }
}

/**
 * Days rendered by the studio calendar for a view. Unlike getDaysToShow this
 * also covers the multi-day views, so it can back both rendering and querying.
 */
export function getVisibleDays(currentDate, view) {
  switch (view) {
    case "month": {
      const start = startOfWeek(startOfMonth(currentDate));
      const end = endOfWeek(endOfMonth(currentDate));
      return eachDayOfInterval({ start, end });
    }
    case "week": {
      const start = startOfWeek(currentDate);
      const end = endOfWeek(currentDate);
      return eachDayOfInterval({ start, end });
    }
    case "3day":
      return eachDayOfInterval({ start: currentDate, end: addDays(currentDate, 2) });
    case "4day":
      return eachDayOfInterval({ start: currentDate, end: addDays(currentDate, 3) });
    case "day":
    default:
      return [currentDate];
  }
}

/**
 * Inclusive yyyy-MM-dd bounds of the visible window. Appointment queries are
 * scoped to this range so a studio's whole history is never fetched at once —
 * an unscoped select is silently truncated by the PostgREST row cap, which
 * makes appointments appear to vanish.
 */
export function getVisibleDateRange(currentDate, view) {
  const days = getVisibleDays(currentDate, view);
  return {
    startDate: format(days[0], "yyyy-MM-dd"),
    endDate: format(days[days.length - 1], "yyyy-MM-dd"),
  };
}

/**
 * Navigate forward by the appropriate amount for the active view.
 */
export function navigateNext(currentDate, view) {
  switch (view) {
    case "month":
      return addMonths(currentDate, 1);
    case "week":
      return addWeeks(currentDate, 1);
    case "day":
    default:
      return addDays(currentDate, 1);
  }
}

/**
 * Navigate backward by the appropriate amount for the active view.
 */
export function navigatePrev(currentDate, view) {
  switch (view) {
    case "month":
      return subMonths(currentDate, 1);
    case "week":
      return subWeeks(currentDate, 1);
    case "day":
    default:
      return subDays(currentDate, 1);
  }
}

/**
 * Map a picked calendar date to the anchor date for the active view.
 */
export function resolveCalendarJumpDate(selectedDate, view) {
  switch (view) {
    case "month":
      return startOfMonth(selectedDate);
    case "week":
    case "3day":
    case "4day":
    case "day":
    default:
      return selectedDate;
  }
}

/**
 * Returns a human-readable title string for the current view/date.
 */
export function getViewTitle(currentDate, view) {
  switch (view) {
    case "month":
      return format(currentDate, "MMMM yyyy");
    case "week": {
      const start = startOfWeek(currentDate);
      const end = endOfWeek(currentDate);
      const sameMonth = start.getMonth() === end.getMonth();
      if (sameMonth) {
        return `${format(start, "MMM d")} – ${format(end, "d, yyyy")}`;
      }
      return `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`;
    }
    case "day":
    default:
      return format(currentDate, "EEEE, MMMM d, yyyy");
  }
}
