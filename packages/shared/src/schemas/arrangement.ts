import { z } from "zod";
import { businessDateSchema, moneyWireSchema, uuidSchema } from "./common.js";
import { leaseObligationRowSchema, odometerSourceSchema } from "./lease-billing.js";

/**
 * UC-10 / UC-09: starting arrangement A. `startDate` is preserved exactly as
 * given, never defaulted to today — UC-09 backdates this same request during
 * go-live so a lease that began on the 12th keeps billing on the 12th
 * (§7.3). `endDate` absent means open-ended (DM §6).
 */
export const startLeaseRequestSchema = z
  .object({
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
    // F-2.1 step 4: odometer at handover (INV-19) — required whenever a
    // mileage limit is set, since every later excess is measured from it.
    // eslint-disable-next-line no-restricted-syntax -- an odometer figure, not money
    odometerReadingKm: z.number().int().nonnegative().optional(),
    odometerSource: odometerSourceSchema.optional(),
    // F-2.1's own condition/handover step (W-30, W-38): a deposit taken from
    // the customer at handover — optional, since not every lease takes one,
    // and this is the row F-2.6's closure flow later settles.
    depositAmountMinor: moneyWireSchema.optional(),
  })
  .refine((v) => v.mileageDailyLimitKm === undefined || v.odometerReadingKm !== undefined, {
    message: "odometerReadingKm is required when a mileage limit is set",
    path: ["odometerReadingKm"],
  })
  .refine((v) => v.mileageDailyLimitKm === undefined || v.odometerSource !== undefined, {
    message: "odometerSource is required when a mileage limit is set",
    path: ["odometerSource"],
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

/** F-4.7/UC-36/GAP-62: "new driver from a date; previous assignment ends." The pattern and rate carry forward unchanged — only the driver and the effective date are given. */
export const changeDailyLeaseDriverRequestSchema = z.object({
  driverId: uuidSchema,
  effectiveFrom: businessDateSchema,
});
export type ChangeDailyLeaseDriverRequest = z.infer<typeof changeDailyLeaseDriverRequestSchema>;

/**
 * UC-20: starting arrangement C — bus charter and short car hire, one flow
 * (DM §8's comment on `trip`). F-5.1 step 4: "Confirm → `booked`, or `hold`
 * (ST-5) if the enquiry is tentative" — `asHold` defaults to `false`, so an
 * old client that predates GAP-7 keeps booking outright.
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
    // F-5.4 needs a baseline to compute distance against the closing
    // reading — optional, since a trip's own P&L degrades to "not
    // available" rather than blocking booking when neither is ever taken.
    // eslint-disable-next-line no-restricted-syntax -- an odometer figure, not money
    openingOdometerKm: z.number().int().nonnegative().optional(),
    openingOdometerSource: odometerSourceSchema.optional(),
    asHold: z.boolean().optional().default(false),
  })
  .refine((value) => value.endDate >= value.startDate, {
    message: "endDate must not be before startDate",
    path: ["endDate"],
  })
  .refine((v) => (v.openingOdometerKm === undefined) === (v.openingOdometerSource === undefined), {
    message: "openingOdometerKm and openingOdometerSource must be given together",
    path: ["openingOdometerSource"],
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

/** F-2.1: the same lease, plus the deposit taken at handover, if any — only the start endpoint has one to report; `getLease`/`renewLease` reuse the plain `leaseResponseSchema` above. */
export const startLeaseResponseSchema = leaseResponseSchema.extend({
  depositId: z.string().uuid().nullable(),
});
export type StartLeaseResponse = z.infer<typeof startLeaseResponseSchema>;

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

/** Home item 3 (UI §3.2): every daily lease still running, with enough of the vehicle and driver already resolved that a caller can render a day card per row without a follow-up lookup. */
export const activeDailyLeaseRowSchema = z.object({
  id: z.string().uuid(),
  vehicleId: z.string().uuid(),
  vehicleRegistration: z.string(),
  vehicleType: z.string(),
  driverId: z.string().uuid(),
  driverName: z.string(),
  dailyLeaseAmountMinor: z.string(),
});
export type ActiveDailyLeaseRow = z.infer<typeof activeDailyLeaseRowSchema>;

export const activeDailyLeasesResponseSchema = z.array(activeDailyLeaseRowSchema);
export type ActiveDailyLeasesResponse = z.infer<typeof activeDailyLeasesResponseSchema>;

/**
 * F-5.1: what booking a trip produces. `closingDate`/`cancelReason`/
 * `advanceDisposition` are nullable, not extras: `queries/trip.ts`'s own
 * `TripRow` has carried all three since P6 (`closeTripRow`/`cancelTripRow`
 * write them), but `handlers/trip.ts`'s `toResponse()` never projected them
 * onto the wire — Web-P7 found this while building the trip screen: a
 * closed or cancelled trip re-read later (`GET /{id}`) came back with no
 * way to tell the two apart from a `booked` one beyond `status` itself.
 * Fixed here, not routed around — no new query, the row already had it.
 */
export const tripResponseSchema = z.object({
  id: z.string().uuid(),
  vehicleId: z.string().uuid(),
  customerId: z.string().uuid().nullable(),
  driverId: z.string().uuid().nullable(),
  /** ST-5/GAP-7: `in_progress` is derived server-side from `startDate`/`today`, never a stored value — a `booked` trip whose range has started reads as this without a write ever happening. */
  status: z.enum(["hold", "booked", "in_progress", "closed", "cancelled"]),
  startDate: z.string(),
  endDate: z.string(),
  destination: z.string().nullable(),
  agreedAmountMinor: z.string(),
  driverFeeMinor: z.string(),
  closingDate: z.string().nullable(),
  cancelReason: z.string().nullable(),
  advanceDisposition: z.enum(["refunded", "retained"]).nullable(),
  /** GAP-7/D-13: `null` once the trip is `booked` (or later) — the only source of truth for when a hold releases. */
  holdExpiresOn: z.string().nullable(),
  /**
   * GAP-57: the `trip_fare` obligation A6 raises when there's a customer
   * and a nonzero agreed amount — `null` for a charter with no customer
   * (nothing was ever raised) or a cancelled trip (A6 voids it on cancel,
   * so it no longer counts as outstanding). The same row shape a lease's
   * own dues use (`leaseObligationRowSchema`), so `CollectPaymentSheet`
   * takes a trip's receivable exactly the way it already takes a lease's.
   */
  receivable: leaseObligationRowSchema.nullable(),
});
export type TripResponse = z.infer<typeof tripResponseSchema>;

/**
 * Home item 7 (UI §3.2): every trip still open, occupying or about to
 * occupy the vehicle — the DB filter is `status = 'booked'`, which by
 * construction excludes a `hold` (ST-5/GAP-7: tentative, not yet real) and
 * reads as `in_progress` client-side once its own `startDate` arrives
 * (`tripResponseSchema`'s own derivation), so this list means "booked, not
 * yet closed or cancelled" whether or not it has started.
 */
export const inProgressTripRowSchema = z.object({
  id: z.string().uuid(),
  vehicleId: z.string().uuid(),
  vehicleRegistration: z.string(),
  customerId: z.string().uuid().nullable(),
  customerName: z.string().nullable(),
  driverId: z.string().uuid().nullable(),
  driverName: z.string().nullable(),
  startDate: z.string(),
  endDate: z.string(),
  destination: z.string().nullable(),
});
export type InProgressTripRow = z.infer<typeof inProgressTripRowSchema>;

export const inProgressTripsResponseSchema = z.array(inProgressTripRowSchema);
export type InProgressTripsResponse = z.infer<typeof inProgressTripsResponseSchema>;

/** Vehicle overview's history tab (Web-P5): every arrangement-A period this vehicle has had, customer already resolved (IG §2 — bulk, not N+1), most recent first. */
export const vehicleLeaseHistoryRowSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["draft", "active", "closing", "closed"]),
  startDate: z.string(),
  endDate: z.string().nullable(),
  rentAmountMinor: z.string(),
  customerId: z.string().uuid(),
  customerName: z.string(),
});
export type VehicleLeaseHistoryRow = z.infer<typeof vehicleLeaseHistoryRowSchema>;

