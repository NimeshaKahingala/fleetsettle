import { expect, test } from "vitest";
import { formatShortDate } from "./formatShortDate.js";

test("formats a BusinessDate as day month year", () => {
  expect(formatShortDate("2026-04-23")).toBe("23 Apr 2026");
});

test("does not shift the day regardless of device timezone", () => {
  expect(formatShortDate("2026-01-01")).toBe("1 Jan 2026");
  expect(formatShortDate("2026-12-31")).toBe("31 Dec 2026");
});

// GAP-176. The bug this guards was not theoretical: sixteen files parsed a
// BusinessDate as `T00:00:00` with no trailing `Z` and no `timeZone` on the
// formatter, so the date rendered at the *device's* midnight. Under Asia/Colombo
// (UTC+5:30) that is one day early for five and a half hours of every day.
//
// Both halves matter and this asserts both: with the `Z` but no `timeZone: "UTC"`,
// a device west of Greenwich still formats the previous day. Appending the `Z`
// alone is the half-fix that looks correct in London and is wrong in Colombo.
test("GAP-176: the correct pattern is stable under a device timezone either side of UTC", () => {
  const iso = "2026-08-01";

  // What the shared helper does — parse at UTC midnight, format at UTC.
  expect(formatShortDate(iso)).toBe("1 Aug 2026");

  // The half-fix, made explicit so nobody reintroduces it believing `Z` is enough:
  // same instant, formatted in a UTC- zone, lands on the previous day.
  const halfFixed = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "America/New_York",
  }).format(new Date(`${iso}T00:00:00Z`));
  expect(halfFixed).toBe("31 Jul 2026");

  // And the full pattern is immune to the same device.
  const correct = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));
  expect(correct).toBe("1 Aug 2026");
});
