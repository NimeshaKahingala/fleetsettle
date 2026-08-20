import { expect, test } from "vitest";
import { formatTimestamp } from "./formatTimestamp.js";

test("GAP-142: formats Postgres's own space-separated timestamptz text, not just strict ISO", () => {
  expect(formatTimestamp("2026-08-19 13:14:25.253818+00")).toBe("19 Aug 2026");
});

test("GAP-142: formats a strict ISO 8601 string the same way", () => {
  expect(formatTimestamp("2026-08-19T13:14:25.253Z")).toBe("19 Aug 2026");
});

test("GAP-142: never leaves the raw microsecond/offset text visible", () => {
  const formatted = formatTimestamp("2026-08-06 01:56:11.109882+00");
  expect(formatted).not.toContain("109882");
  expect(formatted).not.toContain("+00");
  expect(formatted).toBe("6 Aug 2026");
});

// The first version of the fix normalised the space but not the offset —
// `new Date()` returns Invalid Date for a bare `+00` (no `:00` minutes),
// which is exactly what Postgres emits for UTC, so this is the realistic
// case, not an edge case. Caught by this exact test failing loudly rather
// than by a live browser throwing mid-render.
test("GAP-142: a bare +00 offset (no minutes) — Postgres's own UTC form — does not throw or produce Invalid Date", () => {
  expect(formatTimestamp("2026-08-19 13:14:25.253818+00")).toBe("19 Aug 2026");
  expect(() => formatTimestamp("2026-08-19 13:14:25.253818+00")).not.toThrow();
});

// A naive trailing `/[+-]\d{2}$/` offset-fixup would also match a bare
// date's own `-DD` and corrupt it — this is a real shape this function
// receives (`PlatformAuditLogScreen`'s fixtures predate F-5's own fix).
test("GAP-142: a bare YYYY-MM-DD date is not mistaken for a timestamp with a broken offset", () => {
  expect(formatTimestamp("2026-08-01")).toBe("1 Aug 2026");
});

// Gitar review, PR #79: PlatformAuditLogScreen is the one caller where a
// bare calendar day loses something real — two admin actions on the same
// day are common, and their ordering is exactly what an audit log is for.
test("GAP-142: withTime adds hour/minute in the business timezone, still never the raw offset", () => {
  expect(formatTimestamp("2026-08-18T10:00:00.000Z", { withTime: true })).toBe(
    "18 Aug 2026, 15:30",
  );
});

test("GAP-142: withTime is opt-in — every other caller stays date-only by default", () => {
  expect(formatTimestamp("2026-08-18T10:00:00.000Z")).toBe("18 Aug 2026");
});
