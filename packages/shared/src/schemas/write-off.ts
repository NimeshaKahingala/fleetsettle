import { z } from "zod";
import { businessDateSchema, moneyWireSchema, uuidSchema } from "./common.js";

const positiveMoneyWireSchema = moneyWireSchema.refine((v) => v > 0n, {
  message: "amountMinor must be greater than zero",
});

/**
 * F-8.3/UC-90/W-28: a loss you were handed, never pooled with a waiver
 * (INV-14) — the goodwill report (UC-77) and this one never share a total.
 * `obligationId` is optional: most write-offs clear a specific outstanding
 * due, but a standalone loss with nothing to point at (an opening-balance
 * figure, say) is real too.
 */
export const writeOffRequestSchema = z
  .object({
    obligationId: uuidSchema.optional(),
    partyType: z.enum(["customer", "driver"]),
    partyCustomerId: uuidSchema.optional(),
    partyDriverId: uuidSchema.optional(),
    vehicleId: uuidSchema.optional(),
    amountMinor: positiveMoneyWireSchema,
    reason: z.string().trim().min(1).max(500),
    writtenOffOn: businessDateSchema,
  })
  .refine((v) => v.partyType !== "customer" || v.partyCustomerId !== undefined, {
    message: "partyCustomerId is required when partyType is 'customer'",
    path: ["partyCustomerId"],
  })
  .refine((v) => v.partyType !== "driver" || v.partyDriverId !== undefined, {
    message: "partyDriverId is required when partyType is 'driver'",
    path: ["partyDriverId"],
  });
export type WriteOffRequest = z.infer<typeof writeOffRequestSchema>;

export const writeOffResponseSchema = z.object({
  id: uuidSchema,
  obligationId: uuidSchema.nullable(),
  partyType: z.enum(["customer", "driver"]),
  partyCustomerId: uuidSchema.nullable(),
  partyDriverId: uuidSchema.nullable(),
  vehicleId: uuidSchema.nullable(),
  amountMinor: z.string(),
  reason: z.string(),
  writtenOffOn: z.string(),
});
export type WriteOffResponse = z.infer<typeof writeOffResponseSchema>;

/** A3: `writeOffResponseSchema` plus the void fields — a voided write-off stays in the list, struck through with its reason, never removed (W-50), the same convention `expenseListRowSchema` already established. GAP-12 means nothing sets these yet, but the shape is ready for when it does. */
export const writeOffListRowSchema = writeOffResponseSchema.extend({
  voidedAt: z.string().nullable(),
  voidedReason: z.string().nullable(),
});
export type WriteOffListRow = z.infer<typeof writeOffListRowSchema>;

export const listWriteOffsResponseSchema = z.array(writeOffListRowSchema);
export type ListWriteOffsResponse = z.infer<typeof listWriteOffsResponseSchema>;

/** A3: every filter optional — an unfiltered call is every write-off the business has ever recorded, newest first. */
export const listWriteOffsQuerySchema = z.object({
  partyType: z.enum(["customer", "driver"]).optional(),
  partyCustomerId: uuidSchema.optional(),
  partyDriverId: uuidSchema.optional(),
  vehicleId: uuidSchema.optional(),
  from: businessDateSchema.optional(),
  to: businessDateSchema.optional(),
});
export type ListWriteOffsQuery = z.infer<typeof listWriteOffsQuerySchema>;

/**
 * INV-15: a later payment against a written-off balance is a recovery that
 * nets against the loss, never fresh income. Recorded through the ordinary
 * payment mechanism underneath (domain/write-off.ts), deliberately never
 * allocated against any obligation — the written-off one no longer counts as
 * outstanding, and nothing else should absorb this money by accident.
 */
export const recordWriteOffRecoveryRequestSchema = z.object({
  amountMinor: positiveMoneyWireSchema,
  occurredOn: businessDateSchema,
});
export type RecordWriteOffRecoveryRequest = z.infer<typeof recordWriteOffRecoveryRequestSchema>;

export const writeOffRecoveryResponseSchema = z.object({
  id: uuidSchema,
  writeOffId: uuidSchema,
  paymentId: uuidSchema,
  amountMinor: z.string(),
});
export type WriteOffRecoveryResponse = z.infer<typeof writeOffRecoveryResponseSchema>;
