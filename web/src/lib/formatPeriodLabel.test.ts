import { expect, test } from "vitest";
import { formatPeriodLabel } from "./formatPeriodLabel.js";

test("formats a period start as month and year", () => {
  expect(formatPeriodLabel("2026-08-01")).toBe("August 2026");
});

test("does not shift the month regardless of device timezone", () => {
  // The first of a month is the case that breaks under a device-local parse:
  // in any UTC- timezone `new Date("2026-08-01T00:00:00")` lands in July.
  expect(formatPeriodLabel("2026-08-01")).toBe("August 2026");
  expect(formatPeriodLabel("2026-01-01")).toBe("January 2026");
  expect(formatPeriodLabel("2026-12-01")).toBe("December 2026");
});

test("labels by the month the period starts in", () => {
  expect(formatPeriodLabel("2026-03-15")).toBe("March 2026");
});
