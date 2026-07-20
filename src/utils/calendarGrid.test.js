import {
  CALENDAR_SLOT_MINUTES,
  createCalendarGrid,
  timeFromTop,
  topFromTime,
} from "./calendarGrid";

describe("timeFromTop", () => {
  const grid = createCalendarGrid(9, 17);

  it("floors to the 5-minute slot under the cursor", () => {
    // 10:00 is 1 hour below 9:00 → y = hourHeight
    expect(timeFromTop(grid.hourHeight, grid)).toBe("10:00");

    // Just into the 10:07–10:11 band should still floor to 10:05
    const y1005 = topFromTime("10:05", grid);
    const y1007 = y1005 + (2 / 60) * grid.hourHeight;
    expect(timeFromTop(y1007, grid)).toBe("10:05");
  });

  it("uses calendar 5-minute increments", () => {
    expect(CALENDAR_SLOT_MINUTES).toBe(5);
    expect(timeFromTop(0, grid)).toBe("09:00");
  });

  it("maps the top of a slot back to the same time via topFromTime", () => {
    expect(timeFromTop(topFromTime("14:35", grid), grid)).toBe("14:35");
  });
});
