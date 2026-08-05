import { z } from "zod";
import { businessDateSchema, moneyWireSchema, uuidSchema } from "./common.js";

const positiveMoneyWireSchema = moneyWireSchema.refine((v) => v > 0n, {
  message: "amountMinor must be greater than zero",
});

/** F-6.3/UC-53: money handed to the driver up front — not a cost (§1.5) until it is settled. */
export const issueAdvanceRequestSchema = z.object({
  driverId: uuidSchema,
  tripId: uuidSchema.optional(),
  amountMinor: positiveMoneyWireSchema,
  issuedOn: businessDateSchema,
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
});
export type AdvanceResponse = z.infer<typeof advanceResponseSchema>;

/** The advance closes at zero: what he spent, what he returned, anything agreed to keep as fee. */
export const settleAdvanceRequestSchema = z.object({
  kind: z.enum(["spent", "returned", "kept_as_fee"]),
  amountMinor: positiveMoneyWireSchema,
  occurredOn: businessDateSchema,
});
export type SettleAdvanceRequest = z.infer<typeof settleAdvanceRequestSchema>;

/** F-6.7/UC-58/W-8: recorded as money held, never income (INV-4). */
export const takeDriverDepositRequestSchema = z.object({
  driverId: uuidSchema,
  amountMinor: positiveMoneyWireSchema,
  occurredOn: businessDateSchema,
});
export type TakeDriverDepositRequest = z.infer<typeof takeDriverDepositRequestSchema>;

export const depositMovementRequestSchema = z.object({
  movementType: z.enum(["topped_up", "reduced", "applied", "refunded", "retained"]),
  amountMinor: positiveMoneyWireSchema,
  occurredOn: businessDateSchema,
  reason: z.string().trim().max(500).optional(),
});
export type DepositMovementRequest = z.infer<typeof depositMovementRequestSchema>;

export const depositResponseSchema = z.object({
  id: z.string().uuid(),
  partyDriverId: z.string().uuid(),
  status: z.enum(["held", "hold_window", "released", "applied", "retained"]),
  heldMinor: z.string(),
});
export type DepositResponse = z.infer<typeof depositResponseSchema>;

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
});
export type CreateOffsetRequest = z.infer<typeof createOffsetRequestSchema>;

export const offsetResponseSchema = z.object({
  id: z.string().uuid(),
  driverId: z.string().uuid(),
  amountMinor: z.string(),
  occurredOn: z.string(),
  note: z.string().nullable(),
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
