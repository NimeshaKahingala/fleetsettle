import { z } from "zod";
import { accountingPeriodSummarySchema } from "./accounting-period.js";
import { businessDateSchema, moneyWireSchema, uuidSchema } from "./common.js";

/**
 * F-1.3/UC-02/INV-16: shares must total exactly 100% on any date they are in
 * force — enforced by `assert_shares_total()` (a deferred constraint
 * trigger, migration 0001), never pre-checked here; a violation is caught
 * and mapped to a 400. All shares given in one request share `effectiveFrom`
 * — a genuine effective-dated *change* to an existing split is a second call
 * with a later date, not a mixed-date batch.
 */
export const ownershipShareEntrySchema = z.object({
  userId: uuidSchema,
  // eslint-disable-next-line no-restricted-syntax -- basis points, not money
  shareBp: z.number().int().min(1).max(10000),
});
export type OwnershipShareEntry = z.infer<typeof ownershipShareEntrySchema>;

export const setOwnershipSharesRequestSchema = z.object({
  vehicleId: uuidSchema,
  effectiveFrom: businessDateSchema,
  shares: z.array(ownershipShareEntrySchema).min(1),
});
export type SetOwnershipSharesRequest = z.infer<typeof setOwnershipSharesRequestSchema>;

export const ownershipShareResponseSchema = z.object({
  id: z.string().uuid(),
  vehicleId: z.string().uuid(),
  userId: z.string().uuid(),
  // eslint-disable-next-line no-restricted-syntax -- basis points, not money
  shareBp: z.number(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable(),
});
export type OwnershipShareResponse = z.infer<typeof ownershipShareResponseSchema>;

export const ownershipSharesResponseSchema = z.array(ownershipShareResponseSchema);
export type OwnershipSharesResponse = z.infer<typeof ownershipSharesResponseSchema>;

/** A2/GAP-9: the currently active split — `effectiveTo IS NULL` — never the full effective-dated history. `vehicleId` narrows to one vehicle; omitted, every vehicle's current split in the business. */
export const listOwnershipSharesQuerySchema = z.object({
  vehicleId: uuidSchema.optional(),
});
export type ListOwnershipSharesQuery = z.infer<typeof listOwnershipSharesQuerySchema>;

/** F-1.3/UC-02/W-52: what a partner PAID — distinct from `ownership_share`, what he OWNS. The gap between the two is a standing claim, never a bigger slice. */
export const recordCapitalContributionRequestSchema = z.object({
  vehicleId: uuidSchema.optional(),
  userId: uuidSchema,
  amountMinor: moneyWireSchema,
  contributedOn: businessDateSchema,
  note: z.string().trim().max(500).optional(),
});
export type RecordCapitalContributionRequest = z.infer<
  typeof recordCapitalContributionRequestSchema
>;

export const capitalContributionResponseSchema = z.object({
  id: z.string().uuid(),
  vehicleId: z.string().uuid().nullable(),
  userId: z.string().uuid(),
  amountMinor: z.string(),
  contributedOn: z.string(),
  note: z.string().nullable(),
});
export type CapitalContributionResponse = z.infer<typeof capitalContributionResponseSchema>;

/** A2/GAP-9: newest first. `userId`/`vehicleId` both optional — this is also the query `GET /api/partner/{userId}`'s "put in" block reads through, unscoped by vehicle. */
export const listCapitalContributionsQuerySchema = z.object({
  userId: uuidSchema.optional(),
  vehicleId: uuidSchema.optional(),
});
export type ListCapitalContributionsQuery = z.infer<typeof listCapitalContributionsQuerySchema>;

export const capitalContributionsResponseSchema = z.array(capitalContributionResponseSchema);
export type CapitalContributionsResponse = z.infer<typeof capitalContributionsResponseSchema>;

/**
 * F-1.4/UC-03/W-53: sharing a vehicle with a manager, with an optional
 * monthly fee — a vehicle cost to the owner, income to the manager,
 * appearing in UC-64's "managed" block rather than as an ordinary expense.
 */
export const grantManagementRequestSchema = z.object({
  vehicleId: uuidSchema,
  managerUserId: uuidSchema,
  monthlyFeeMinor: moneyWireSchema.optional(),
  effectiveFrom: businessDateSchema,
});
export type GrantManagementRequest = z.infer<typeof grantManagementRequestSchema>;

export const managementFeeAgreementResponseSchema = z.object({
  id: z.string().uuid(),
  vehicleId: z.string().uuid(),
  managerUserId: z.string().uuid(),
  monthlyFeeMinor: z.string(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable(),
});
export type ManagementFeeAgreementResponse = z.infer<typeof managementFeeAgreementResponseSchema>;

/** A2/GAP-9: **revoked agreements are returned, not filtered out** — F-1.4's own "Revoke — access ends, everything they entered stays." */
export const listManagementFeeAgreementsQuerySchema = z.object({
  vehicleId: uuidSchema.optional(),
  managerUserId: uuidSchema.optional(),
});
export type ListManagementFeeAgreementsQuery = z.infer<
  typeof listManagementFeeAgreementsQuerySchema
>;

export const managementFeeAgreementsResponseSchema = z.array(managementFeeAgreementResponseSchema);
export type ManagementFeeAgreementsResponse = z.infer<typeof managementFeeAgreementsResponseSchema>;

/**
 * F-7.4/UC-65/W-27/W-37. Banking is not income, not an expense, not a
 * payout — the same money in a different place (§1.5). `discrepancyBearer`
 * is required exactly when the counted amount differs from what was
 * recorded, and only ever `absorbed` or `unattributed` here —
 * `attributed_to_receipt` (DM §7.4's third choice) means the shortfall was
 * traced to one identifiable receipt, corrected there instead (F-8.2), so by
 * the time it reaches this endpoint there is no discrepancy left to bear.
 */
export const bankingDiscrepancyBearerSchema = z.enum(["absorbed", "unattributed"]);
export type BankingDiscrepancyBearer = z.infer<typeof bankingDiscrepancyBearerSchema>;

export const recordBankingEventRequestSchema = z
  .object({
    amountRecordedMinor: moneyWireSchema,
    amountCountedMinor: moneyWireSchema,
    bankedOn: businessDateSchema,
    destination: z.string().trim().min(1).max(200),
    reference: z.string().trim().max(200).optional(),
    discrepancyBearer: bankingDiscrepancyBearerSchema.optional(),
  })
  .refine((v) => v.amountCountedMinor <= v.amountRecordedMinor, {
    message: "amountCountedMinor cannot exceed amountRecordedMinor",
    path: ["amountCountedMinor"],
  })
  .refine(
    (v) => (v.amountCountedMinor !== v.amountRecordedMinor) === (v.discrepancyBearer !== undefined),
    {
      message:
        "discrepancyBearer is required exactly when the counted amount differs from the recorded amount",
      path: ["discrepancyBearer"],
    },
  );
export type RecordBankingEventRequest = z.infer<typeof recordBankingEventRequestSchema>;

export const bankingEventResponseSchema = z.object({
  id: z.string().uuid(),
  fromUserId: z.string().uuid(),
  amountRecordedMinor: z.string(),
  amountCountedMinor: z.string(),
  bankedOn: z.string(),
  destination: z.string(),
  reference: z.string().nullable(),
  discrepancyMinor: z.string(),
  discrepancyBearer: bankingDiscrepancyBearerSchema.nullable(),
});
export type BankingEventResponse = z.infer<typeof bankingEventResponseSchema>;

/** A2/GAP-9: newest-banked-first. `userId` filters to one partner's own bankings (`fromUserId`). */
export const listBankingEventsQuerySchema = z.object({
  userId: uuidSchema.optional(),
});
export type ListBankingEventsQuery = z.infer<typeof listBankingEventsQuerySchema>;

export const bankingEventsResponseSchema = z.array(bankingEventResponseSchema);
export type BankingEventsResponse = z.infer<typeof bankingEventsResponseSchema>;

/** F-7.2/UC-63: never a cost of the vehicle — a payout to a partner, or a settlement between partners. Settlement between partners moves the current account, not the P&L. */
export const recordPartnerPayoutRequestSchema = z.object({
  userId: uuidSchema,
  amountMinor: moneyWireSchema,
  kind: z.enum(["payout", "partner_settlement"]),
  occurredOn: businessDateSchema,
});
export type RecordPartnerPayoutRequest = z.infer<typeof recordPartnerPayoutRequestSchema>;

export const partnerPayoutResponseSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  amountMinor: z.string(),
  kind: z.enum(["payout", "partner_settlement"]),
  occurredOn: z.string(),
});
export type PartnerPayoutResponse = z.infer<typeof partnerPayoutResponseSchema>;

