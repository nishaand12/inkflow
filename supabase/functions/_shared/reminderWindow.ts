/**
 * Date window for the send-reminders sweep.
 *
 * Every reminder fires a bounded number of minutes before an appointment's
 * start, and every follow-up a bounded number of minutes after its end — so
 * only appointments inside the widest configured window can possibly need an
 * email. Fetching without a date bound instead selects a studio's entire
 * history, which the API silently truncates at its row cap once enough
 * history accumulates, dropping reminders with no error.
 */

/** Per-kind fallbacks mirrored from send-reminders' spec resolution. */
export const DEFAULT_BEFORE_MINUTES = [1440, 4320, 120];
export const DEFAULT_AFTER_MINUTES = [120, 30240, 108000];

const DAY_MINUTES = 24 * 60;

/** appointment_date is date-only; studios span timezones either side of UTC. */
const TIMEZONE_BUFFER_DAYS = 2;

/**
 * Sends are one-shot (stamped via *_sent_at), so lookback slack only has to
 * cover cron downtime before a due follow-up is picked back up.
 */
const OUTAGE_SLACK_DAYS = 14;

export type WindowConfigRow = {
  /** Configured minutes-before values (reminders). Nullish entries ignored. */
  before?: Array<number | null | undefined>;
  /** Configured minutes-after values (follow-ups). Nullish entries ignored. */
  after?: Array<number | null | undefined>;
};

export type ReminderWindow = {
  /** Inclusive yyyy-MM-dd lower bound for appointment_date. */
  fromDate: string;
  /** Inclusive yyyy-MM-dd upper bound for appointment_date. */
  toDate: string;
  lookbackDays: number;
  lookaheadDays: number;
};

export function computeReminderWindow(
  rows: WindowConfigRow[],
  now: Date,
): ReminderWindow {
  let maxBefore = Math.max(...DEFAULT_BEFORE_MINUTES);
  let maxAfter = Math.max(...DEFAULT_AFTER_MINUTES);

  for (const row of rows) {
    for (const value of row.before ?? []) {
      const minutes = Number(value);
      if (Number.isFinite(minutes) && minutes > maxBefore) maxBefore = minutes;
    }
    for (const value of row.after ?? []) {
      const minutes = Number(value);
      if (Number.isFinite(minutes) && minutes > maxAfter) maxAfter = minutes;
    }
  }

  const lookaheadDays = Math.ceil(maxBefore / DAY_MINUTES) + TIMEZONE_BUFFER_DAYS;
  const lookbackDays =
    Math.ceil(maxAfter / DAY_MINUTES) + OUTAGE_SLACK_DAYS + TIMEZONE_BUFFER_DAYS;

  return {
    fromDate: isoDate(addDays(now, -lookbackDays)),
    toDate: isoDate(addDays(now, lookaheadDays)),
    lookbackDays,
    lookaheadDays,
  };
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MINUTES * 60 * 1000);
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
