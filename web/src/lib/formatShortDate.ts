/**
 * `BusinessDate` ("YYYY-MM-DD") → "23 Apr 2026". Parsed and formatted at UTC
 * midnight, matching `DateField.tsx`'s `formatWeekday` — a `BusinessDate` is
 * already a resolved calendar day, and anchoring to a fixed offset (rather
 * than the device's local time) is what stops that day from shifting across
 * a DST boundary or a UTC+ timezone at or after 24:00 minus the offset.
 */
const formatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function formatShortDate(date: string): string {
  return formatter.format(new Date(`${date}T00:00:00Z`));
}
