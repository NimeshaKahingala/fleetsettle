import { z } from "zod";
import { businessDateSchema, moneyWireSchema, uuidSchema } from "./common.js";

/** F-2.1/F-2.3: how an odometer figure was obtained is part of the reading (INV-19, W-18). */
export const odometerSourceSchema = z.enum(["photo", "in_person", "reported", "at_return"]);
export type OdometerSource = z.infer<typeof odometerSourceSchema>;

/** DM §6: what generating a billing period produces — the allowance is derived, never typed (W-24). */
export const billingPeriodResponseSchema = z.object({
  id: z.string().uuid(),
  leaseId: z.string().uuid(),
  // eslint-disable-next-line no-restricted-syntax -- a sequence number, not money
  seq: z.number().int(),
  periodStart: z.string(),
  periodEnd: z.string(),
  // eslint-disable-next-line no-restricted-syntax -- a day count, not money
  daysCount: z.number().int(),
  rentAmountMinor: z.string(),
  // eslint-disable-next-line no-restricted-syntax -- kilometres, not money
  allowanceKm: z.number().int().nullable(),
});
export type BillingPeriodResponse = z.infer<typeof billingPeriodResponseSchema>;

/**
 * F-2.3/UC-14: enter a reading + source, and the system settles whatever
 * billing period(s) since the last reading it covers. There is deliberately
 * no `billingPeriodId` here — which period(s) it lands in is derived from
 * the date, never chosen by the caller (W-24).
 */
export const recordOdometerReadingRequestSchema = z.object({
  leaseId: uuidSchema,
  // eslint-disable-next-line no-restricted-syntax -- an odometer figure, not money
  readingKm: z.number().int().nonnegative(),
  readOn: businessDateSchema,
  source: odometerSourceSchema,
});
export type RecordOdometerReadingRequest = z.infer<typeof recordOdometerReadingRequestSchema>;

/** The per-period apportionment shown when a boundary reading was missing (INV-26). */
export const mileageAssessmentSplitSchema = z.object({
  billingPeriodId: z.string().uuid(),
  // eslint-disable-next-line no-restricted-syntax -- kilometres, not money
  apportionedKm: z.number().int(),
  apportionedExcessMinor: z.string(),
});
export type MileageAssessmentSplit = z.infer<typeof mileageAssessmentSplitSchema>;

/** F-2.3: what reading the odometer produces — an assessment, and the due it raised (if not auto-waived away). */
export const mileageAssessmentResponseSchema = z.object({
  id: z.string().uuid(),
  leaseId: z.string().uuid(),
  // eslint-disable-next-line no-restricted-syntax -- kilometres, not money
  drivenKm: z.number().int(),
  // eslint-disable-next-line no-restricted-syntax -- kilometres, not money
  combinedAllowanceKm: z.number().int(),
  // eslint-disable-next-line no-restricted-syntax -- kilometres, not money
  excessKm: z.number().int(),
  excessAmountMinor: z.string(),
  isEstimated: z.boolean(),
  status: z.enum(["provisional", "final", "superseded"]),
  splits: z.array(mileageAssessmentSplitSchema),
  obligationId: z.string().uuid().nullable(),
  autoWaived: z.boolean(),
});
export type MileageAssessmentResponse = z.infer<typeof mileageAssessmentResponseSchema>;

/**
 * F-2.5/UC-17: same customer, new agreed amount from a date. Old periods
 * keep their old figure (it is frozen onto `billing_period` at generation
 * time) — this only changes what the *next* generated period picks up.
 */
export const renewLeaseRequestSchema = z.object({
  rentAmountMinor: moneyWireSchema,
  // eslint-disable-next-line no-restricted-syntax -- kilometres, not money
  mileageDailyLimitKm: z.number().int().positive().optional(),
  mileageExcessRateMinor: moneyWireSchema.optional(),
});
export type RenewLeaseRequest = z.infer<typeof renewLeaseRequestSchema>;

