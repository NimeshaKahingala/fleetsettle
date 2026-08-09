import { addDays, newId, type BusinessDate } from "@fleetsettle/shared";
import type { Writer } from "../db/client.js";
import { isUniqueViolation } from "../db/pg-error.js";
import {
  NotFoundError,
  ValidationError,
  VehicleAlreadyExistsError,
  VehicleArrangementChangeBlockedError,
} from "../errors/app-error.js";
import { endDailyLeaseRow, findCurrentDailyLeaseRowForVehicle } from "../queries/dailyLease.js";
import { findOpenLeaseForVehicle } from "../queries/lease.js";
import { findOpenTripForVehicle } from "../queries/trip.js";
import {
  endVehicleArrangementRow,
  findCurrentVehicleArrangementRow,
  insertVehicle,
  insertVehicleArrangement,
  upsertVehicleDocument,
} from "../queries/vehicle.js";

export interface CreateVehicleInput {
  businessId: string;
  registration: string;
  vehicleType: string;
  defaultArrangement: "A" | "B" | "C";
  insuranceExpiry?: BusinessDate;
  registrationExpiry?: BusinessDate;
  /** Injected — `businessToday()` is the one sanctioned clock read, and it belongs to the handler (IG §4.5). */
  today: BusinessDate;
}

export interface CreatedVehicle {
  vehicleId: string;
}

/**
 * F-1.1 / UC-01, one transaction: the vehicle, its opening `vehicle_arrangement`
 * row (effective from today, open-ended — F-1.2 is what ever closes it), and
 * — the one thing worth entering on the same form because it is the one
 * field that costs money by being blank — insurance and registration expiry,
 * each upserted into `vehicle_document` only if given (DM §16: `vehicle`,
 * `vehicle_arrangement`, `vehicle_document`).
 */
export async function createVehicle(
  writer: Writer,
  input: CreateVehicleInput,
): Promise<CreatedVehicle> {
  try {
    return await writer.transaction(async (tx) => {
      const vehicleId = newId();
      await insertVehicle(tx, {
        id: vehicleId,
        businessId: input.businessId,
        registration: input.registration,
        vehicleType: input.vehicleType,
      });

      await insertVehicleArrangement(tx, {
        id: newId(),
        vehicleId,
        arrangement: input.defaultArrangement,
        effectiveFrom: input.today,
      });

      if (input.insuranceExpiry !== undefined) {
        await upsertVehicleDocument(tx, {
          id: newId(),
          vehicleId,
          docType: "insurance",
          expiryDate: input.insuranceExpiry,
        });
      }
      if (input.registrationExpiry !== undefined) {
        await upsertVehicleDocument(tx, {
          id: newId(),
          vehicleId,
          docType: "registration",
          expiryDate: input.registrationExpiry,
        });
      }

      return { vehicleId };
    });
  } catch (err) {
    if (isUniqueViolation(err, "vehicle_business_id_registration_key")) {
      throw new VehicleAlreadyExistsError();
    }
    throw err;
  }
}

export interface ChangeVehicleArrangementInput {
  vehicleId: string;
  arrangement: "A" | "B" | "C";
  effectiveFrom: BusinessDate;
}

export interface ChangedVehicleArrangement {
  id: string;
  vehicleId: string;
  arrangement: "A" | "B" | "C";
  effectiveFrom: string;
  effectiveTo: string | null;
}

/**
 * F-1.2/UC-94/GAP-54, one transaction: the row is never overwritten
 * (`createVehicle`'s own doc comment named this function as what ever
 * closes the opening arrangement). **Pre** (UC-94): no open lease or trip
 * conflicting with the effective date.
 *
 * The two arrangements this can close behave differently, deliberately:
 * moving off **A** refuses outright if a lease is not yet `closed` — a
 * lease carries a deposit/mileage/billing commitment only F-2.6's own
 * multi-step flow may unwind. Moving off **B** closes the current
 * `daily_lease` automatically — it is bookkeeping-only, nothing money-
 * committing happens by leaving it open, and this is F-1.2's own "daily
 * cards stop" — `generate-day-cards` (P13) never reads `vehicle_arrangement`
 * at all, only whether a `daily_lease` row is still open, so closing it here
 * is the only thing that actually stops cards from continuing to generate.
 *
 * Ordering matters in both closes: the old row's `UPDATE` must land before
 * the new row's `INSERT` in the same transaction — `vehicle_arrangement`'s
 * exclusion constraint (like `daily_lease`'s) is not deferred, so the old
 * range has to stop overlapping first.
 */
export async function changeVehicleArrangement(
  writer: Writer,
  input: ChangeVehicleArrangementInput,
): Promise<ChangedVehicleArrangement> {
  return await writer.transaction(async (tx) => {
    const current = await findCurrentVehicleArrangementRow(tx, input.vehicleId);
    if (!current) throw new NotFoundError("This vehicle has no current arrangement");
    if (current.arrangement === input.arrangement) {
      throw new ValidationError("This vehicle is already configured for this arrangement");
    }
    if (input.effectiveFrom <= current.effectiveFrom) {
      throw new ValidationError(
        "effectiveFrom must be after the current arrangement's own start date",
      );
    }

    const openLease = await findOpenLeaseForVehicle(tx, input.vehicleId);
    if (openLease) {
      throw new VehicleArrangementChangeBlockedError(
        "This vehicle has a lease that is not yet closed — close it first (F-2.6)",
      );
    }
    const openTrip = await findOpenTripForVehicle(tx, input.vehicleId, input.effectiveFrom);
    if (openTrip) {
      throw new VehicleArrangementChangeBlockedError(
        "This vehicle has an open trip covering the effective date",
      );
    }

    if (current.arrangement === "B" && input.arrangement !== "B") {
      const openDailyLease = await findCurrentDailyLeaseRowForVehicle(tx, input.vehicleId);
      if (openDailyLease) {
        if (input.effectiveFrom <= openDailyLease.effectiveFrom) {
          throw new ValidationError(
            "effectiveFrom must be after the current daily lease's own start date",
          );
        }
        await endDailyLeaseRow(tx, openDailyLease.id, addDays(input.effectiveFrom, -1));
      }
    }

    await endVehicleArrangementRow(tx, current.id, addDays(input.effectiveFrom, -1));

    const newArrangementId = newId();
    await insertVehicleArrangement(tx, {
      id: newArrangementId,
      vehicleId: input.vehicleId,
      arrangement: input.arrangement,
      effectiveFrom: input.effectiveFrom,
    });

    return {
      id: newArrangementId,
      vehicleId: input.vehicleId,
      arrangement: input.arrangement,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: null,
    };
  });
}
