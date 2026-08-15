import { z } from "zod";
import { businessDateSchema, moneyWireSchema, uuidSchema, voidedResponseSchema } from "./common.js";

const positiveMoneyWireSchema = moneyWireSchema.refine((v) => v > 0n, {
  message: "amountMinor must be greater than zero",
});

/** F-6.3/UC-53: money handed to the driver up front — not a cost (§1.5) until it is settled. */
export const issueAdvanceRequestSchema = z.object({
  driverId: uuidSchema,
  tripId: uuidSchema.optional(),
  amountMinor: positiveMoneyWireSchema,
  issuedOn: businessDateSchema,
  // GAP-60/D-16/F-8.5: set when this advance is the corrected replacement
  // for one already voided — the target must belong to this business and
  // already be voided, checked server-side.
  replacesId: uuidSchema.optional(),
});
export type IssueAdvanceRequest = z.infer<typeof issueAdvanceRequestSchema>;

export const advanceResponseSchema = z.object({
  id: z.string().uuid(),
  driverId: z.string().uuid(),
  tripId: z.string().uuid().nullable(),
  amountMinor: z.string(),
  issuedOn: z.string(),
  status: z.enum(["open", "part_settled", "settled"]),
  settledMinor: z.string(),
  // GAP-60/D-16/F-8.6: this advance's own "what corrected this?".
  replacesId: z.string().uuid().nullable(),
});
export type AdvanceResponse = z.infer<typeof advanceResponseSchema>;

/** The advance closes at zero: what he spent, what he returned, anything agreed to keep as fee. */
export const settleAdvanceRequestSchema = z.object({
  kind: z.enum(["spent", "returned", "kept_as_fee"]),
  amountMinor: positiveMoneyWireSchema,
  occurredOn: businessDateSchema,
  // GAP-60/D-16/F-8.5: see issueAdvanceRequestSchema's own comment — this
  // one names the settlement being replaced, not the advance.
  replacesId: uuidSchema.optional(),
});
export type SettleAdvanceRequest = z.infer<typeof settleAdvanceRequestSchema>;

/** GAP-12/W-61/INV-36 §3.5: the settlement this write just recorded — what a later void targets, the same reasoning `depositResponseSchema`'s own `movementId` carries. */
export const settledAdvanceResponseSchema = advanceResponseSchema.extend({
  settlementId: uuidSchema,
  // GAP-60/D-16/F-8.6: the settlement's own replacesId — distinct from the
  // advance's own `replacesId` field this schema already inherited above.
  settlementReplacesId: z.string().uuid().nullable(),
});
export type SettledAdvanceResponse = z.infer<typeof settledAdvanceResponseSchema>;

/** GAP-12/W-61/INV-36 §3.5: void, never delete — `advance` comes back with `status` already recomputed from the live settlements that remain. */
export const voidedAdvanceSettlementResponseSchema = z.object({
  id: uuidSchema,
  voidedAt: z.string(),
  advance: advanceResponseSchema,
});
export type VoidedAdvanceSettlementResponse = z.infer<typeof voidedAdvanceSettlementResponseSchema>;

/** GAP-12/W-61/INV-36 §3.6: void, never delete — refused while any settlement against it is still live (VOID_BLOCKED). */
export const voidedAdvanceResponseSchema = voidedResponseSchema;
export type VoidedAdvanceResponse = z.infer<typeof voidedAdvanceResponseSchema>;

/** F-6.7/UC-58/W-8: recorded as money held, never income (INV-4). */
export const takeDriverDepositRequestSchema = z.object({
  driverId: uuidSchema,
  amountMinor: positiveMoneyWireSchema,
  occurredOn: businessDateSchema,
});
export type TakeDriverDepositRequest = z.infer<typeof takeDriverDepositRequestSchema>;

/** GAP-6/F-6.7/UC-58: "apply against arrears" needs `obligationId` — which of the driver's own `owed_to_us` obligations this movement settles — required exactly when `movementType` is `'applied'`. */
export const depositMovementRequestSchema = z
  .object({
    movementType: z.enum(["topped_up", "reduced", "applied", "refunded", "retained"]),
    amountMinor: positiveMoneyWireSchema,
    occurredOn: businessDateSchema,
    reason: z.string().trim().max(500).optional(),
    obligationId: uuidSchema.optional(),
    // GAP-60/D-16/F-8.5: set when this movement is the corrected replacement
    // for one already voided — the target must belong to this business and
    // already be voided, checked server-side.
    replacesId: uuidSchema.optional(),
  })
  .refine((v) => (v.movementType === "applied") === (v.obligationId !== undefined), {
    message: "obligationId is required when movementType is 'applied', and only then",
    path: ["obligationId"],
  });
export type DepositMovementRequest = z.infer<typeof depositMovementRequestSchema>;

export const depositResponseSchema = z.object({
  id: z.string().uuid(),
  partyDriverId: z.string().uuid(),
  status: z.enum(["held", "hold_window", "released", "applied", "retained"]),
  heldMinor: z.string(),
  /** GAP-12/W-61/INV-36 §3.3: the movement this write just recorded — what a later void targets. */
  movementId: uuidSchema,
  // GAP-60/D-16/F-8.6: that movement's own "what corrected this?" — `deposit`
  // itself carries no `replaces_id` column, only `deposit_movement` does.
  movementReplacesId: z.string().uuid().nullable(),
});
export type DepositResponse = z.infer<typeof depositResponseSchema>;

/** GAP-12/W-61/INV-36 §3.3/§3.4: void, never delete — `deposit` comes back with `status` already recomputed from what's left live. */
export const voidedDepositMovementResponseSchema = z.object({
  id: uuidSchema,
  voidedAt: z.string(),
  deposit: depositResponseSchema.omit({ movementId: true, movementReplacesId: true }),
});
export type VoidedDepositMovementResponse = z.infer<typeof voidedDepositMovementResponseSchema>;

/**
 * F-6.4/UC-56/W-2, INV-3: the ONLY thing that moves both driver balances.
 * The net is information a caller may display; nothing here nets
 * automatically — this record is the explicit, deliberate exception.
 */
export const createOffsetRequestSchema = z.object({
  driverId: uuidSchema,
  amountMinor: positiveMoneyWireSchema,
  occurredOn: businessDateSchema,
  note: z.string().trim().max(500).optional(),
  // GAP-60/D-16/F-8.5: set when this offset is the corrected replacement for
  // one already voided — the target must belong to this business and
  // already be voided, checked server-side.
  replacesId: uuidSchema.optional(),
});
export type CreateOffsetRequest = z.infer<typeof createOffsetRequestSchema>;

export const offsetResponseSchema = z.object({
  id: z.string().uuid(),
  driverId: z.string().uuid(),
  amountMinor: z.string(),
  occurredOn: z.string(),
  note: z.string().nullable(),
  // GAP-60/D-16/F-8.6: "what corrected this?", answered from the record.
  replacesId: z.string().uuid().nullable(),
});
export type OffsetResponse = z.infer<typeof offsetResponseSchema>;

/**
 * W-2: two figures, never netted in storage or in this response. A caller
 * may compute and *display* a net; it is not a field here, so nothing can
 * mistake it for a stored, authoritative balance.
 */
export const driverBalancesResponseSchema = z.object({
  driverId: z.string().uuid(),
  owedToUsMinor: z.string(),
  owedByUsMinor: z.string(),
});
export type DriverBalancesResponse = z.infer<typeof driverBalancesResponseSchema>;
