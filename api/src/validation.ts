import { businessToday, type BusinessDate } from "@fleetsettle/shared";
import type { Context } from "hono";
import { requireBusinessTimezone } from "./auth/context.js";
import { ValidationError } from "./errors/app-error.js";
import type { Env } from "./types.js";

/**
 * M-9, 31 Aug 2026. `businessDateSchema` validates shape (real YYYY-MM-DD,
 * a real calendar day — NL-1) but never an upper bound: nothing anywhere
 * refused a future `occurredOn`/`spentOn`/`issuedOn`/`paidOn`/`writtenOffOn`.
 * A year typo (2062 for 2026, one keypress on a phone) posted a real
 * payment outside every date-windowed report that would show it —
 * `sumVehicleEarnedForDateRange`, `sumVehicleCostsForDateRange`,
 * `listTransactionsForDateRange`, `sumGoodwillGiven` — while it still
 * counted in the period-keyed vehicle-month report, so the two report
 * families silently disagreed; in the ageing report it read as negative
 * days overdue, so it sat in "current" forever.
 *
 * A schema-level check cannot see "today" — that is a per-request fact
 * (the business's own timezone, `TS §5`), and `@hono/zod-openapi`'s route
 * schemas are bound once, at route-definition time, with no request in
 * scope yet. `positiveMoneyWireSchema`'s own shape (a `.refine` next to the
 * schema it guards) does not translate directly for that reason; this is
 * the same rule expressed as a handler-side check instead, called with the
 * one thing every handler can already reach: `requireBusinessTimezone(c)`.
 */
export function assertNotFutureBusinessDate(
  c: Context<Env>,
  date: BusinessDate,
  fieldName: string,
): void {
  const today = businessToday(requireBusinessTimezone(c));
  if (date > today) {
    throw new ValidationError(`${fieldName} cannot be in the future`);
  }
}
