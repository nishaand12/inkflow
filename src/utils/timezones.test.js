import { todayInTimezone } from "./timezones";

describe("todayInTimezone", () => {
  it("returns yyyy-MM-dd", () => {
    const value = todayInTimezone("America/Toronto", new Date("2026-07-31T16:00:00Z"));
    expect(value).toBe("2026-07-31");
  });

  it("uses the studio's day, not UTC's, late in the evening", () => {
    // 01:30 UTC on Aug 1 is still July 31 in Toronto — the register must show
    // the studio's business day, not the browser's or UTC's.
    const instant = new Date("2026-08-01T01:30:00Z");
    expect(todayInTimezone("America/Toronto", instant)).toBe("2026-07-31");
    expect(todayInTimezone("UTC", instant)).toBe("2026-08-01");
  });

  it("handles a timezone ahead of UTC", () => {
    const instant = new Date("2026-07-31T23:30:00Z");
    expect(todayInTimezone("Australia/Sydney", instant)).toBe("2026-08-01");
  });

  it("falls back to the device date for an unknown timezone", () => {
    expect(() => todayInTimezone("Not/AZone", new Date("2026-07-31T16:00:00Z"))).not.toThrow();
    expect(todayInTimezone("Not/AZone", new Date("2026-07-31T16:00:00Z"))).toMatch(
      /^\d{4}-\d{2}-\d{2}$/
    );
  });

  it("defaults to UTC when no timezone is given", () => {
    expect(todayInTimezone(null, new Date("2026-08-01T01:30:00Z"))).toBe("2026-08-01");
  });
});
