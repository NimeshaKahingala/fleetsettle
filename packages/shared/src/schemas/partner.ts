import { z } from "zod";
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
