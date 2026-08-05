import { z } from "zod";

export const accountingPeriodSummarySchema = z.object({
  id: z.string().uuid(),
  periodStart: z.string(),
  periodEnd: z.string(),
});

/** F-9.1 step 1/UC-98: warns and lists, never blocks (U-7). Counts only — see `queries/accounting-period.ts`'s own doc comment for exactly what each one scopes to and why "unconfirmed days" isn't one of them yet. */
export const closeChecklistSchema = z.object({
  // eslint-disable-next-line no-restricted-syntax -- a row count for a warn-only checklist, not money
  openTrips: z.number().int().nonnegative(),
  // eslint-disable-next-line no-restricted-syntax -- a row count for a warn-only checklist, not money
  unreconciledAdvances: z.number().int().nonnegative(),
  // eslint-disable-next-line no-restricted-syntax -- a row count for a warn-only checklist, not money
  pendingObligations: z.number().int().nonnegative(),
  // eslint-disable-next-line no-restricted-syntax -- a row count for a warn-only checklist, not money
  openIncidents: z.number().int().nonnegative(),
});

export const closeChecklistResponseSchema = z.object({
  period: accountingPeriodSummarySchema,
  checklist: closeChecklistSchema,
});

export const closeAccountingPeriodResponseSchema = z.object({
  closedPeriod: accountingPeriodSummarySchema,
  newPeriod: accountingPeriodSummarySchema,
  checklist: closeChecklistSchema,
});
