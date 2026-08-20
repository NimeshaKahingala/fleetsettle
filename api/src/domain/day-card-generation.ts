import { addDays, inclusiveDays, newId, weekdayOf, type BusinessDate } from "@fleetsettle/shared";
import type { Tx, Writer } from "../db/client.js";
import { findOpenPeriodRow } from "../queries/accounting-period.js";
import {
  listDailyLeaseRatesForLease,
  listLiveExceptionDatesForLease,
  type DailyLeaseRateRow,
} from "../queries/dailyLease.js";
import {
  insertAllocationDaysIdempotent,
  insertDayRecordsIdempotent,
  listActiveDailyLeasesForCalendar,
  listActiveLeasesForCalendar,
  listAllocatedDatesForVehicle,
  type ActiveDailyLeaseForCalendar,
  type NewDayRecordForCron,
} from "../queries/scheduled.js";
import type { NewAllocationDay } from "../queries/trip.js";

/** Exported for `restoreDailyLeaseOccupancy` (trip.ts), which must pass its own explicit `from` and therefore also `horizonDays` — JS has no way to skip a positional parameter. */
export const HORIZON_DAYS = 90;

/**
 * §4.2/F-1.7: whether `date` is one this daily lease's own pattern operates
 * on. "Alternate" has no reference point stated anywhere in the docs beyond
 * "alternate days" — this treats the lease's own `effective_from` as day
 * zero (always "on"), which is deterministic and reproducible but is a
 * judgment call, not a documented rule.
 *
 * **Deliberately blind to `lease_day_exception` (GAP-20)** — a skipped date
 * is not a pattern fact, it is a correction layered on top of one, so every
 * caller checks the two separately (`materializeDailyLeaseHorizon` below,
 * and `confirmDayHandler`, api/src/handlers/day-record.ts) rather than this
 * function silently absorbing a second concern.
 */
export function isPatternDay(
  date: BusinessDate,
  dailyLease: Pick<
    ActiveDailyLeaseForCalendar,
    "patternType" | "patternWeekdays" | "effectiveFrom" | "effectiveTo"
  >,
): boolean {
  if (date < dailyLease.effectiveFrom) return false;
  if (dailyLease.effectiveTo !== null && date > dailyLease.effectiveTo) return false;

  if (dailyLease.patternType === "every_day") return true;
  if (dailyLease.patternType === "weekdays") {
    return dailyLease.patternWeekdays?.includes(weekdayOf(date)) ?? false;
  }
  const daysSinceStart = inclusiveDays(dailyLease.effectiveFrom as BusinessDate, date) - 1;
  return daysSinceStart % 2 === 0;
}

function resolveRateForDate(rates: DailyLeaseRateRow[], date: string): bigint | undefined {
  return rates.find(
    (r) => r.effectiveFrom <= date && (r.effectiveTo === null || r.effectiveTo >= date),
  )?.dailyLeaseAmountMinor;
}

export interface GenerateDayCardsResult {
  allocationsCreated: number;
  dayRecordsCreated: number;
  /** One unit (a lease or a daily lease) failing must not take the whole run down — collected rather than thrown. */
  errors: { sourceType: "lease" | "daily_lease"; sourceId: string; message: string }[];
}

export interface MaterializeDailyLeaseHorizonResult {
  allocationsCreated: number;
  dayRecordsCreated: number;
  /**
   * GAP-146/REV-2026-08-19-02: pattern dates in range that got their
   * allocation row (occupancy has no `posted_period_id` and is never
   * period-gated) but no paired `day_record`, because the date falls
   * *before* `openPeriod.periodStart` — an already-closed period.
   * `assert_period_open()` only checks whether the row's *named* period is
   * closed, never whether the row's own `business_date` actually falls
   * inside it, so stamping one of these with the open period's id would
   * silently move a closed month's driver day fee into the currently open
   * one. Left unposted instead, and reported here rather than dropped —
   * unlike a date beyond `periodEnd` (simply "not yet", picked up by the
   * next cron run once its period opens), a date before `periodStart` is
   * never revisited by anything, since every horizon fill only ever runs
   * forward from `today`.
   */
  unrestorableDayRecordDates: BusinessDate[];
}