/** A2/GAP-9: newest-occurred-first. `userId` filters to one partner; `kind` splits payouts from settlements. */
export const listPartnerPayoutsQuerySchema = z.object({
  userId: uuidSchema.optional(),
  kind: z.enum(["payout", "partner_settlement"]).optional(),
});
export type ListPartnerPayoutsQuery = z.infer<typeof listPartnerPayoutsQuerySchema>;

/**
 * A2/GAP-9/GAP-4/UC-67/W-52/W-53: "one page per partner, four lines."
 *
 * `putIn`/`takenOut` are **all-time running totals** — a contribution or a
 * payout from years ago never stops counting, the same way `holdingMinor`
 * (`GET /api/reports/cash-position`'s own figure, unscoped by date) already
 * doesn't reset. `earned` is **the `period` named alongside it, and no
 * wider** — profit share and management fee are period facts, not a
 * standing balance, so unlike the other three blocks a rerun across every
 * closed period there has ever been is a different, larger feature this
 * endpoint does not attempt.
 *
 * `putIn.outOfPocketMinor` is GAP-4, closed by **derivation**:
 * `expense.paid_by_user_id` summed at read time, never a written
 * current-account entry — a sum cannot drift from the expense it came from,
 * a new money table can.
 */
export const partnerPutInSchema = z.object({
  contributionsMinor: z.string(),
  outOfPocketMinor: z.string(),
});
export type PartnerPutIn = z.infer<typeof partnerPutInSchema>;

