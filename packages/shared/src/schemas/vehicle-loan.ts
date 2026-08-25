import { z } from "zod";
import {
  businessDateSchema,
  moneyWireSchema,
  positiveMoneyWireSchema,
  uuidSchema,
} from "./common.js";

/**
 * F-12.1/UC-106, W-68/W-70. **Saves on `lender` + `principalMinor` +
 * `totalRepayableMinor` + `termMonths` alone (U-2)** — everything else is
 * level 2 and must never be required, an automated test rather than an
 * intention. `amortisationMethod` is not on the wire at all: `'flat'` is the
 * only value the schema admits, so there is nothing for a client to choose.
 *
 * `liabilityOwnerUserId` absent means the business carries the debt
 * (UC-107); given, the whole loan is a named owner's own liability. A down
 * payment names exactly one funder, or neither field is set (W-52) — never
 * split across owners. `purchaseCostMinor` is entered here but lives on the
 * vehicle itself (`vehicle.purchase_cost_minor`), not on the loan row.
 */
export const createVehicleLoanRequestSchema = z
  .object({
    vehicleId: uuidSchema,
    lender: z.string().trim().min(1).max(200),
    principalMinor: positiveMoneyWireSchema,
    totalRepayableMinor: positiveMoneyWireSchema,
    // eslint-disable-next-line no-restricted-syntax -- a term in months, not money
    termMonths: z.number().int().positive(),
    monthlyPaymentMinor: positiveMoneyWireSchema.optional(),
    // eslint-disable-next-line no-restricted-syntax -- a day-of-month, not money
    paymentDay: z.number().int().min(1).max(31).optional(),
    downPaymentMinor: positiveMoneyWireSchema.optional(),
    downPaymentByUserId: uuidSchema.optional(),
    liabilityOwnerUserId: uuidSchema.optional(),
    purchaseCostMinor: positiveMoneyWireSchema.optional(),
    startedOn: businessDateSchema,
  })
  .refine((v) => v.totalRepayableMinor >= v.principalMinor, {
    message: "totalRepayableMinor must be at least principalMinor",
    path: ["totalRepayableMinor"],
  })
  .refine((v) => (v.downPaymentMinor === undefined) === (v.downPaymentByUserId === undefined), {
    message: "downPaymentMinor and downPaymentByUserId must be given together, or neither",
    path: ["downPaymentByUserId"],
  });
export type CreateVehicleLoanRequest = z.infer<typeof createVehicleLoanRequestSchema>;

export const vehicleLoanResponseSchema = z.object({
  id: z.string().uuid(),
  vehicleId: z.string().uuid(),
  lender: z.string(),
  liabilityOwnerUserId: z.string().uuid().nullable(),
  principalMinor: z.string(),
  totalRepayableMinor: z.string(),
  // eslint-disable-next-line no-restricted-syntax -- a term in months, not money
  termMonths: z.number().int(),
  monthlyPaymentMinor: z.string().nullable(),
  // eslint-disable-next-line no-restricted-syntax -- a day-of-month, not money
  paymentDay: z.number().int().nullable(),
  amortisationMethod: z.literal("flat"),
  downPaymentMinor: z.string().nullable(),
  downPaymentByUserId: z.string().uuid().nullable(),
  startedOn: z.string(),
  closedOn: z.string().nullable(),
  // F-12.4: derived on read, never stored (DM §4.4) — the figure on the
  // lender's letter. Always a real number: a failed read degrades the
  // whole response (W-56), never this one field to a fabricated 0.
  remainingToPayMinor: z.string(),
  // F-12.4: "instalments due since start minus everything paid" — `null`
  // when there is no monthly figure to compare against (monthlyPaymentMinor
  // is level 2, U-2), a real absence rather than a fabricated 0 (W-56), the
  // same "zero and unknown look different" reading `vehicleMaintenanceStatusSchema`'s
  // own `kmSinceLastServiceKm` already gives this.
  behindByMinor: z.string().nullable(),
});
export type VehicleLoanResponse = z.infer<typeof vehicleLoanResponseSchema>;

export const listVehicleLoansResponseSchema = z.array(vehicleLoanResponseSchema);
export type ListVehicleLoansResponse = z.infer<typeof listVehicleLoansResponseSchema>;

/**
 * F-12.2/UC-107, INV-43/44/45. Nothing but the amount and the date is asked
 * — the split is derived from the loan's own fixed ratio, never entered.
 * **Refused in this version** when the loan's `liabilityOwner` is a named
 * owner and this payment claims to come from anyone else — v1 restricts a
 * loan-on-behalf payment to business cash, checked server-side rather than
 * on the wire, since the refusal depends on the loan row, not the request.
 */
export const recordLoanPaymentRequestSchema = z.object({
  amountMinor: positiveMoneyWireSchema,
  paidOn: businessDateSchema,
  note: z.string().trim().max(500).optional(),
  replacesId: uuidSchema.optional(),
});
export type RecordLoanPaymentRequest = z.infer<typeof recordLoanPaymentRequestSchema>;

export const loanPaymentResponseSchema = z.object({
  id: z.string().uuid(),
  loanId: z.string().uuid(),
  amountMinor: z.string(),
  paidOn: z.string(),
  isSettlement: z.boolean(),
  waivedMinor: z.string(),
  note: z.string().nullable(),
  voidedAt: z.string().nullable(),
  voidedReason: z.string().nullable(),
  replacesId: z.string().uuid().nullable(),
});
export type LoanPaymentResponse = z.infer<typeof loanPaymentResponseSchema>;

export const listLoanPaymentsResponseSchema = z.array(loanPaymentResponseSchema);
export type ListLoanPaymentsResponse = z.infer<typeof listLoanPaymentsResponseSchema>;

/** F-12.3/UC-108, W-69/INV-43. The figure the lender quoted — settlement < principal outstanding writes no money record at all, only `waived_minor` on the closing payment. */
export const settleVehicleLoanRequestSchema = z.object({
  settlementAmountMinor: moneyWireSchema.refine((v) => v >= 0n, {
    message: "settlementAmountMinor cannot be negative",
  }),
  settledOn: businessDateSchema,
  note: z.string().trim().max(500).optional(),
});
export type SettleVehicleLoanRequest = z.infer<typeof settleVehicleLoanRequestSchema>;

// F-12.3's own void ("clears closed_on and reopens the loan, voiding its
// finance expense with it", INV-43) reuses the shared `voidRequestSchema`/
// `voidedResponseSchema` (common.js) — same shape as every other void here.