/**
 * D-9/GAP-88: the write shared by `generate-day-cards`'s own daily-lease pass
 * (below) and `startDailyLease`/`changeDailyLeaseDriver`'s synchronous call —
 * every pattern day from `from` (defaults to `today`) to the lesser of
 * `effectiveTo` and the rolling horizon, an allocation always, a
 * `day_record` only for the portion inside the currently open period. One
 * bulk insert per table, not a per-day query (Worker CPU is bounded per
 * invocation).
 *
 * `from` is a separate parameter from `today` (GAP-146): `today` still
 * anchors the horizon's *far* end (`addDays(today, horizonDays - 1)`), but
 * `restoreDailyLeaseOccupancy` needs to reach *earlier* than today to
 * backfill whatever a hold or a cancelled trip freed, without moving where
 * the horizon itself ends.
 */
export async function materializeDailyLeaseHorizon(
  writer: Writer | Tx,
  dailyLease: Pick<
    ActiveDailyLeaseForCalendar,
    | "id"
    | "businessId"
    | "vehicleId"
    | "driverId"
    | "patternType"
    | "patternWeekdays"
    | "effectiveFrom"
    | "effectiveTo"
  >,
  rates: DailyLeaseRateRow[],
  openPeriod: { id: string; periodStart: string; periodEnd: string } | null,
  today: BusinessDate,
  horizonDays: number = HORIZON_DAYS,
  from: BusinessDate = today,
): Promise<MaterializeDailyLeaseHorizonResult> {
  const horizonEnd = addDays(today, horizonDays - 1);
  const rangeEnd =
    dailyLease.effectiveTo !== null && dailyLease.effectiveTo < horizonEnd
      ? (dailyLease.effectiveTo as BusinessDate)
      : horizonEnd;
  if (rangeEnd < from) {
    return { allocationsCreated: 0, dayRecordsCreated: 0, unrestorableDayRecordDates: [] };
  }

  const existing = await listAllocatedDatesForVehicle(writer, dailyLease.vehicleId, from, rangeEnd);
  // GAP-20: fetched once for the whole range (IG §2: bulk, not per-day) —
  // an excepted date behaves exactly like an off-pattern one, no row ever.
  const excepted = await listLiveExceptionDatesForLease(writer, dailyLease.id, from, rangeEnd);

  const allocations: NewAllocationDay[] = [];
  const dayRecords: NewDayRecordForCron[] = [];
  const unrestorableDayRecordDates: BusinessDate[] = [];

  for (let d = from; d <= rangeEnd; d = addDays(d, 1)) {
    if (existing.has(d) || excepted.has(d) || !isPatternDay(d, dailyLease)) continue;

    allocations.push({
      id: newId(),
      businessId: dailyLease.businessId,
      vehicleId: dailyLease.vehicleId,
      businessDate: d,
      arrangement: "B",
      sourceType: "daily_lease",
      sourceId: dailyLease.id,
    });

    if (openPeriod !== null && d >= openPeriod.periodStart && d <= openPeriod.periodEnd) {
      const rateMinor = resolveRateForDate(rates, d);
      if (rateMinor !== undefined) {
        dayRecords.push({
          id: newId(),
          businessId: dailyLease.businessId,
          dailyLeaseId: dailyLease.id,
          vehicleId: dailyLease.vehicleId,
          driverId: dailyLease.driverId,
          businessDate: d,
          expectedMinor: rateMinor,
          postedPeriodId: openPeriod.id,
        });
      }
    } else if (openPeriod !== null && d < openPeriod.periodStart) {
      unrestorableDayRecordDates.push(d);
    }
  }

  if (allocations.length > 0) {
    await insertAllocationDaysIdempotent(writer, allocations);
  }
  if (dayRecords.length > 0) {
    await insertDayRecordsIdempotent(writer, dayRecords);
  }

  return {
    allocationsCreated: allocations.length,
    dayRecordsCreated: dayRecords.length,
    unrestorableDayRecordDates,
  };
}

