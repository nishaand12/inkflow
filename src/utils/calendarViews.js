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
