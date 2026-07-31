/**
 * The business date (IG §4.5).
 *
 * "Today" is the business timezone's today — never the device's, and never the
 * server's. `new Date().toISOString().slice(0, 10)` is the wrong answer for
 * five and a half hours of every day in Asia/Colombo, and it is wrong quietly:
 * the day card appears under yesterday, the confirmation lands in the wrong
 * period, and nothing errors.
 */

/** `YYYY-MM-DD` in the business timezone. Never a `Date` — a date has no time. */
export type BusinessDate = string & { readonly __businessDate: unique symbol };

export const BUSINESS_TIMEZONE = "Asia/Colombo";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `en-CA` because it formats as `YYYY-MM-DD`, which is the shape Postgres wants
 * and the only locale that gives it without reassembling parts by hand.
 */
const formatterFor = (timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = formatterFor(timeZone);
    formatters.set(timeZone, f);
  }
  return f;
}

export function asBusinessDate(value: string): BusinessDate {
  if (!ISO_DATE.test(value)) {
    throw new TypeError(`Not a business date: ${JSON.stringify(value)}`);
  }
  return value as BusinessDate;
}

/**
 * The business date for an instant. `at` is injected rather than read from the
 * clock so this stays a pure function — which is what makes the timezone bug
 * testable instead of only reproducible after 18:30 UTC.
 */
export function businessDateAt(at: Date, timeZone: string = BUSINESS_TIMEZONE): BusinessDate {
  return formatter(timeZone).format(at) as BusinessDate;
}

/** Today, in the business timezone. The only place the clock is read. */
export const businessToday = (timeZone: string = BUSINESS_TIMEZONE): BusinessDate =>
  // eslint-disable-next-line no-restricted-syntax -- the one clock read in the system; every other caller injects an instant
  businessDateAt(new Date(), timeZone);

const DAY_MS = 86_400_000;

/**
 * Days between two business dates, inclusive of both ends (W-54).
 * This is what makes 12 Jan – 11 Feb come out as 31 rather than 30.
 */
export function inclusiveDays(start: BusinessDate, end: BusinessDate): number {
  const ms = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
  // eslint-disable-next-line no-restricted-syntax -- day count, not money; both operands are UTC midnights so the division is exact
  return Math.trunc(ms / DAY_MS) + 1;
}

/**
 * Shift a business date by whole days. Both ends are anchored to UTC midnight,
 * so this is calendar arithmetic with no timezone in it — and it is formatted
 * through the UTC formatter rather than `toISOString().slice(0, 10)`, which is
 * the right answer here but the wrong habit to leave lying around.
 */
const utc = formatterFor("UTC");

export function addDays(date: BusinessDate, days: number): BusinessDate {
  const shifted = new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS);
  return utc.format(shifted) as BusinessDate;
}