export const vehicleLeaseHistoryResponseSchema = z.array(vehicleLeaseHistoryRowSchema);
export type VehicleLeaseHistoryResponse = z.infer<typeof vehicleLeaseHistoryResponseSchema>;

/** Vehicle overview's history tab (Web-P5): every arrangement-B period this vehicle has had, driver already resolved, most recent first — unlike `activeDailyLeaseRowSchema` (Home), this includes ended periods too. */
export const vehicleDailyLeaseHistoryRowSchema = z.object({
  id: z.string().uuid(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable(),
  dailyLeaseAmountMinor: z.string(),
  driverId: z.string().uuid(),
  driverName: z.string(),
});
export type VehicleDailyLeaseHistoryRow = z.infer<typeof vehicleDailyLeaseHistoryRowSchema>;

export const vehicleDailyLeaseHistoryResponseSchema = z.array(vehicleDailyLeaseHistoryRowSchema);
export type VehicleDailyLeaseHistoryResponse = z.infer<
  typeof vehicleDailyLeaseHistoryResponseSchema
>;

/** GAP-77: a vehicle's own trip history was unreachable — no read existed. Every status, most recent first; party names resolved the same way `inProgressTripRowSchema` already does. */
export const vehicleTripHistoryRowSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["hold", "booked", "in_progress", "closed", "cancelled"]),
  startDate: z.string(),
  endDate: z.string(),
  destination: z.string().nullable(),
  customerId: z.string().uuid().nullable(),
  customerName: z.string().nullable(),
  driverId: z.string().uuid().nullable(),
  driverName: z.string().nullable(),
  agreedAmountMinor: z.string(),
});
export type VehicleTripHistoryRow = z.infer<typeof vehicleTripHistoryRowSchema>;

export const vehicleTripHistoryResponseSchema = z.array(vehicleTripHistoryRowSchema);
export type VehicleTripHistoryResponse = z.infer<typeof vehicleTripHistoryResponseSchema>;
