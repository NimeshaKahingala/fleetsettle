import { expect, test } from "vitest";
import { formatShortDate } from "./formatShortDate.js";

test("formats a BusinessDate as day month year", () => {
  expect(formatShortDate("2026-04-23")).toBe("23 Apr 2026");
});

test("does not shift the day regardless of device timezone", () => {
  expect(formatShortDate("2026-01-01")).toBe("1 Jan 2026");
  expect(formatShortDate("2026-12-31")).toBe("31 Dec 2026");
});
