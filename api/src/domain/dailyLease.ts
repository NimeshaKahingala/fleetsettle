import { addDays, newId, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { Writer } from "../db/client.js";
import { isExclusionViolation } from "../db/pg-error.js";
import { DailyLeaseOverlapsError, NotFoundError, ValidationError } from "../errors/app-error.js";
import {
  endDailyLeaseRow,
  findCurrentDailyLeaseRate,
  findDailyLeaseForBusiness,
  insertDailyLease,
  insertDailyLeaseRate,
} from "../queries/dailyLease.js";

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

export interface ChangeDailyLeaseDriverInput {
  businessId: string;
  dailyLeaseId: string;
  newDriverId: string;
  effectiveFrom: BusinessDate;
}

export interface ChangedDailyLeaseDriver {
  id: string;
  vehicleId: string;
  driverId: string;
  patternType: "every_day" | "alternate" | "weekdays";
  patternWeekdays: number[] | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  dailyLeaseAmountMinor: bigint;
}

/**
 * F-4.7/UC-36/GAP-62, one transaction: "new driver from a date; previous
 * assignment ends." The row is never overwritten (CLAUDE.md → Writes) — the
 * current row's `effective_to` is closed the day before, and a fresh
 * `daily_lease`/`daily_lease_rate` pair opens on `effectiveFrom`, carrying
 * the pattern and rate forward unchanged (F-4.7 names only the driver and
 * the date). History stays attached to whoever was actually driving:
 * `day_record` carries its own `driver_id`, so nothing here needs to touch
 * past rows. The close must land before the new row's `INSERT` — the
 * exclusion constraint is not deferred, so the old range has to stop
 * overlapping first (contrast `assert_shares_total`, which is).
 */
export async function changeDailyLeaseDriver(
  writer: Writer,
  input: ChangeDailyLeaseDriverInput,
): Promise<ChangedDailyLeaseDriver> {
  try {
    return await writer.transaction(async (tx) => {
      const current = await findDailyLeaseForBusiness(tx, input.businessId, input.dailyLeaseId);
      if (!current) throw new NotFoundError("No such daily lease in this business");
      if (current.effectiveTo !== null) {
        throw new ValidationError("This daily lease has already ended");
      }
      if (input.effectiveFrom <= current.effectiveFrom) {
        throw new ValidationError("effectiveFrom must be after this assignment's own start date");
      }

      const rate = await findCurrentDailyLeaseRate(tx, input.dailyLeaseId);
      if (!rate) throw new NotFoundError("No current rate for this daily lease");

      const closesOn = addDays(input.effectiveFrom, -1);
      await endDailyLeaseRow(tx, input.dailyLeaseId, closesOn);

      const newDailyLeaseId = newId();
      await insertDailyLease(tx, {
        id: newDailyLeaseId,
        businessId: input.businessId,
        vehicleId: current.vehicleId,
        driverId: input.newDriverId,
        patternType: current.patternType,
        ...(current.patternWeekdays !== null ? { patternWeekdays: current.patternWeekdays } : {}),
        effectiveFrom: input.effectiveFrom,
      });
      await insertDailyLeaseRate(tx, {
        id: newId(),
        dailyLeaseId: newDailyLeaseId,
        dailyLeaseAmountMinor: rate.dailyLeaseAmountMinor,
        effectiveFrom: input.effectiveFrom,
      });

      return {
        id: newDailyLeaseId,
        vehicleId: current.vehicleId,
        driverId: input.newDriverId,
        patternType: current.patternType,
        patternWeekdays: current.patternWeekdays,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: null,
        dailyLeaseAmountMinor: rate.dailyLeaseAmountMinor,
      };
    });
  } catch (err) {
    if (isExclusionViolation(err, "daily_lease_vehicle_id_daterange_excl")) {
      throw new DailyLeaseOverlapsError();
    }
    throw err;
  }
}
