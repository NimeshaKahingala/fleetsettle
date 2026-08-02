import { z } from "zod";
import { uuidSchema } from "./common.js";

/** F-6.8/UC-59: every day in the window, including excused ones (§7.9) — the thing he would otherwise argue about. */
export const driverViewDaySchema = z.object({
  businessDate: z.string(),
  state: z.enum([
    "open",
    "ran_paid_full",
    "ran_paid_short",
    "ran_unpaid",
    "did_not_run",
    "paused_for_trip",
  ]),
  earnedMinor: z.string(),
  receivedMinor: z.string(),
  lostReason: z.string().nullable(),
});
export type DriverViewDay = z.infer<typeof driverViewDaySchema>;

export const driverViewTripSchema = z.object({
  id: uuidSchema,
  vehicleId: uuidSchema,
  closingDate: z.string().nullable(),
  agreedAmountMinor: z.string(),
  driverFeeMinor: z.string(),
});
export type DriverViewTrip = z.infer<typeof driverViewTripSchema>;

export const driverViewAdvanceSchema = z.object({
  id: uuidSchema,
  amountMinor: z.string(),
  issuedOn: z.string(),
  status: z.enum(["open", "part_settled", "settled"]),
});
export type DriverViewAdvance = z.infer<typeof driverViewAdvanceSchema>;

export const driverViewOffsetSchema = z.object({
  id: uuidSchema,
  amountMinor: z.string(),
  occurredOn: z.string(),
});
export type DriverViewOffset = z.infer<typeof driverViewOffsetSchema>;

export const driverViewDepositSchema = z.object({
  id: uuidSchema,
  heldMinor: z.string(),
});
export type DriverViewDeposit = z.infer<typeof driverViewDepositSchema>;

/**
 * F-6.8/UC-59/W-13: both balances, days (with excused ones), trips and fees,
 * advances, offsets, deposit — read only, INV-25. Every figure here must
 * match F-6.5's staff-facing view exactly (two people looking at one number,
 * not two memories) — this schema is deliberately built from the same wire
 * shapes (`z.string()` money, never `z.number()`) as every other resource.
 */
export const driverViewResponseSchema = z.object({
  owedToUsMinor: z.string(),
  owedByUsMinor: z.string(),
  days: z.array(driverViewDaySchema),
  trips: z.array(driverViewTripSchema),
  advances: z.array(driverViewAdvanceSchema),
  offsets: z.array(driverViewOffsetSchema),
  deposit: driverViewDepositSchema.nullable(),
});
export type DriverViewResponse = z.infer<typeof driverViewResponseSchema>;
