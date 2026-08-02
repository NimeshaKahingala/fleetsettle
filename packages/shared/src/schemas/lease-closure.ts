import { z } from "zod";
import { businessDateSchema, moneyWireSchema, uuidSchema } from "./common.js";
import { odometerSourceSchema } from "./lease-billing.js";

/**
 * F-2.6/UC-16 steps 1–3, one call: "stop the clock," decide the final
 * period's charge, and (optionally) the closing odometer reading —
 * `finalPeriodMode` picks which of the three treatments UC-16's own table
 * describes ("charge the full period" / "charge the days used" / "a figure
 * you agree"), never a fourth invented here.
 */
export const closeLeaseRequestSchema = z
  .object({
    closingDate: businessDateSchema,
    finalPeriodMode: z.enum(["full", "days_used", "agreed"]),
    agreedAmountMinor: moneyWireSchema.optional(),
    note: z.string().trim().max(500).optional(),
    // eslint-disable-next-line no-restricted-syntax -- an odometer figure, not money
    closingOdometerKm: z.number().int().nonnegative().optional(),
    odometerSource: odometerSourceSchema.optional(),
  })
  .refine((v) => v.finalPeriodMode !== "agreed" || v.agreedAmountMinor !== undefined, {
    message: "agreedAmountMinor is required when finalPeriodMode is 'agreed'",
    path: ["agreedAmountMinor"],
  })
  .refine((v) => (v.closingOdometerKm === undefined) === (v.odometerSource === undefined), {
    message: "closingOdometerKm and odometerSource must be given together",
    path: ["odometerSource"],
  });
export type CloseLeaseRequest = z.infer<typeof closeLeaseRequestSchema>;

export const closedLeaseFinalPeriodSchema = z.object({
  billingPeriodId: uuidSchema,
  obligationId: uuidSchema.nullable(),
  periodEnd: z.string(),
  // eslint-disable-next-line no-restricted-syntax -- a day count, not money
  daysCount: z.number().int(),
  // eslint-disable-next-line no-restricted-syntax -- kilometres, not money
  allowanceKm: z.number().int().nullable(),
  amountMinor: z.string(),
});
export type ClosedLeaseFinalPeriodResponse = z.infer<typeof closedLeaseFinalPeriodSchema>;

export const closeLeaseResponseSchema = z.object({
  finalPeriod: closedLeaseFinalPeriodSchema,
});
export type CloseLeaseResponse = z.infer<typeof closeLeaseResponseSchema>;

/** F-2.6 step 4/INV-18: one list, oldest-due first — "unpaid dues," "this period's amount" and "excess mileage" are all the same shape of fact (an unsettled `owed_to_us` obligation), never three separately assembled ones. */
export const closureUnpaidObligationSchema = z.object({
  id: uuidSchema,
  kind: z.string(),
  dueOn: z.string(),
  amountMinor: z.string(),
  settledMinor: z.string(),
  waivedMinor: z.string(),
});
export type ClosureUnpaidObligation = z.infer<typeof closureUnpaidObligationSchema>;

export const closureOpenIncidentSchema = z.object({
  id: uuidSchema,
  occurredOn: z.string(),
  status: z.string(),
});
export type ClosureOpenIncident = z.infer<typeof closureOpenIncidentSchema>;

export const leaseClosureSummaryResponseSchema = z.object({
  unpaidObligations: z.array(closureUnpaidObligationSchema),
  totalUnpaidMinor: z.string(),
  openIncidents: z.array(closureOpenIncidentSchema),
});
export type LeaseClosureSummaryResponse = z.infer<typeof leaseClosureSummaryResponseSchema>;

/** F-2.6 step 6/W-29/W-44: "apply against what is owed" (F-8.4) is not one of these yet — TRACKER.md records why. */
export const settleLeaseDepositRequestSchema = z
  .object({
    action: z.enum(["refund", "retain", "hold"]),
    amountMinor: moneyWireSchema.optional(),
    reason: z.string().trim().max(500).optional(),
    occurredOn: businessDateSchema,
  })
  .refine((v) => v.action !== "retain" || v.amountMinor !== undefined, {
    message: "amountMinor is required to retain part of a deposit",
    path: ["amountMinor"],
  });
export type SettleLeaseDepositRequest = z.infer<typeof settleLeaseDepositRequestSchema>;

export const settleLeaseDepositResponseSchema = z.object({
  depositId: uuidSchema,
  status: z.enum(["held", "hold_window", "released", "applied", "retained"]),
  heldMinor: z.string(),
  holdReleaseDate: z.string().nullable(),
});
export type SettleLeaseDepositResponse = z.infer<typeof settleLeaseDepositResponseSchema>;
