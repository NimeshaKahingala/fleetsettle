import { BUSINESS_TIMEZONE } from "@fleetsettle/shared";

/**
 * GAP-142 (19 Aug 2026 live QA pass, F-5): the platform admin panel is the
 * first screen in this client to render a `timestamptz` column's raw wire
 * value at all — every other date in the app is a `BusinessDate`
 * (`YYYY-MM-DD`, written by application code) with no time component.
 * Three screens (`BusinessesListScreen`, `AdminManagementScreen`,
 * `PlatformAuditLogScreen`) were interpolating that raw value straight into
 * the page: Postgres's own `timestamp("…", { mode: "string" })` text form,
 * e.g. `"2026-08-19 13:14:25.253818+00"` — space-separated, microsecond
 * precision, a bare UTC offset — none of it converted to `Asia/Colombo`
 * (CLAUDE.md → Time) or run through any date formatter.
 *
 * `new Date()` does not accept this string as-is — confirmed directly
 * (Node/V8, the same engine both Chrome and this test suite run), not
 * assumed: the space instead of `T` is outside strict ISO 8601, and more
 * specifically **a bare `+00` offset (no `:00` minutes) makes `new Date()`
 * return Invalid Date outright**, which is exactly what Postgres emits for
 * UTC — `+05:30` parses fine, `+00` does not. Caught by this file's own
 * test suite before it ever reached a browser: the first version of this
 * fix normalised the space but not the offset, and threw "Invalid time
 * value" the moment a real `+00` timestamp rendered.
 *
 * The offset-only replace is anchored to the full `THH:MM:SS[.fraction]`
 * shape immediately before it — a naive trailing `/[+-]\d{2}$/` match would
 * also fire on a bare `YYYY-MM-DD` date's own `-DD`, which is a real
 * shape this function receives (some fixtures, and `PlatformAuditLogScreen`
 * predates any of this and may still send one).
 *
 * **`timeZone: BUSINESS_TIMEZONE` is not optional here.** The first version
 * of this fix omitted it — `Intl.DateTimeFormat` with no `timeZone` renders
 * in the *device's* zone, exactly the failure mode CLAUDE.md's Time section
 * names by name. Caught by this file's own tests, which run in `America/
 * Chicago` (UTC−5): a UTC timestamp in the small hours of a Colombo morning
 * lands the evening before in Chicago, moving the displayed calendar day —
 * `formatShortDate`'s sibling helpers get away without it only because they
 * format a plain `BusinessDate` (already day-only, constructed and
 * displayed in the same implied local time, so the two cancel out); this
 * function formats a real UTC-anchored instant, where they do not.
 */
const BARE_OFFSET = /(T\d{2}:\d{2}:\d{2}(?:\.\d+)?[+-]\d{2})$/;

/**
 * `withTime` (gitar-bot review, PR #79): `PlatformAuditLogScreen` is the one
 * caller where dropping to a bare calendar day loses something real — two
 * admin actions on the same day are common, and their ordering is exactly
 * what an audit log is for. `BusinessesListScreen`/`AdminManagementScreen`
 * stay date-only on purpose: a business's creation date or an admin grant's
 * start date has no comparable same-day-ordering need.
 */
export function formatTimestamp(raw: string, opts: { withTime?: boolean } = {}): string {
  const spaced = raw.includes("T") ? raw : raw.replace(" ", "T");
  const iso = spaced.replace(BARE_OFFSET, "$1:00");
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: BUSINESS_TIMEZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(opts.withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(new Date(iso));
}
