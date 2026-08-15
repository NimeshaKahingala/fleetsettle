import { addDays, newId, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { Writer } from "../db/client.js";
import { isExclusionViolation } from "../db/pg-error.js";
import { materializeDailyLeaseHorizon } from "./day-card-generation.js";
import { findOpenPeriodRow } from "../queries/accounting-period.js";
import { DailyLeaseOverlapsError, NotFoundError, ValidationError } from "../errors/app-error.js";
import { voidFutureOpenDayRecordsForLease } from "../queries/day-record.js";
import {
  endDailyLeaseRow,
  findCurrentDailyLeaseRate,
  findDailyLeaseForBusiness,
  insertDailyLease,
  insertDailyLeaseRate,
  releaseDailyLeaseAllocationsAfter,
} from "../queries/dailyLease.js";
import { releaseExpiredHolds } from "../queries/trip.js";
import { restoreDailyLeaseOccupancy } from "./trip.js";

export interface StartDailyLeaseInput {
  businessId: string;
  vehicleId: string;
  driverId: string;
  patternType: "every_day" | "alternate" | "weekdays";
  patternWeekdays?: number[];
  effectiveFrom: BusinessDate;
  effectiveTo?: BusinessDate;
  dailyLeaseAmountMinor: Minor;
  /** Injected — `businessToday()` is the one sanctioned clock read, and it belongs to the handler (IG §4.5). Drives how far the synchronous materialisation below reaches. */
  today: BusinessDate;
  /** GAP-7: attributed on this vehicle's own released expired holds, the same way any other void names who did it. */
  userId: string;
}

export interface StartedDailyLease {
  dailyLeaseId: string;
}

/**
 * F-1.7 / UC-05, one transaction: `daily_lease`, its first `daily_lease_rate`
 * (DM §7), and — since D-9/GAP-88 — the rolling 90-day horizon of
 * `vehicle_day_allocation`/`day_record` rows itself, using the identical
 * write `generate-day-cards` runs nightly. DM §4.1 used to assign that write
 * solely to the cron; a lease started today was invisible to the calendar,
 * the trip-booking conflict check and the lost-days report for up to the
 * ~24 hours until the next run, which is exactly what CLAUDE.md's "no cron
 * is a prerequisite for a user action" forbids. The cron's role is now to
 * extend the horizon forward each night, not to originate the fact.
 */
export async function startDailyLease(
  writer: Writer,
  input: StartDailyLeaseInput,
): Promise<StartedDailyLease> {
  try {
    return await writer.transaction(async (tx) => {
      // GAP-7: this vehicle's own expired holds release before the horizon
      // below claims their dates — the same synchronous-ahead-of-conflict
      // relationship `bookTrip` gives its own booking.
      const releasedHolds = await releaseExpiredHolds(
        tx,
        input.today,
        input.vehicleId,
        input.userId,
      );
      // GAP-7: undo any calendar hole the just-released hold(s) left in
      // whatever daily lease was current on this vehicle before this new one
      // — the horizon materialised below only ever fills forward from
      // `input.today`, so a hold whose dates fell before today is not
      // otherwise re-covered.
      await restoreDailyLeaseOccupancy(tx, releasedHolds.affected, input.today);

      const dailyLeaseId = newId();
      const effectiveTo = input.effectiveTo ?? null;
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

      const openPeriod = (await findOpenPeriodRow(tx, input.businessId)) ?? null;
      await materializeDailyLeaseHorizon(
        tx,
        {
          id: dailyLeaseId,
          businessId: input.businessId,
          vehicleId: input.vehicleId,
          driverId: input.driverId,
          patternType: input.patternType,
          patternWeekdays: input.patternWeekdays ?? null,
          effectiveFrom: input.effectiveFrom,
          effectiveTo,
        },
        [
          {
            dailyLeaseAmountMinor: input.dailyLeaseAmountMinor,
            effectiveFrom: input.effectiveFrom,
            effectiveTo: null,
          },
        ],
        openPeriod,
        input.today,
      );

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
  /** Injected — `businessToday()` (IG §4.5). Same D-9/GAP-88 materialisation as `startDailyLease`: the reassigned daily lease is a new `daily_lease` row and would otherwise be just as invisible until the next cron run. */
  today: BusinessDate;
  /** GAP-118: attributed on the old lease's voided allocations/day-records the same way every other void trio is (CLAUDE.md → Writes: append-only, an actor recorded). */
  userId: string;
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

      // GAP-118: the old lease's future occupancy and cards, freed before the
      // new lease's own materialisation below — `listAllocatedDatesForVehicle`'s
      // `existing.has(d)` guard would otherwise read the old lease's rows as
      // "already there" and silently skip every one of these dates.
      await releaseDailyLeaseAllocationsAfter(
        tx,
        input.dailyLeaseId,
        closesOn,
        "Daily lease driver changed",
        input.userId,
      );
      await voidFutureOpenDayRecordsForLease(
        tx,
        input.dailyLeaseId,
        closesOn,
        "Daily lease driver changed",
        input.userId,
      );

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

      const openPeriod = (await findOpenPeriodRow(tx, input.businessId)) ?? null;
      await materializeDailyLeaseHorizon(
        tx,
        {
          id: newDailyLeaseId,
          businessId: input.businessId,
          vehicleId: current.vehicleId,
          driverId: input.newDriverId,
          patternType: current.patternType,
          patternWeekdays: current.patternWeekdays,
          effectiveFrom: input.effectiveFrom,
          effectiveTo: null,
        },
        [
          {
            dailyLeaseAmountMinor: rate.dailyLeaseAmountMinor,
            effectiveFrom: input.effectiveFrom,
            effectiveTo: null,
          },
        ],
        openPeriod,
        input.today,
      );

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
