import {
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { computeReminderWindow } from "./reminderWindow.ts";

const NOW = new Date("2026-07-15T12:00:00Z");

Deno.test("defaults: 75-day midterm follow-up dominates lookback, 3-day secondary reminder dominates lookahead", () => {
  const window = computeReminderWindow([], NOW);
  // ceil(108000 / 1440) = 75, + 14 outage slack + 2 tz buffer
  assertEquals(window.lookbackDays, 91);
  // ceil(4320 / 1440) = 3, + 2 tz buffer
  assertEquals(window.lookaheadDays, 5);
  assertEquals(window.fromDate, "2026-04-15");
  assertEquals(window.toDate, "2026-07-20");
});

Deno.test("a longer configured follow-up widens the lookback", () => {
  const window = computeReminderWindow(
    [{ after: [180 * 24 * 60] }], // 180-day follow-up
    NOW,
  );
  assertEquals(window.lookbackDays, 180 + 14 + 2);
});

Deno.test("a longer configured reminder widens the lookahead", () => {
  const window = computeReminderWindow(
    [{ before: [14 * 24 * 60] }], // 14-day reminder
    NOW,
  );
  assertEquals(window.lookaheadDays, 14 + 2);
});

Deno.test("nullish and non-numeric config values are ignored", () => {
  const window = computeReminderWindow(
    [
      { before: [null, undefined, Number.NaN], after: [null] },
      { before: [], after: [undefined] },
    ],
    NOW,
  );
  assertEquals(window.lookbackDays, 91);
  assertEquals(window.lookaheadDays, 5);
});

Deno.test("smaller configured values never shrink the window below defaults", () => {
  const window = computeReminderWindow(
    [{ before: [60], after: [60] }],
    NOW,
  );
  assertEquals(window.lookbackDays, 91);
  assertEquals(window.lookaheadDays, 5);
});
