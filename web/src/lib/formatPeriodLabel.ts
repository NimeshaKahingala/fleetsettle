/**
 * An accounting period's `period_start` ("YYYY-MM-DD") → "August 2026" — the
 * W-35 late-fact flag's label (GAP-173, F-8.1: "reports for the open month
 * show the item flagged as belonging elsewhere").
 *
 * Parsed and formatted at UTC midnight for the same reason `formatShortDate`
 * is: a `period_start` is already a resolved calendar day, and anchoring to a
 * fixed offset rather than the device's local time is what stops it shifting
 * across a DST boundary or a UTC+ timezone at or after 24:00 minus the offset.
 * A period starting 1 August must never render as "July".
 *
 * The month is spelled in full rather than abbreviated: this reads inside a
 * sentence ("Belongs to August 2026"), not in a dense row of dates where
 * `formatShortDate`'s "23 Apr 2026" earns its abbreviation.
 */
const formatter = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function formatPeriodLabel(periodStart: string): string {
  return formatter.format(new Date(`${periodStart}T00:00:00Z`));
}
