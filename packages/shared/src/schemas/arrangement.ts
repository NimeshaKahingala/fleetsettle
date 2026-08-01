import { z } from "zod";
import { businessDateSchema, moneyWireSchema, uuidSchema } from "./common.js";

/**
 * UC-10 / UC-09: starting arrangement A. `startDate` is preserved exactly as
 * given, never defaulted to today — UC-09 backdates this same request during
 * go-live so a lease that began on the 12th keeps billing on the 12th
 * (§7.3). `endDate` absent means open-ended (DM §6).
 */
export const startLeaseRequestSchema = z.object({
  vehicleId: uuidSchema,
  customerId: uuidSchema,
  startDate: businessDateSchema,
  endDate: businessDateSchema.optional(),
  // eslint-disable-next-line no-restricted-syntax -- day-of-month, not money
  billingDay: z.number().int().min(1).max(31),
  rentAmountMinor: moneyWireSchema,
  // eslint-disable-next-line no-restricted-syntax -- kilometres, not money
  mileageDailyLimitKm: z.number().int().positive().optional(),
  mileageExcessRateMinor: moneyWireSchema.optional(),
  // eslint-disable-next-line no-restricted-syntax -- a day count, not money
  reminderDaysBefore: z.number().int().min(0).optional(),
});
export type StartLeaseRequest = z.infer<typeof startLeaseRequestSchema>;

/** UC-05: starting arrangement B — the recurring pattern, not a single day. */
export const startDailyLeaseRequestSchema = z
  .object({
    vehicleId: uuidSchema,
    driverId: uuidSchema,
    patternType: z.enum(["every_day", "alternate", "weekdays"]),
    // eslint-disable-next-line no-restricted-syntax -- weekday indices 0–6, not money
    patternWeekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
    effectiveFrom: businessDateSchema,
    effectiveTo: businessDateSchema.optional(),
    dailyLeaseAmountMinor: moneyWireSchema,
  })
  .superRefine((value, ctx) => {
    if (value.patternType === "weekdays" && !value.patternWeekdays) {
      ctx.addIssue({
        code: "custom",
        message: "patternWeekdays is required when patternType is 'weekdays'",
        path: ["patternWeekdays"],
      });
    }
  });
export type StartDailyLeaseRequest = z.infer<typeof startDailyLeaseRequestSchema>;

/**
 * UC-20: starting arrangement C — bus charter and short car hire, one flow
 * (DM §8's comment on `trip`). `status` defaults to 'booked': P2 books a
 * trip outright rather than modelling the separate 'hold' (tentative,
 * non-occupying, ST-5) state, which is a UI affordance this phase does not
 * build a screen for yet.
 */
export const bookTripRequestSchema = z
  .object({
    vehicleId: uuidSchema,
    customerId: uuidSchema.optional(),
    driverId: uuidSchema.optional(),
    startDate: businessDateSchema,
    endDate: businessDateSchema,
    destination: z.string().trim().max(200).optional(),
    agreedAmountMinor: moneyWireSchema.optional(),
    driverFeeMinor: moneyWireSchema.optional(),
  })
  .refine((value) => value.endDate >= value.startDate, {
    message: "endDate must not be before startDate",
    path: ["endDate"],
  });
export type BookTripRequest = z.infer<typeof bookTripRequestSchema>;

/** F-2.1: what starting a lease produces. */
export const leaseResponseSchema = z.object({
  id: z.string().uuid(),
  vehicleId: z.string().uuid(),
  customerId: z.string().uuid(),
  status: z.enum(["draft", "active", "closing", "closed"]),
  startDate: z.string(),
  endDate: z.string().nullable(),
  // eslint-disable-next-line no-restricted-syntax -- day-of-month, not money
  billingDay: z.number(),
  rentAmountMinor: z.string(),
  // eslint-disable-next-line no-restricted-syntax -- kilometres, not money
  mileageDailyLimitKm: z.number().nullable(),
  mileageExcessRateMinor: z.string().nullable(),
  // eslint-disable-next-line no-restricted-syntax -- a day count, not money
  reminderDaysBefore: z.number(),
});
export type LeaseResponse = z.infer<typeof leaseResponseSchema>;

/** F-1.7: what setting up the daily lease produces. */
export const dailyLeaseResponseSchema = z.object({
  id: z.string().uuid(),
  vehicleId: z.string().uuid(),
  driverId: z.string().uuid(),
  patternType: z.enum(["every_day", "alternate", "weekdays"]),
  // eslint-disable-next-line no-restricted-syntax -- weekday indices 0–6, not money
  patternWeekdays: z.array(z.number()).nullable(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable(),
  dailyLeaseAmountMinor: z.string(),
});
export type DailyLeaseResponse = z.infer<typeof dailyLeaseResponseSchema>;

/** F-5.1: what booking a trip produces. */
export const tripResponseSchema = z.object({
  id: z.string().uuid(),
  vehicleId: z.string().uuid(),
  customerId: z.string().uuid().nullable(),
  driverId: z.string().uuid().nullable(),
  status: z.enum(["hold", "booked", "in_progress", "closed", "cancelled"]),
  startDate: z.string(),
  endDate: z.string(),
  destination: z.string().nullable(),
  agreedAmountMinor: z.string(),
  driverFeeMinor: z.string(),
});
export type TripResponse = z.infer<typeof tripResponseSchema>;
