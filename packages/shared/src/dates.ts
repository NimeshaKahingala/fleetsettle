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

/**
 * Shift by whole calendar months, day-of-month preserved and clamped to the
 * target month's length (31 Jan + 1 month = 28/29 Feb, never rolling into
 * March). This is DM §6's billing-period arithmetic: a lease that starts on
 * the 12th keeps billing on the 12th every month (§7.3, W-40) — period N's
 * start is the anchor shifted by `N - 1` months, and its end is one day
 * before the anchor shifted by `N` months.
 */
export function addCalendarMonths(date: BusinessDate, months: number): BusinessDate {
  // eslint-disable-next-line no-restricted-syntax -- a calendar year, not money
  const year = Number(date.slice(0, 4));
  // eslint-disable-next-line no-restricted-syntax -- a calendar month index, not money
  const month = Number(date.slice(5, 7));
  // eslint-disable-next-line no-restricted-syntax -- a day-of-month, not money
  const day = Number(date.slice(8, 10));

  const targetMonthIndex0 = month - 1 + months;
  const lastDayOfTargetMonth = new Date(Date.UTC(year, targetMonthIndex0 + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDayOfTargetMonth);
  return utc.format(new Date(Date.UTC(year, targetMonthIndex0, clampedDay))) as BusinessDate;
}

/** 0 (Sunday) through 6 (Saturday), matching Postgres's own `EXTRACT(dow FROM ...)` (queries/reports.ts's UC-76). `getUTCDay` reads the UTC instant, not the device timezone — both ends of the string are already a UTC midnight, so there is no timezone question here at all. */
export function weekdayOf(date: BusinessDate): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** The first day of `date`'s calendar month (UC-08: the period a new business opens into). */
export function monthStart(date: BusinessDate): BusinessDate {
  return `${date.slice(0, 7)}-01` as BusinessDate;
}

/**
 * The last day of `date`'s calendar month — the arithmetic behind §7.3's
 * 31 / 28 / 31 / 30, done once here rather than reproduced at every call
 * site. Day 0 of the following month is the last day of this one; both ends
 * are UTC midnights, so there is no timezone in the subtraction.
 */
export function monthEnd(date: BusinessDate): BusinessDate {
  // eslint-disable-next-line no-restricted-syntax -- a calendar year, not money
  const year = Number(date.slice(0, 4));
  // eslint-disable-next-line no-restricted-syntax -- a calendar month, not money
  const month = Number(date.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${date.slice(0, 7)}-${String(lastDay).padStart(2, "0")}` as BusinessDate;
}
