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

/**
 * The same shape backs two calls (route-defs/opening-balance.ts): a plain
 * save (`PUT`, stays draft) and a confirm (`POST .../commit`, also flips
 * `status`) — F-0.2's "save as a draft and come back" alternate is not a
 * different payload, only a different verb.
 */
export const commitOpeningBalanceBatchRequestSchema = z.object({
  goLiveDate: businessDateSchema,
  entries: z.array(openingBalanceEntryRequestSchema),
});
export type CommitOpeningBalanceBatchRequest = z.infer<
  typeof commitOpeningBalanceBatchRequestSchema
>;

const entryResponseCommon = {
  id: uuidSchema,
  amountMinor: z.string(),
  vehicleId: uuidSchema.nullable(),
  originalDueDate: z.string().nullable(),
};

export const openingBalanceEntryResponseSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("customer_due"),
    partyCustomerId: uuidSchema,
    ...entryResponseCommon,
  }),
  z.object({
    kind: z.literal("driver_arrears"),
    partyDriverId: uuidSchema,
    ...entryResponseCommon,
  }),
  z.object({
    kind: z.literal("owed_to_driver"),
    partyDriverId: uuidSchema,
    ...entryResponseCommon,
  }),
  z.object({ kind: z.literal("deposit_held"), partyDriverId: uuidSchema, ...entryResponseCommon }),
  z.object({
    kind: z.literal("advance_outstanding"),
    partyDriverId: uuidSchema,
    ...entryResponseCommon,
  }),
  z.object({ kind: z.literal("cash_held"), partyUserId: uuidSchema, ...entryResponseCommon }),
]);
export type OpeningBalanceEntryResponse = z.infer<typeof openingBalanceEntryResponseSchema>;

/** F-0.2: the batch plus every entry currently on it. */
export const openingBalanceBatchResponseSchema = z.object({
  id: uuidSchema,
  goLiveDate: z.string(),
  status: z.enum(["draft", "committed"]),
  committedAt: z.string().nullable(),
  entries: z.array(openingBalanceEntryResponseSchema),
});
export type OpeningBalanceBatchResponse = z.infer<typeof openingBalanceBatchResponseSchema>;
