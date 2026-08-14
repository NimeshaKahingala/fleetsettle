import { z } from "zod";
import { businessDateSchema, moneyWireSchema, uuidSchema } from "./common.js";

const positiveMoneyWireSchema = moneyWireSchema.refine((v) => v > 0n, {
  message: "amountMinor must be greater than zero",
});

/**
 * F-8.4/UC-91/W-29: a camera fine or toll arriving weeks after the lease or
 * trip closed. `obligation.kind = 'post_closure_charge'` already existed in
 * the enum since P3/P4's own schema — this is the first endpoint to
 * actually write it. Deliberately does not check whether `sourceId` is
 * itself closed: that is the entire point of the flow.
 */
export const recordPostClosureChargeRequestSchema = z
  .object({
    partyType: z.enum(["customer", "driver"]),
    partyCustomerId: uuidSchema.optional(),
    partyDriverId: uuidSchema.optional(),
    vehicleId: uuidSchema.optional(),
    sourceType: z.enum(["lease", "trip"]),
    sourceId: uuidSchema,
    amountMinor: positiveMoneyWireSchema,
    dueOn: businessDateSchema,
    note: z.string().trim().max(500).optional(),
    // GAP-60/D-16/F-8.5: set when this charge is the corrected replacement
    // for one already voided — the only obligation kind a direct void ever
    // applies to (INV-36), so the only one this ever names. The target must
    // belong to this business and already be voided, checked server-side.
    replacesId: uuidSchema.optional(),
  })
  .refine((v) => v.partyType !== "customer" || v.partyCustomerId !== undefined, {
    message: "partyCustomerId is required when partyType is 'customer'",
    path: ["partyCustomerId"],
  })
  .refine((v) => v.partyType !== "driver" || v.partyDriverId !== undefined, {
    message: "partyDriverId is required when partyType is 'driver'",
    path: ["partyDriverId"],
  });
export type RecordPostClosureChargeRequest = z.infer<typeof recordPostClosureChargeRequestSchema>;

export const postClosureChargeResponseSchema = z.object({
  obligationId: uuidSchema,
  partyType: z.enum(["customer", "driver"]),
  amountMinor: z.string(),
  dueOn: z.string(),
  status: z.enum(["pending", "part_paid", "paid", "waived", "written_off"]),
  // GAP-60/D-16/F-8.6: "what corrected this?", answered from the record.
  replacesId: uuidSchema.nullable(),
});
export type PostClosureChargeResponse = z.infer<typeof postClosureChargeResponseSchema>;
