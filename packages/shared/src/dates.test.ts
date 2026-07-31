import { describe, expect, it } from "vitest";
import { addDays, asBusinessDate, businessDateAt, inclusiveDays } from "./dates.js";

describe("the business date is Asia/Colombo's date", () => {
  it("is already tomorrow in Colombo while UTC still says today", () => {
    // Colombo is UTC+5:30, so from 18:30 UTC the two calendars disagree. This
    // is the bug: five and a half hours of every day, the naive answer is off
    // by one, and nothing errors — the day card just appears under yesterday.
    const instant = new Date("2026-07-30T20:00:00Z");

    expect(businessDateAt(instant)).toBe("2026-07-31");
    // eslint-disable-next-line no-restricted-syntax -- asserting that the banned pattern is wrong is the point of this test
    expect(instant.toISOString().slice(0, 10)).toBe("2026-07-30");
  });

  it("agrees with UTC during the other eighteen and a half hours", () => {
    const instant = new Date("2026-07-31T04:00:00Z");
    expect(businessDateAt(instant)).toBe("2026-07-31");
  });

  it("crosses the month boundary early, not late", () => {
    expect(businessDateAt(new Date("2026-07-31T19:00:00Z"))).toBe("2026-08-01");
  });

  it("is a different answer in a different timezone, which is the point", () => {
    const instant = new Date("2026-07-30T20:00:00Z");
    expect(businessDateAt(instant, "UTC")).toBe("2026-07-30");
    expect(businessDateAt(instant, "Asia/Colombo")).toBe("2026-07-31");
  });
});

describe("asBusinessDate", () => {
  it("rejects anything that is not YYYY-MM-DD", () => {
    for (const bad of ["31-07-2026", "2026-7-31", "2026-07-31T00:00:00Z", ""]) {
      expect(() => asBusinessDate(bad)).toThrow(TypeError);
    }
  });
});

describe("inclusiveDays — both ends counted (W-54)", () => {
  it("reproduces the §7.3 billing periods: 31, 28, 31, 30", () => {
    const periods: Array<[string, string, number]> = [
      ["2026-01-12", "2026-02-11", 31],
      ["2026-02-12", "2026-03-11", 28],
      ["2026-03-12", "2026-04-11", 31],
      ["2026-04-12", "2026-05-11", 30],
    ];
    for (const [start, end, days] of periods) {
      expect(inclusiveDays(asBusinessDate(start), asBusinessDate(end))).toBe(days);
    }
  });

  it("counts a single day as one, not zero", () => {
    expect(inclusiveDays(asBusinessDate("2026-07-31"), asBusinessDate("2026-07-31"))).toBe(1);
  });

  it("is unaffected by the leap year not being one", () => {
    // 2026 is not a leap year; February is 28 days. If this ever reads 29 the
    // §7.3 allowance of 2,800 moves and G-3 breaks.
    expect(inclusiveDays(asBusinessDate("2026-02-01"), asBusinessDate("2026-02-28"))).toBe(28);
  });
});

describe("addDays", () => {
  it("crosses months and years", () => {
    expect(addDays(asBusinessDate("2026-07-31"), 1)).toBe("2026-08-01");
    expect(addDays(asBusinessDate("2026-12-31"), 1)).toBe("2027-01-01");
    expect(addDays(asBusinessDate("2026-03-01"), -1)).toBe("2026-02-28");
  });

  it("round-trips with inclusiveDays", () => {
    const start = asBusinessDate("2026-01-12");
    const end = addDays(start, 30);
    expect(inclusiveDays(start, end)).toBe(31);
  });
});
