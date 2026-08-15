import { addDays, newId, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { Writer } from "../db/client.js";
import {
  isExclusionViolation,
  isPeriodClosedViolation,
  isUniqueViolation,
} from "../db/pg-error.js";
import { materializeDailyLeaseHorizon } from "./day-card-generation.js";
import { findOpenPeriodRow } from "../queries/accounting-period.js";
import {
  DailyLeaseOverlapsError,
  LeaseDayAlreadyConfirmedError,
  LeaseDayAlreadyExceptedError,
  LeaseDayExceptionAlreadyVoidedError,
  NotFoundError,
  PeriodClosedError,
  ValidationError,
} from "../errors/app-error.js";
import {
  findDayRecordByLeaseAndDate,
  repriceFutureOpenDayRecords,
  voidFutureOpenDayRecordsForLease,
  voidOpenDayRecordForDate,
} from "../queries/day-record.js";
import {
  endDailyLeaseRateRow,
  endDailyLeaseRow,
  findCurrentDailyLeaseRate,
  findDailyLeaseForBusiness,
  findLeaseDayExceptionForBusiness,
  insertDailyLease,
  insertDailyLeaseRate,
  insertLeaseDayException,
  releaseDailyLeaseAllocationsAfter,
  voidAllocationForDailyLeaseDate,
  voidLeaseDayExceptionRow,
  type LeaseDayExceptionRow,
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

export interface EndDailyLeaseInput {
  businessId: string;
  dailyLeaseId: string;
  effectiveTo: BusinessDate;
  /** GAP-118's own actor, on this close's own void trio (CLAUDE.md → Writes: append-only, an actor recorded). */
  userId: string;
}

export type EndedDailyLease = ChangedDailyLeaseDriver;

/**
 * F-4.8/UC-101/GAP-25, one transaction: **distinct from F-4.7** — nothing
 * replaces this assignment, so there is no new `daily_lease` row to open
 * behind it, only the same GAP-118 close-out `changeDailyLeaseDriver` and
 * `changeVehicleArrangement` already both make on their own way off B.
 * **INV-37**: no check against the driver's own balance — F-1.11's archive
 * refusal (INV-35) protects against a driver dropping out of every list
 * with a due left open behind him; ending an assignment hides nothing, so
 * there is nothing that guard would be protecting here (W-62).
 */
export async function endDailyLease(
  writer: Writer,
  input: EndDailyLeaseInput,
): Promise<EndedDailyLease> {
  return await writer.transaction(async (tx) => {
    const current = await findDailyLeaseForBusiness(tx, input.businessId, input.dailyLeaseId);
    if (!current) throw new NotFoundError("No such daily lease in this business");
    if (current.effectiveTo !== null) {
      throw new ValidationError("This daily lease has already ended");
    }
    if (input.effectiveTo < current.effectiveFrom) {
      throw new ValidationError("effectiveTo must not be before this assignment's own start date");
    }

    const rate = await findCurrentDailyLeaseRate(tx, input.dailyLeaseId);
    if (!rate) throw new NotFoundError("No current rate for this daily lease");

    await endDailyLeaseRow(tx, input.dailyLeaseId, input.effectiveTo);

    // GAP-118: the same freeing `changeDailyLeaseDriver` makes on its own
    // close-and-reopen, here with nothing reopening behind it — an idle
    // vehicle's own future occupancy and cards must not stand for a lease
    // that no longer runs.
    await releaseDailyLeaseAllocationsAfter(
      tx,
      input.dailyLeaseId,
      input.effectiveTo,
      "Daily lease ended",
      input.userId,
    );
    await voidFutureOpenDayRecordsForLease(
      tx,
      input.dailyLeaseId,
      input.effectiveTo,
      "Daily lease ended",
      input.userId,
    );

    return {
      id: current.id,
      vehicleId: current.vehicleId,
      driverId: current.driverId,
      patternType: current.patternType,
      patternWeekdays: current.patternWeekdays,
      effectiveFrom: current.effectiveFrom,
      effectiveTo: input.effectiveTo,
      dailyLeaseAmountMinor: rate.dailyLeaseAmountMinor,
    };
  });
}

export interface ChangeDailyLeaseRateInput {
  businessId: string;
  dailyLeaseId: string;
  dailyLeaseAmountMinor: Minor;
  /** UC-32: editable, not defaulted to today — a catch-up week's own rate change usually took effect days ago. */
  effectiveFrom: BusinessDate;
}

export interface ChangedDailyLeaseRate {
  dailyLeaseId: string;
  dailyLeaseAmountMinor: bigint;
  effectiveFrom: string;
}

/**
 * F-4.3/UC-32/GAP-2, one transaction: the `daily_lease_rate` sibling of
 * `changeDailyLeaseDriver` — closes the currently open rate the day before
 * and opens a new one from `effectiveFrom`, the identical close-then-insert
 * shape applied to DM §7's other exclusion constraint. Past days keep their
 * own figure (`day_record.expected_minor` is a snapshot, and `confirmDay`
 * only ever reads today's `daily_lease_rate` state going forward from here);
 * **future cards use the new one** re-prices every already-materialised but
 * unconfirmed card in the same transaction — without it, a card generated
 * under the old rate would sit showing a stale expected amount until
 * `confirmDay`'s own per-date resolution quietly corrected it at the moment
 * of confirming, which is exactly the "confident wrong number" CLAUDE.md
 * warns against.
 */
export async function changeDailyLeaseRate(
  writer: Writer,
  input: ChangeDailyLeaseRateInput,
): Promise<ChangedDailyLeaseRate> {
  return await writer.transaction(async (tx) => {
    const lease = await findDailyLeaseForBusiness(tx, input.businessId, input.dailyLeaseId);
    if (!lease) throw new NotFoundError("No such daily lease in this business");
    if (lease.effectiveTo !== null) {
      throw new ValidationError("This daily lease has already ended");
    }

    const currentRate = await findCurrentDailyLeaseRate(tx, input.dailyLeaseId);
    if (!currentRate) throw new NotFoundError("No current rate for this daily lease");
    if (input.effectiveFrom <= currentRate.effectiveFrom) {
      throw new ValidationError("effectiveFrom must be after the current rate's own start date");
    }

    const closesOn = addDays(input.effectiveFrom, -1);
    await endDailyLeaseRateRow(tx, input.dailyLeaseId, closesOn);
    await insertDailyLeaseRate(tx, {
      id: newId(),
      dailyLeaseId: input.dailyLeaseId,
      dailyLeaseAmountMinor: input.dailyLeaseAmountMinor,
      effectiveFrom: input.effectiveFrom,
    });
    await repriceFutureOpenDayRecords(
      tx,
      input.dailyLeaseId,
      input.effectiveFrom,
      input.dailyLeaseAmountMinor,
    );

    return {
      dailyLeaseId: input.dailyLeaseId,
      dailyLeaseAmountMinor: input.dailyLeaseAmountMinor,
      effectiveFrom: input.effectiveFrom,
    };
  });
}

export interface CreateLeaseDayExceptionInput {
  businessId: string;
  dailyLeaseId: string;
  exceptionDate: BusinessDate;
  reason?: string;
  userId: string;
}

/**
 * F-1.7/GAP-20: skip an individual date. If a card was already generated
 * for it (P13's rolling horizon runs ahead of any single day's own skip
 * decision), voids that card and its allocation in the same transaction —
 * the same GAP-118 reasoning that a fact changing frees what was
 * materialised on the old one, applied here to "this date turned out not
 * to be worked" rather than "the assignment ended." A day already
 * *confirmed* is a real event and refuses outright: an exception only ever
 * stops a card from being generated, never un-happens one (UC-96 owns that
 * correction instead).
 *
 * The card is read again inside the transaction rather than reusing a
 * pre-transaction lookup — a concurrent `confirmDay` between the two would
 * otherwise leave `voidOpenDayRecordForDate`'s `state = 'open'` guard
 * matching nothing while the exception still got inserted, a day that is
 * both confirmed and marked skipped (exactly what the lost-day denominator
 * can't tolerate). `voidOpenDayRecordForDate` returning nothing here means
 * exactly that race was lost, so the whole write is refused rather than
 * inserting the exception half-anchored.
 */
export async function createLeaseDayException(
  writer: Writer,
  input: CreateLeaseDayExceptionInput,
): Promise<LeaseDayExceptionRow> {
  const lease = await findDailyLeaseForBusiness(writer, input.businessId, input.dailyLeaseId);
  if (!lease) throw new NotFoundError("No such daily lease in this business");

  const id = newId();
  try {
    await writer.transaction(async (tx) => {
      const card = await findDayRecordByLeaseAndDate(tx, input.dailyLeaseId, input.exceptionDate);
      const live = card !== undefined && card.voidedAt === null;
      if (live && card.state !== "open") {
        throw new LeaseDayAlreadyConfirmedError();
      }
      if (live && card.state === "open") {
        const voided = await voidOpenDayRecordForDate(
          tx,
          input.dailyLeaseId,
          input.exceptionDate,
          "Day individually skipped",
          input.userId,
        );
        if (!voided) throw new LeaseDayAlreadyConfirmedError();
        await voidAllocationForDailyLeaseDate(
          tx,
          input.dailyLeaseId,
          input.exceptionDate,
          "Day individually skipped",
          input.userId,
        );
      }
      await insertLeaseDayException(tx, {
        id,
        businessId: input.businessId,
        dailyLeaseId: input.dailyLeaseId,
        exceptionDate: input.exceptionDate,
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        createdBy: input.userId,
      });
    });
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    if (isUniqueViolation(err, "lease_day_exception_daily_lease_id_exception_date_key")) {
      throw new LeaseDayAlreadyExceptedError();
    }
    throw err;
  }

  return {
    id,
    businessId: input.businessId,
    dailyLeaseId: input.dailyLeaseId,
    exceptionDate: input.exceptionDate,
    reason: input.reason ?? null,
    voidedAt: null,
  };
}

export interface VoidLeaseDayExceptionInput {
  businessId: string;
  dailyLeaseId: string;
  exceptionId: string;
  reason: string;
  userId: string;
}

/** F-1.7/GAP-20: un-skip. Nothing re-materialises the freed date here — the next `materializeDailyLeaseHorizon` pass (or a direct confirm, once the handler's own gate no longer sees a live exception) picks it back up naturally, the same "derivable, not dependent on a cron" property F-4.2 already relies on. */
export async function voidLeaseDayException(
  writer: Writer,
  input: VoidLeaseDayExceptionInput,
): Promise<{ voidedAt: string }> {
  const existing = await findLeaseDayExceptionForBusiness(
    writer,
    input.businessId,
    input.exceptionId,
  );
  if (!existing || existing.dailyLeaseId !== input.dailyLeaseId) {
    throw new NotFoundError("No such exception on this daily lease");
  }
  if (existing.voidedAt !== null) throw new LeaseDayExceptionAlreadyVoidedError();

  // The WHERE guard in voidLeaseDayExceptionRow makes a losing race against
  // a concurrent void return undefined here rather than clobbering the
  // winner's own reason/actor — the same shape voidCapitalContribution uses.
  const voided = await writer.transaction((tx) =>
    voidLeaseDayExceptionRow(tx, input.exceptionId, {
      voidedReason: input.reason,
      voidedBy: input.userId,
    }),
  );
  if (!voided) throw new LeaseDayExceptionAlreadyVoidedError();
  return voided;
}
