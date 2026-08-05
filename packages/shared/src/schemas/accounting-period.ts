import { z } from "zod";

export const accountingPeriodSummarySchema = z.object({
  id: z.string().uuid(),
  periodStart: z.string(),
  periodEnd: z.string(),
});

/** F-9.1 step 1/UC-98/UI §7.7: warns and lists, never blocks (U-7). Counts only — see `queries/accounting-period.ts`'s own doc comment for exactly what each one scopes to. `unconfirmedDays` is UI §7.7's first row (GAP-13, A3); it under-reports honestly if `generate-day-cards` hasn't run for a date yet, which is what U-7 permits. */
export const closeChecklistSchema = z.object({
  // eslint-disable-next-line no-restricted-syntax -- a row count for a warn-only checklist, not money
  unconfirmedDays: z.number().int().nonnegative(),
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

/** A3: "which months are closed" — this business's whole period history, newest first. */
export const accountingPeriodListRowSchema = z.object({
  id: z.string().uuid(),
  periodStart: z.string(),
  periodEnd: z.string(),
  status: z.enum(["open", "closed"]),
  closedAt: z.string().nullable(),
});
export type AccountingPeriodListRow = z.infer<typeof accountingPeriodListRowSchema>;

export const listAccountingPeriodsResponseSchema = z.array(accountingPeriodListRowSchema);
export type ListAccountingPeriodsResponse = z.infer<typeof listAccountingPeriodsResponseSchema>;
