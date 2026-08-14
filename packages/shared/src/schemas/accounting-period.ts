import { z } from "zod";

export const accountingPeriodSummarySchema = z.object({
  id: z.string().uuid(),
  periodStart: z.string(),
  periodEnd: z.string(),
});
export type AccountingPeriodSummary = z.infer<typeof accountingPeriodSummarySchema>;

/** F-9.1 step 1/UC-98/UI §7.7: warns and lists, never blocks (U-7). Counts only — see `queries/accounting-period.ts`'s own doc comment for exactly what each one scopes to. `unconfirmedDays` is UI §7.7's first row (GAP-13, A3); it under-reports honestly if `generate-day-cards` hasn't run for a date yet, which is what U-7 permits — `dayCardsGeneratedThrough` (GAP-94) is the coverage admission that makes that gap visible rather than silent: the furthest `business_date` a card exists for in this period, `null` when none do yet. A manager sees "cards generated through 27th; this period ends the 31st" and can wait, not just a count that quietly excludes the four days nobody has been asked about. */
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
  dayCardsGeneratedThrough: z.string().nullable(),
});
export type CloseChecklist = z.infer<typeof closeChecklistSchema>;

export const closeChecklistResponseSchema = z.object({
  period: accountingPeriodSummarySchema,
  checklist: closeChecklistSchema,
});
export type CloseChecklistResponse = z.infer<typeof closeChecklistResponseSchema>;

export const closeAccountingPeriodResponseSchema = z.object({
  closedPeriod: accountingPeriodSummarySchema,
  newPeriod: accountingPeriodSummarySchema,
  checklist: closeChecklistSchema,
});
export type CloseAccountingPeriodResponse = z.infer<typeof closeAccountingPeriodResponseSchema>;

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
