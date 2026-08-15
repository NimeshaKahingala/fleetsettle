import { z } from "zod";
import { moneyWireSchema, uuidSchema } from "./common.js";

/** DM §10.3's `CHECK` on `adjustment.adjustment_type`. `waiver`/`auto_waiver` never share a bucket with a write-off (W-28/INV-14, P10's own table). */
export const adjustmentTypeSchema = z.enum([
  "goodwill",
  "rounding",
  "agreed_discount",
  "late_fee",
  "extra_charge",
  "waiver",
  "auto_waiver",
]);
export type AdjustmentType = z.infer<typeof adjustmentTypeSchema>;

const positiveMoneyWireSchema = moneyWireSchema.refine((v) => v > 0n, {
  message: "amountMinor must be greater than zero",
});

/**
 * F-2.4/UC-15, W-17: "adjustment ± with a reason", or waive in full or part.
 * A waiver never changes what was originally billed (`obligation.amount_minor`
 * stays "the 340 charged") — it raises `waived_minor` instead, so a waived due
 * still reads as charged and separately as forgiven. The other types
 * (goodwill/rounding/agreed_discount/late_fee/extra_charge) are a real change
 * to what is owed, so those adjust `amount_minor` itself by `sign * amountMinor`.
 */
export const createAdjustmentRequestSchema = z
  .object({
    obligationId: uuidSchema,
    adjustmentType: adjustmentTypeSchema,
    amountMinor: positiveMoneyWireSchema,
    sign: z.union([z.literal(-1), z.literal(1)]),
    reason: z.string().trim().max(500).optional(),
    // GAP-60/D-16/F-8.5: set when this adjustment is the corrected
    // replacement for one already voided — the target must belong to this
    // business and already be voided, checked server-side.
    replacesId: uuidSchema.optional(),
  })
  .refine(
    (v) =>
      v.adjustmentType === "waiver" || v.adjustmentType === "auto_waiver" ? v.sign === -1 : true,
    {
      message: "a waiver always reduces what is owed — sign must be -1",
      path: ["sign"],
    },
  );
export type CreateAdjustmentRequest = z.infer<typeof createAdjustmentRequestSchema>;

export const adjustmentResponseSchema = z.object({
  id: z.string().uuid(),
  obligationId: z.string().uuid(),
  adjustmentType: adjustmentTypeSchema,
  amountMinor: z.string(),
  sign: z.union([z.literal(-1), z.literal(1)]),
  reason: z.string().nullable(),
});
export type AdjustmentResponse = z.infer<typeof adjustmentResponseSchema>;

/** What applying the adjustment leaves the obligation looking like — the same shape a caller would otherwise have to re-fetch separately. */
export const obligationAfterAdjustmentSchema = z.object({
  id: z.string().uuid(),
  amountMinor: z.string(),
  settledMinor: z.string(),
  waivedMinor: z.string(),
  status: z.enum(["pending", "part_paid", "paid", "waived", "written_off"]),
});
export type ObligationAfterAdjustment = z.infer<typeof obligationAfterAdjustmentSchema>;

/**
 * GAP-12/W-61/INV-36 §3.1: found wiring the adjustment void endpoint — the
 * create response carried the obligation's own id as `id` (deliberately,
 * "one round trip instead of two") but never the adjustment's own id
 * anywhere, so nothing a client held after creating one could ever address
 * it for a later void. `adjustmentId` alongside the obligation shape, not
 * folded into `obligationAfterAdjustmentSchema` itself — that schema is
 * reused by the void response's own `obligation` field, where a fresh
 * `adjustmentId` would not describe anything real.
 */
export const createdAdjustmentResponseSchema = obligationAfterAdjustmentSchema.extend({
  adjustmentId: uuidSchema,
  // GAP-60/D-16/F-8.6: "what corrected this?", answered from the record.
  replacesId: uuidSchema.nullable(),
});
export type CreatedAdjustmentResponse = z.infer<typeof createdAdjustmentResponseSchema>;

/** GAP-12/W-61/INV-36 §3.1: the voided adjustment plus the obligation it reversed, the same "one round trip" reasoning `createAdjustmentRoute` already uses. */
export const voidedAdjustmentResponseSchema = z.object({
  id: uuidSchema,
  voidedAt: z.string(),
  obligation: obligationAfterAdjustmentSchema,
});
export type VoidedAdjustmentResponse = z.infer<typeof voidedAdjustmentResponseSchema>;
