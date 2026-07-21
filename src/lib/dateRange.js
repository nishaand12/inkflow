/**
 * Keep a start/end date range ordered after a user picks one side.
 * Preserves the newly selected value and adjusts the other bound if needed.
 */
export function nextDateRange(which, value, startDate, endDate) {
  if (which === "start") {
    return {
      startDate: value,
      endDate: endDate && value > endDate ? value : endDate,
    };
  }
  return {
    startDate: startDate && value < startDate ? value : startDate,
    endDate: value,
  };
}