export const partnerTakenOutSchema = z.object({
  payoutsMinor: z.string(),
  settlementsMinor: z.string(),
});
export type PartnerTakenOut = z.infer<typeof partnerTakenOutSchema>;

export const partnerEarnedSchema = z.object({
  profitShareMinor: z.string(),
  managementFeeMinor: z.string(),
});
export type PartnerEarned = z.infer<typeof partnerEarnedSchema>;

export const partnerSummaryResponseSchema = z.object({
  userId: uuidSchema,
  displayName: z.string().nullable(),
  /** The period `earned` is scoped to — same convention `vehicleMonthResponseSchema` (reports.ts) already uses for the identical reason. */
  period: accountingPeriodSummarySchema,
  putIn: partnerPutInSchema,
  takenOut: partnerTakenOutSchema,
  earned: partnerEarnedSchema,
  holdingMinor: z.string(),
  /**
   * GAP-74/UC-67: "what am I owed, and by whom" — the line UC-67 itself
   * calls the one the passive owner actually reads. All-time, unlike
   * `earned` above: `putIn.* + (profit share + management fee summed
   * across every period this business has ever had, open or closed) −
   * takenOut.*` (W-52 — paying in creates a claim, so `putIn` is a
   * positive term). `holdingMinor` is never netted into it (W-2's shape).
   */
  balanceMinor: z.string(),
});
export type PartnerSummaryResponse = z.infer<typeof partnerSummaryResponseSchema>;

export const partnerPayoutsResponseSchema = z.array(partnerPayoutResponseSchema);
export type PartnerPayoutsResponse = z.infer<typeof partnerPayoutsResponseSchema>;
