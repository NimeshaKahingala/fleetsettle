import { z } from "zod";
import { businessDateSchema } from "./common.js";
import { dayRecordStateSchema } from "./day-record.js";
import { odometerSourceSchema } from "./lease-billing.js";

/**
 * F-5.4/UC-44/W-41: closing odometer, remaining costs, then close. Income
 * and cost both recognise on this date, never on booking (W-41) — a charter
 * running 28 Jul–3 Aug is August's.
 */
export const closeTripRequestSchema = z
  .object({
    closingDate: businessDateSchema,
    // eslint-disable-next-line no-restricted-syntax -- an odometer figure, not money
    closingOdometerKm: z.number().int().nonnegative().optional(),
    closingOdometerSource: odometerSourceSchema.optional(),
  })
  .refine((v) => (v.closingOdometerKm === undefined) === (v.closingOdometerSource === undefined), {
    message: "closingOdometerKm and closingOdometerSource must be given together",
    path: ["closingOdometerSource"],
  });
export type CloseTripRequest = z.infer<typeof closeTripRequestSchema>;

export const tripCostByCategorySchema = z.object({
  category: z.string(),
  amountMinor: z.string(),
});
export type TripCostByCategory = z.infer<typeof tripCostByCategorySchema>;

/** F-5.4/UC-44: income, costs by type, profit, distance, fuel efficiency — each degrading to `null` ("not available", W-56) rather than a misleading zero when its inputs are missing. */
export const closedTripResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.literal("closed"),
  closingDate: z.string(),
  incomeMinor: z.string(),
  costsMinor: z.string(),
  costsByCategory: z.array(tripCostByCategorySchema),
  driverFeeMinor: z.string(),
  profitMinor: z.string(),
  // eslint-disable-next-line no-restricted-syntax -- kilometres, not money
  distanceKm: z.number().nullable(),
  // eslint-disable-next-line no-restricted-syntax -- litres, a fuel volume, not money
  litres: z.number().nullable(),
  // eslint-disable-next-line no-restricted-syntax -- a fuel-efficiency ratio, not money
  kmPerLitre: z.number().nullable(),
});
export type ClosedTripResponse = z.infer<typeof closedTripResponseSchema>;

/**
 * F-5.5/UC-45: cancellation itself never blocks — an advance still open
 * against the trip must be given a disposition (refunded, or retained as
 * income) so the choice is recorded, not just the fact of cancelling.
 */
export const cancelTripRequestSchema = z.object({
  cancelReason: z.string().trim().max(500).optional(),
  advanceDisposition: z.enum(["refunded", "retained"]).optional(),
});
export type CancelTripRequest = z.infer<typeof cancelTripRequestSchema>;

export const cancelledTripResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.literal("cancelled"),
  cancelReason: z.string().nullable(),
  advanceDisposition: z.enum(["refunded", "retained"]).nullable(),
});
export type CancelledTripResponse = z.infer<typeof cancelledTripResponseSchema>;

/**
 * UC-95: one row per occupied day — an absent date is not scheduled (DM §2:
 * "a single indexed range scan"). `dayRecordState` is only ever set for
 * arrangement B (Web-P5's calendar screen, UI §7.6, needs "ran" vs "lost,"
 * which occupancy alone can't tell apart) — `null` for arrangement A/C, and
 * for a B day the 90-day generation horizon hasn't reached yet.
 */
export const vehicleCalendarDaySchema = z.object({
  businessDate: z.string(),
  arrangement: z.enum(["A", "B", "C"]),
  sourceType: z.string(),
  sourceId: z.string().uuid(),
  isHold: z.boolean(),
  dayRecordState: dayRecordStateSchema.nullable(),
});
export type VehicleCalendarDay = z.infer<typeof vehicleCalendarDaySchema>;

export const vehicleCalendarResponseSchema = z.array(vehicleCalendarDaySchema);
export type VehicleCalendarResponse = z.infer<typeof vehicleCalendarResponseSchema>;
