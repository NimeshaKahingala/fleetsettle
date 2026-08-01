import { addDays, newId, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { Writer } from "../db/client.js";
import { isUniqueViolation } from "../db/pg-error.js";
import { VehicleDoubleBookedError } from "../errors/app-error.js";
import { insertAllocationDays, insertTrip } from "../queries/trip.js";

export interface BookTripInput {
  businessId: string;
  vehicleId: string;
  customerId?: string;
  driverId?: string;
  startDate: BusinessDate;
  endDate: BusinessDate;
  destination?: string;
  agreedAmountMinor: Minor;
  driverFeeMinor: Minor;
}

export interface BookedTrip {
  tripId: string;
}

/** Every day in `[start, end]`, inclusive of both ends (W-54) — never open-ended, unlike a lease's horizon. */
function dateRange(start: BusinessDate, end: BusinessDate): BusinessDate[] {
  const dates: BusinessDate[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    dates.push(d);
  }
  return dates;
}

/**
 * F-5.1 / UC-20, one transaction: the `trip` row and its full-range
 * `vehicle_day_allocation` (DM §4.1: a trip's allocation is always written in
 * full at booking, unlike a lease or daily lease's rolling horizon). INV-1 —
 * "the car cannot also be on a monthly rental for those dates" — is the
 * `one_arrangement_per_vehicle_day` unique index, not a pre-check; a
 * violation is caught here and mapped to 409.
 *
 * Does not touch `day_record` — DM §4.1's "pause the existing day records"
 * step needs the `day_record` table, which P3 builds. A trip booked in P2
 * against a vehicle with no daily-lease cards yet has nothing to pause.
 */
export async function bookTrip(writer: Writer, input: BookTripInput): Promise<BookedTrip> {
  try {
    return await writer.transaction(async (tx) => {
      const tripId = newId();
      await insertTrip(tx, {
        id: tripId,
        businessId: input.businessId,
        vehicleId: input.vehicleId,
        ...(input.customerId !== undefined ? { customerId: input.customerId } : {}),
        ...(input.driverId !== undefined ? { driverId: input.driverId } : {}),
        status: "booked",
        startDate: input.startDate,
        endDate: input.endDate,
        ...(input.destination !== undefined ? { destination: input.destination } : {}),
        agreedAmountMinor: input.agreedAmountMinor,
        driverFeeMinor: input.driverFeeMinor,
      });

      const days = dateRange(input.startDate, input.endDate).map((businessDate) => ({
        id: newId(),
        businessId: input.businessId,
        vehicleId: input.vehicleId,
        businessDate,
        arrangement: "C" as const,
        sourceType: "trip" as const,
        sourceId: tripId,
      }));
      await insertAllocationDays(tx, days);

      return { tripId };
    });
  } catch (err) {
    if (isUniqueViolation(err, "one_arrangement_per_vehicle_day")) {
      throw new VehicleDoubleBookedError();
    }
    throw err;
  }
}
