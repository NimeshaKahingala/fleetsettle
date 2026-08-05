import { addDays, inclusiveDays, newId, weekdayOf, type BusinessDate } from "@fleetsettle/shared";
import type { Writer } from "../db/client.js";
import { findOpenPeriodRow } from "../queries/accounting-period.js";
import { listDailyLeaseRatesForLease, type DailyLeaseRateRow } from "../queries/dailyLease.js";
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

const HORIZON_DAYS = 90;

/**
 * §4.2/F-1.7: whether `date` is one this daily lease actually operates on.
 * "Alternate" has no reference point stated anywhere in the docs beyond
 * "alternate days" — this treats the lease's own `effective_from` as day
 * zero (always "on"), which is deterministic and reproducible but is a
 * judgment call, not a documented rule; F-1.7's "individual days skippable"
 * clause has no column to hold an exception and is not implemented here,
 * recorded rather than guessed at (TRACKER.md).
 */
function isPatternDay(
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
  const openPeriodCache = new Map<string, { id: string; periodEnd: string } | null>();

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
      const rangeEnd =
        dl.effectiveTo !== null && dl.effectiveTo < horizonEnd ? dl.effectiveTo : horizonEnd;
      if (rangeEnd < today) continue;

      const existing = await listAllocatedDatesForVehicle(writer, dl.vehicleId, today, rangeEnd);
      const rates = await listDailyLeaseRatesForLease(writer, dl.id);
      const openPeriod = await openPeriodFor(dl.businessId);

      const allocations: NewAllocationDay[] = [];
      const dayRecords: NewDayRecordForCron[] = [];

      for (let d = today; d <= rangeEnd; d = addDays(d, 1)) {
        if (existing.has(d) || !isPatternDay(d, dl)) continue;

        allocations.push({
          id: newId(),
          businessId: dl.businessId,
          vehicleId: dl.vehicleId,
          businessDate: d,
          arrangement: "B",
          sourceType: "daily_lease",
          sourceId: dl.id,
        });

        if (openPeriod !== null && d <= openPeriod.periodEnd) {
          const rateMinor = resolveRateForDate(rates, d);
          if (rateMinor !== undefined) {
            dayRecords.push({
              id: newId(),
              businessId: dl.businessId,
              dailyLeaseId: dl.id,
              vehicleId: dl.vehicleId,
              driverId: dl.driverId,
              businessDate: d,
              expectedMinor: rateMinor,
              postedPeriodId: openPeriod.id,
            });
          }
        }
      }

      if (allocations.length > 0) {
        await insertAllocationDaysIdempotent(writer, allocations);
        allocationsCreated += allocations.length;
      }
      if (dayRecords.length > 0) {
        await insertDayRecordsIdempotent(writer, dayRecords);
        dayRecordsCreated += dayRecords.length;
      }
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
