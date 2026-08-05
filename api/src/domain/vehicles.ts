import { newId, type BusinessDate } from "@fleetsettle/shared";
import type { Writer } from "../db/client.js";
import { isUniqueViolation } from "../db/pg-error.js";
import { VehicleAlreadyExistsError } from "../errors/app-error.js";
import {
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
