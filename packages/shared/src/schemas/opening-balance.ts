import { z } from "zod";
import { businessDateSchema, moneyWireSchema, uuidSchema } from "./common.js";

/** DM §10.6's CHECK — an opening figure is a starting position, never zero or negative. */
const positiveMoneyWireSchema = moneyWireSchema.refine(
  (v) => v > 0n,
  "An opening balance entry must be a positive amount",
);

const entryCommon = {
  amountMinor: positiveMoneyWireSchema,
  vehicleId: uuidSchema.optional(),
  originalDueDate: businessDateSchema.optional(),
};

/**
 * UC-09: one dated batch, never income and never an expense (W-51). Each
 * entry's required party matches DM §10.6's `kind` — a customer figure
 * needs a customer, a driver figure needs a driver, cash needs the partner
 * holding it.
 */
export const openingBalanceEntryRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("customer_due"), partyCustomerId: uuidSchema, ...entryCommon }),
  z.object({ kind: z.literal("driver_arrears"), partyDriverId: uuidSchema, ...entryCommon }),
  z.object({ kind: z.literal("owed_to_driver"), partyDriverId: uuidSchema, ...entryCommon }),
  z.object({ kind: z.literal("deposit_held"), partyDriverId: uuidSchema, ...entryCommon }),
  z.object({ kind: z.literal("advance_outstanding"), partyDriverId: uuidSchema, ...entryCommon }),
  z.object({ kind: z.literal("cash_held"), partyUserId: uuidSchema, ...entryCommon }),
]);
export type OpeningBalanceEntryRequest = z.infer<typeof openingBalanceEntryRequestSchema>;

export const commitOpeningBalanceBatchRequestSchema = z.object({
  goLiveDate: businessDateSchema,
  entries: z.array(openingBalanceEntryRequestSchema),
});
export type CommitOpeningBalanceBatchRequest = z.infer<
  typeof commitOpeningBalanceBatchRequestSchema
>;
