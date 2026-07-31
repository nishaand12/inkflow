import { getVisibleDays, getVisibleDateRange } from "./calendarViews";

// 2026-07-15 is a Wednesday.
const WEDNESDAY = new Date(2026, 6, 15);

describe("getVisibleDays", () => {
  it("returns the single anchor day for day view", () => {
    expect(getVisibleDays(WEDNESDAY, "day")).toEqual([WEDNESDAY]);
  });

  it("returns 3 and 4 day spans starting at the anchor", () => {
    expect(getVisibleDays(WEDNESDAY, "3day")).toHaveLength(3);
    expect(getVisibleDays(WEDNESDAY, "4day")).toHaveLength(4);
    expect(getVisibleDays(WEDNESDAY, "3day")[0]).toEqual(WEDNESDAY);
  });

  it("returns a full Sunday-anchored week", () => {
    const days = getVisibleDays(WEDNESDAY, "week");
    expect(days).toHaveLength(7);
    expect(days[0].getDay()).toBe(0);
  });

  it("pads the month out to whole weeks", () => {
    const days = getVisibleDays(WEDNESDAY, "month");
    expect(days.length % 7).toBe(0);
    expect(days[0].getDay()).toBe(0);
  });

  it("falls back to a single day for an unknown view", () => {
    expect(getVisibleDays(WEDNESDAY, "nonsense")).toEqual([WEDNESDAY]);
  });
});

describe("getVisibleDateRange", () => {
  it("collapses to one date for day view", () => {
    expect(getVisibleDateRange(WEDNESDAY, "day")).toEqual({
      startDate: "2026-07-15",
      endDate: "2026-07-15",
    });
  });

  it("spans the anchor day through the end of a 3-day view", () => {
    expect(getVisibleDateRange(WEDNESDAY, "3day")).toEqual({
      startDate: "2026-07-15",
      endDate: "2026-07-17",
    });
  });

  it("covers the surrounding week", () => {
    expect(getVisibleDateRange(WEDNESDAY, "week")).toEqual({
      startDate: "2026-07-12",
      endDate: "2026-07-18",
    });
  });

  it("covers the padded month grid, including adjacent-month days", () => {
    // July 2026 starts on a Wednesday, so the grid opens in late June.
    expect(getVisibleDateRange(WEDNESDAY, "month")).toEqual({
      startDate: "2026-06-28",
      endDate: "2026-08-01",
    });
  });

  it("always matches the first and last rendered day", () => {
    for (const view of ["day", "3day", "4day", "week", "month"]) {
      const days = getVisibleDays(WEDNESDAY, view);
      const { startDate, endDate } = getVisibleDateRange(WEDNESDAY, view);
      expect(startDate <= endDate).toBe(true);
      expect(days).toHaveLength(
        Math.round(
          (new Date(`${endDate}T00:00:00`) - new Date(`${startDate}T00:00:00`)) / 86400000
        ) + 1
      );
    }
  });
});