/**
 * P13/`generate-day-cards` (TS §4), plus arrangement A's own calendar
 * extension that DM §4.1 assigns to "the same cron that rolls billing
 * periods." Both were left undone at P2 (TRACKER.md), which is why INV-1 has
 * never been enforced for a lease or a daily lease — only a trip (P6) writes
 * its own `vehicle_day_allocation` at booking.
 *
 * Arrangement A gets allocation rows only, through `end_date` or the rolling
 * horizon. Arrangement B gets allocation rows across the **same** full
 * horizon (so a lease booked far out still collides correctly, DM §4.1's own
 * example), but a paired `day_record` only for the portion inside the
 * business's own currently open accounting period — `day_record.posted_period_id`
 * is `NOT NULL`, and periods are opened one at a time by an explicit close
 * (P9), so a date 60 days out may simply have nowhere to post yet. That
 * portion of the horizon gets its allocation row now and its day_record on
 * a later run, once the period that covers it has actually opened.
 */
export async function generateDayCards(
  writer: Writer,
  today: BusinessDate,
  horizonDays: number = HORIZON_DAYS,
): Promise<GenerateDayCardsResult> {
  // `horizonDays` dates in total, today included — addDays(today, horizonDays)
  // would be one day too many (an N+1-day inclusive range).
  const horizonEnd = addDays(today, horizonDays - 1);
  let allocationsCreated = 0;
  let dayRecordsCreated = 0;
  const errors: GenerateDayCardsResult["errors"] = [];
  const openPeriodCache = new Map<
    string,
    { id: string; periodStart: string; periodEnd: string } | null
  >();

  async function openPeriodFor(businessId: string) {
    let cached = openPeriodCache.get(businessId);
    if (cached === undefined) {
      const row = await findOpenPeriodRow(writer, businessId);
      cached = row ?? null;
      openPeriodCache.set(businessId, cached);
    }
    return cached;
  }

  const activeLeases = await listActiveLeasesForCalendar(writer);
  for (const l of activeLeases) {
    try {
      const rangeEnd = l.endDate !== null && l.endDate < horizonEnd ? l.endDate : horizonEnd;
      if (rangeEnd < today) continue;

      const existing = await listAllocatedDatesForVehicle(writer, l.vehicleId, today, rangeEnd);
      const days: NewAllocationDay[] = [];
      for (let d = today; d <= rangeEnd; d = addDays(d, 1)) {
        if (existing.has(d)) continue;
        days.push({
          id: newId(),
          businessId: l.businessId,
          vehicleId: l.vehicleId,
          businessDate: d,
          arrangement: "A",
          sourceType: "lease",
          sourceId: l.id,
        });
      }
      if (days.length > 0) {
        await insertAllocationDaysIdempotent(writer, days);
        allocationsCreated += days.length;
      }
    } catch (err) {
      errors.push({
        sourceType: "lease",
        sourceId: l.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const activeDailyLeases = await listActiveDailyLeasesForCalendar(writer, today);
  for (const dl of activeDailyLeases) {
    try {
      const rates = await listDailyLeaseRatesForLease(writer, dl.id);
      const openPeriod = await openPeriodFor(dl.businessId);
      const result = await materializeDailyLeaseHorizon(
        writer,
        dl,
        rates,
        openPeriod,
        today,
        horizonDays,
      );
      allocationsCreated += result.allocationsCreated;
      dayRecordsCreated += result.dayRecordsCreated;
    } catch (err) {
      errors.push({
        sourceType: "daily_lease",
        sourceId: dl.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { allocationsCreated, dayRecordsCreated, errors };
}
