import { z } from "zod";
import { businessDateSchema, moneyWireSchema, uuidSchema } from "./common.js";

const positiveMoneyWireSchema = moneyWireSchema.refine((v) => v > 0n, {
  message: "differenceMinor must be greater than zero",
});

/**
 * F-8.2/UC-93/W-36/W-37: corrections are partial far more often than total —
 * a 50,000 handover counting out at 48,000 needs 2,000 undone, not 50,000.
 * `bearer` is a decision, never a silent default (W-37): whether the shortfall
 * goes back to the party's arrears, or is absorbed as a cash-handling loss the
 * business eats instead.
 */
export const correctPaymentRequestSchema = z.object({
  differenceMinor: positiveMoneyWireSchema,
  bearer: z.enum(["back_to_arrears", "absorbed_loss"]),
  reason: z.string().trim().min(1).max(500),
  correctedOn: businessDateSchema,
});
export type CorrectPaymentRequest = z.infer<typeof correctPaymentRequestSchema>;

export const paymentCorrectionResponseSchema = z.object({
  correctionId: uuidSchema,
  paymentId: uuidSchema,
  differenceMinor: z.string(),
  bearer: z.enum(["back_to_arrears", "absorbed_loss"]),
  payment: z.object({
    id: uuidSchema,
    amountMinor: z.string(),
    status: z.enum(["active", "corrected", "reversed"]),
  }),
});
export type PaymentCorrectionResponse = z.infer<typeof paymentCorrectionResponseSchema>;