/**
 * F-2.2/UC-11: a generic payment against a party's outstanding
 * `owed_to_us` obligations, oldest-`due_on`-first (§6.5) — the same
 * allocation discipline the driver side already uses, generalised to
 * whichever party actually owes (customer here; a driver's daily short-fall
 * is F-4's own confirm-day path, not this one).
 */
export const recordPaymentRequestSchema = z.object({
  partyType: z.enum(["customer", "driver", "partner"]),
  partyId: uuidSchema,
  amountMinor: moneyWireSchema.refine((v) => v > 0n, {
    message: "amountMinor must be greater than zero",
  }),
  occurredOn: businessDateSchema,
});
export type RecordPaymentRequest = z.infer<typeof recordPaymentRequestSchema>;

export const paymentAllocationSchema = z.object({
  obligationId: z.string().uuid(),
  amountMinor: z.string(),
});
export type PaymentAllocationEntry = z.infer<typeof paymentAllocationSchema>;

export const paymentResponseSchema = z.object({
  id: z.string().uuid(),
  amountMinor: z.string(),
  occurredOn: z.string(),
  allocations: z.array(paymentAllocationSchema),
  unallocatedMinor: z.string(),
});
export type PaymentResponse = z.infer<typeof paymentResponseSchema>;

/**
 * A3/GAP-38: `POST /api/payment/{id}/correct` has existed since P9 with no
 * caller — F-8.2's own first step is "open the receipt", so this is what
 * hands a screen a payment id. Carries the same fields `correctPayment`
 * reads plus enough party context to render a receipt row without a second
 * lookup.
 */
export const paymentListRowSchema = z.object({
  id: z.string().uuid(),
  direction: z.enum(["received", "paid"]),
  partyType: z.enum(["customer", "driver", "partner"]),
  partyCustomerId: z.string().uuid().nullable(),
  partyDriverId: z.string().uuid().nullable(),
  partyUserId: z.string().uuid().nullable(),
  amountMinor: z.string(),
  occurredOn: z.string(),
  method: z.string().nullable(),
  reference: z.string().nullable(),
  status: z.enum(["active", "corrected", "reversed"]),
});
export type PaymentListRow = z.infer<typeof paymentListRowSchema>;

export const listPaymentsResponseSchema = z.array(paymentListRowSchema);
export type ListPaymentsResponse = z.infer<typeof listPaymentsResponseSchema>;

/** A3: every filter optional — an unfiltered call is every payment the business has ever recorded, newest first. `from`/`to` bound `occurredOn`, the same convention `listExpensesQuerySchema` already established. */
export const listPaymentsQuerySchema = z.object({
  partyType: z.enum(["customer", "driver", "partner"]).optional(),
  partyCustomerId: uuidSchema.optional(),
  partyDriverId: uuidSchema.optional(),
  direction: z.enum(["received", "paid"]).optional(),
  from: businessDateSchema.optional(),
  to: businessDateSchema.optional(),
});
export type ListPaymentsQuery = z.infer<typeof listPaymentsQuerySchema>;

/**
 * The lease hub's dues list (Web-P6b): every `owed_to_us` obligation this
 * lease has ever raised — rent (`sourceType: billing_period`), mileage
 * excess (`sourceType: mileage_assessment`) and any post-closure charge
 * billed directly against it (`sourceType: lease`) — oldest due-on first,
 * settled and waived ones included so F-2.2's "tap the due" and F-2.4's
 * "on any due" both have somewhere to read from. Deliberately not filtered
 * to outstanding-only the way `closureUnpaidObligationSchema` (lease-closure.ts)
 * is — that one exists for a different question ("what's left before I can
 * settle the deposit"); this one is "what has this lease ever owed."
 */
export const leaseObligationRowSchema = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  dueOn: z.string(),
  amountMinor: z.string(),
  settledMinor: z.string(),
  waivedMinor: z.string(),
  status: z.enum(["pending", "part_paid", "paid", "waived", "written_off"]),
});
export type LeaseObligationRow = z.infer<typeof leaseObligationRowSchema>;

export const listLeaseObligationsResponseSchema = z.array(leaseObligationRowSchema);
export type ListLeaseObligationsResponse = z.infer<typeof listLeaseObligationsResponseSchema>;
