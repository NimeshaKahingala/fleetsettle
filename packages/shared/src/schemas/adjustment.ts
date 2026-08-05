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
