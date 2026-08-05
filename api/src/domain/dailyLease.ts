import { newId, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { Writer } from "../db/client.js";
import { isExclusionViolation } from "../db/pg-error.js";
import { DailyLeaseOverlapsError } from "../errors/app-error.js";
import { insertDailyLease, insertDailyLeaseRate } from "../queries/dailyLease.js";

export interface StartDailyLeaseInput {
  businessId: string;
  vehicleId: string;
  driverId: string;
  patternType: "every_day" | "alternate" | "weekdays";
  patternWeekdays?: number[];
  effectiveFrom: BusinessDate;
  effectiveTo?: BusinessDate;
  dailyLeaseAmountMinor: Minor;
}

export interface StartedDailyLease {
  dailyLeaseId: string;
}

/**
 * F-1.7 / UC-05, one transaction: `daily_lease` and its first `daily_lease_rate`
 * (DM §7). No `vehicle_day_allocation` or `day_record` here — DM §4.1 attributes
 * both, explicitly, to `generate-day-cards`, a rolling-horizon cron job (P13),
 * not the setup step that creates the arrangement. Recorded here rather than
 * silently skipped.
 */
export async function startDailyLease(
  writer: Writer,
  input: StartDailyLeaseInput,
): Promise<StartedDailyLease> {
  try {
    return await writer.transaction(async (tx) => {
      const dailyLeaseId = newId();
      await insertDailyLease(tx, {
        id: dailyLeaseId,
        businessId: input.businessId,
        vehicleId: input.vehicleId,
        driverId: input.driverId,
        patternType: input.patternType,
        ...(input.patternWeekdays !== undefined ? { patternWeekdays: input.patternWeekdays } : {}),
        effectiveFrom: input.effectiveFrom,
        ...(input.effectiveTo !== undefined ? { effectiveTo: input.effectiveTo } : {}),
      });

      await insertDailyLeaseRate(tx, {
        id: newId(),
        dailyLeaseId,
        dailyLeaseAmountMinor: input.dailyLeaseAmountMinor,
        effectiveFrom: input.effectiveFrom,
      });

      return { dailyLeaseId };
    });
  } catch (err) {
    if (isExclusionViolation(err, "daily_lease_vehicle_id_daterange_excl")) {
      throw new DailyLeaseOverlapsError();
    }
    throw err;
  }
}
