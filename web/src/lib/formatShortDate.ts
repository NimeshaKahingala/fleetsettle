/**
 * `BusinessDate` ("YYYY-MM-DD") → "23 Apr 2026". No `timeZone` option: unlike
 * `formatTimestamp.ts` (a real UTC instant), a `BusinessDate` is already a
 * resolved calendar day — device and business timezone cancel out.
 */
export function formatShortDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00`));
}
