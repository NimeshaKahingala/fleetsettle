import { and, asc, desc, eq, gt, isNull, lte, or, gte, sql } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import {
  dailyLease,
  dailyLeaseRate,
  driver,
  leaseDayException,
  vehicle,
  vehicleDayAllocation,
} from "../db/schema.js";

type WriteDb = Writer | Tx;
type ReadDb = Reader | Writer | Tx;

export interface NewDailyLease {
  id: string;
  businessId: string;
  vehicleId: string;
  driverId: string;
  patternType: "every_day" | "alternate" | "weekdays";
  patternWeekdays?: number[];
  effectiveFrom: string;
  effectiveTo?: string;
}

export async function insertDailyLease(db: WriteDb, values: NewDailyLease): Promise<void> {
  await db.insert(dailyLease).values(values);
}

export interface NewDailyLeaseRate {
  id: string;
  dailyLeaseId: string;
  dailyLeaseAmountMinor: bigint;
  effectiveFrom: string;
}

export async function insertDailyLeaseRate(db: WriteDb, values: NewDailyLeaseRate): Promise<void> {
  await db.insert(dailyLeaseRate).values(values);
}

export interface DailyLeaseRow {
  id: string;
  vehicleId: string;
  driverId: string;
  patternType: "every_day" | "alternate" | "weekdays";
  patternWeekdays: number[] | null;
  effectiveFrom: string;
  effectiveTo: string | null;
}

const COLUMNS = {
  id: dailyLease.id,
  vehicleId: dailyLease.vehicleId,
  driverId: dailyLease.driverId,
  patternType: dailyLease.patternType,
  patternWeekdays: dailyLease.patternWeekdays,
  effectiveFrom: dailyLease.effectiveFrom,
  effectiveTo: dailyLease.effectiveTo,
};

/**
 * §6.7's borne-by default for arrangement B — "the driver" is whoever held
 * the vehicle's daily lease on `asOf` (GAP-56), by `effectiveFrom`/`effectiveTo`,
 * not just "still open": none found as of that date falls back to `us`, the
 * same as arrangement A with no active lease then. GAP-25 means no
 * `daily_lease` is ever actually closed today, so in practice this still
 * only ever matches the one open row — but resolving by date rather than
 * `effectiveTo IS NULL` alone means the fix doesn't need revisiting once
 * GAP-25 lands and a vehicle can have more than one, historically.
 */
export async function findCurrentDailyLeaseForVehicle(
  db: ReadDb,
  vehicleId: string,
  asOf: string,
): Promise<{ driverId: string } | undefined> {
  const rows = await db
    .select({ driverId: dailyLease.driverId })
    .from(dailyLease)
    .where(
      and(
        eq(dailyLease.vehicleId, vehicleId),
        lte(dailyLease.effectiveFrom, asOf),
        or(isNull(dailyLease.effectiveTo), gte(dailyLease.effectiveTo, asOf)),
      ),
    )
    .limit(1);
  return rows[0];
}

/** F-4.7/GAP-62/GAP-25: the first write that ever closes a `daily_lease` row — `effective_to` had no setter anywhere before this. Must land before the replacement's `INSERT` in the same transaction: the EXCLUDE constraint is not deferred, so the old range has to stop overlapping first. */
export async function endDailyLeaseRow(
  db: WriteDb,
  dailyLeaseId: string,
  effectiveTo: string,
): Promise<void> {
  await db.update(dailyLease).set({ effectiveTo }).where(eq(dailyLease.id, dailyLeaseId));
}

/**
 * GAP-118: a closed lease's own future occupancy, freed the same way
 * `deleteLeaseAllocationAfter` (queries/lease.ts) frees arrangement A's and
 * `deleteAllocationDaysForTrip` (queries/trip.ts) frees a cancelled trip's —
 * D-11/W-58, voided, never deleted. Must run before the replacement lease's
 * `materializeDailyLeaseHorizon` call in the same transaction:
 * `listAllocatedDatesForVehicle`'s `existing.has(d)` guard is what silently
 * no-opped the new lease's own materialisation before this fix existed.
 * `voidedReason` is a parameter, not hardcoded — this has two real callers
 * (a driver change, F-4.7; an arrangement change moving off B, F-1.2) and
 * they are two different facts, the same reasoning `voidExpenseRow` gives
 * for taking its own reason as an argument.
 */
export async function releaseDailyLeaseAllocationsAfter(
  db: WriteDb,
  dailyLeaseId: string,
  afterDate: string,
  voidedReason: string,
  voidedBy: string,
): Promise<void> {
  await db
    .update(vehicleDayAllocation)
    .set({ voidedAt: sql`now()`, voidedReason, voidedBy })
    .where(
      and(
        eq(vehicleDayAllocation.sourceType, "daily_lease"),
        eq(vehicleDayAllocation.sourceId, dailyLeaseId),
        gt(vehicleDayAllocation.businessDate, afterDate),
        isNull(vehicleDayAllocation.voidedAt),
      ),
    );
}

/**
 * GAP-20: the single-date sibling of `releaseDailyLeaseAllocationsAfter` —
 * used when a manager skips a date that already has an allocation reserved
 * ahead of it. `vehicle_day_allocation` carries no `posted_period_id`, so
 * unlike the paired `day_record` void this never risks `PERIOD_CLOSED`.
 */
export async function voidAllocationForDailyLeaseDate(
  db: WriteDb,
  dailyLeaseId: string,
  businessDate: string,
  voidedReason: string,
  voidedBy: string,
): Promise<void> {
  await db
    .update(vehicleDayAllocation)
    .set({ voidedAt: sql`now()`, voidedReason, voidedBy })
    .where(
      and(
        eq(vehicleDayAllocation.sourceType, "daily_lease"),
        eq(vehicleDayAllocation.sourceId, dailyLeaseId),
        eq(vehicleDayAllocation.businessDate, businessDate),
        isNull(vehicleDayAllocation.voidedAt),
      ),
    );
}

export interface NewLeaseDayException {
  id: string;
  businessId: string;
  dailyLeaseId: string;
  exceptionDate: string;
  reason?: string;
  createdBy: string;
}

export async function insertLeaseDayException(
  db: WriteDb,
  values: NewLeaseDayException,
): Promise<void> {
  await db.insert(leaseDayException).values(values);
}

export interface LeaseDayExceptionRow {
  id: string;
  businessId: string;
  dailyLeaseId: string;
  exceptionDate: string;
  reason: string | null;
  voidedAt: string | null;
}

const LEASE_DAY_EXCEPTION_COLUMNS = {
  id: leaseDayException.id,
  businessId: leaseDayException.businessId,
  dailyLeaseId: leaseDayException.dailyLeaseId,
  exceptionDate: leaseDayException.exceptionDate,
  reason: leaseDayException.reason,
  voidedAt: leaseDayException.voidedAt,
};

/** GAP-20's void endpoint's own lookup — scoped by `businessId` (CLAUDE.md → Tenancy). */
export async function findLeaseDayExceptionForBusiness(
  db: ReadDb,
  businessId: string,
  id: string,
): Promise<LeaseDayExceptionRow | undefined> {
  const rows = await db
    .select(LEASE_DAY_EXCEPTION_COLUMNS)
    .from(leaseDayException)
    .where(and(eq(leaseDayException.id, id), eq(leaseDayException.businessId, businessId)))
    .limit(1);
  return rows[0];
}

/**
 * F-1.7/GAP-20: un-skip, never delete — the `voidExpense` shape. Migration
 * 0027's partial unique index (`WHERE voided_at IS NULL`) is what makes a
 * losing race here return `undefined` rather than clobber the winner's own
 * reason/actor, the same shape `voidCapitalContributionRow` already uses.
 */
export async function voidLeaseDayExceptionRow(
  db: WriteDb,
  id: string,
  values: { voidedReason: string; voidedBy: string },
): Promise<{ voidedAt: string } | undefined> {
  const rows = await db
    .update(leaseDayException)
    .set({ voidedAt: sql`now()`, voidedReason: values.voidedReason, voidedBy: values.voidedBy })
    .where(and(eq(leaseDayException.id, id), isNull(leaseDayException.voidedAt)))
    .returning({ voidedAt: leaseDayException.voidedAt });
  return rows[0] as { voidedAt: string } | undefined;
}

/**
 * P13's day-card generator (`materializeDailyLeaseHorizon`) and GAP-20's own
 * confirm-day gate (`handlers/day-record.ts`) both need "every live
 * exception in this range," fetched once rather than once per candidate
 * date (IG §2: bulk, not N+1).
 */
export async function listLiveExceptionDatesForLease(
  db: ReadDb,
  dailyLeaseId: string,
  from: string,
  to: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ exceptionDate: leaseDayException.exceptionDate })
    .from(leaseDayException)
    .where(
      and(
        eq(leaseDayException.dailyLeaseId, dailyLeaseId),
        isNull(leaseDayException.voidedAt),
        gte(leaseDayException.exceptionDate, from),
        lte(leaseDayException.exceptionDate, to),
      ),
    );
  return new Set(rows.map((r) => r.exceptionDate));
}

/** The setup screen's own "what's currently skipped" list — every live exception for this lease, newest first. */
export async function listLeaseDayExceptionsForLease(
  db: ReadDb,
  dailyLeaseId: string,
): Promise<LeaseDayExceptionRow[]> {
  const rows = await db
    .select(LEASE_DAY_EXCEPTION_COLUMNS)
    .from(leaseDayException)
    .where(
      and(eq(leaseDayException.dailyLeaseId, dailyLeaseId), isNull(leaseDayException.voidedAt)),
    )
    .orderBy(desc(leaseDayException.exceptionDate));
  return rows;
}

/** F-1.2/GAP-54: the vehicle's currently open `daily_lease` row (id + own start date), so an arrangement change moving off B can close it — distinct from `findCurrentDailyLeaseForVehicle` above, which resolves a borne-by default "as of" a date and returns only the driver. */
export async function findCurrentDailyLeaseRowForVehicle(
  db: ReadDb,
  vehicleId: string,
): Promise<{ id: string; effectiveFrom: string } | undefined> {
  const rows = await db
    .select({ id: dailyLease.id, effectiveFrom: dailyLease.effectiveFrom })
    .from(dailyLease)
    .where(and(eq(dailyLease.vehicleId, vehicleId), isNull(dailyLease.effectiveTo)))
    .limit(1);
  return rows[0];
}

/** Scoped by `businessId` — the same shape every P2+ read gets (CLAUDE.md → Tenancy). */
export async function findDailyLeaseForBusiness(
  db: ReadDb,
  businessId: string,
  dailyLeaseId: string,
): Promise<DailyLeaseRow | undefined> {
  const rows = await db
    .select(COLUMNS)
    .from(dailyLease)
    .where(and(eq(dailyLease.id, dailyLeaseId), eq(dailyLease.businessId, businessId)))
    .limit(1);
  return rows[0] as DailyLeaseRow | undefined;
}

/** The current rate — `effective_to IS NULL` (DM §7's exclusion constraint guarantees at most one). */
export async function findCurrentDailyLeaseRate(
  db: ReadDb,
  dailyLeaseId: string,
): Promise<{ dailyLeaseAmountMinor: bigint; effectiveFrom: string } | undefined> {
  const rows = await db
    .select({
      dailyLeaseAmountMinor: dailyLeaseRate.dailyLeaseAmountMinor,
      effectiveFrom: dailyLeaseRate.effectiveFrom,
    })
    .from(dailyLeaseRate)
    .where(and(eq(dailyLeaseRate.dailyLeaseId, dailyLeaseId), isNull(dailyLeaseRate.effectiveTo)))
    .limit(1);
  return rows[0];
}

/**
 * F-4.3/GAP-2, the rate-table sibling of `endDailyLeaseRow`: closes the
 * currently open `daily_lease_rate` the day before a new one opens — the
 * same close-then-insert shape `changeDailyLeaseDriver` gives `daily_lease`
 * itself, applied here to DM §7's own exclusion constraint on this table.
 */
export async function endDailyLeaseRateRow(
  db: WriteDb,
  dailyLeaseId: string,
  effectiveTo: string,
): Promise<void> {
  await db
    .update(dailyLeaseRate)
    .set({ effectiveTo })
    .where(and(eq(dailyLeaseRate.dailyLeaseId, dailyLeaseId), isNull(dailyLeaseRate.effectiveTo)));
}

export interface DailyLeaseRateRow {
  dailyLeaseAmountMinor: bigint;
  effectiveFrom: string;
  effectiveTo: string | null;
}

/** P13's `generate-day-cards`: every rate this lease has ever had, fetched once per lease rather than once per candidate date (IG §2) — the caller resolves each date's own rate from this list in JS. */
export async function listDailyLeaseRatesForLease(
  db: ReadDb,
  dailyLeaseId: string,
): Promise<DailyLeaseRateRow[]> {
  const rows = await db
    .select({
      dailyLeaseAmountMinor: dailyLeaseRate.dailyLeaseAmountMinor,
      effectiveFrom: dailyLeaseRate.effectiveFrom,
      effectiveTo: dailyLeaseRate.effectiveTo,
    })
    .from(dailyLeaseRate)
    .where(eq(dailyLeaseRate.dailyLeaseId, dailyLeaseId));
  return rows;
}

/**
 * The rate in force on a specific date — F-4.3's effective-dated rates mean
 * a catch-up day's rate can differ from today's. DM §7's exclusion
 * constraint (no two rates overlap on the same daily lease) guarantees at
 * most one match.
 */
export async function findDailyLeaseRateForDate(
  db: ReadDb,
  dailyLeaseId: string,
  businessDate: string,
): Promise<{ dailyLeaseAmountMinor: bigint } | undefined> {
  const rows = await db
    .select({ dailyLeaseAmountMinor: dailyLeaseRate.dailyLeaseAmountMinor })
    .from(dailyLeaseRate)
    .where(
      and(
        eq(dailyLeaseRate.dailyLeaseId, dailyLeaseId),
        lte(dailyLeaseRate.effectiveFrom, businessDate),
        or(isNull(dailyLeaseRate.effectiveTo), gte(dailyLeaseRate.effectiveTo, businessDate)),
      ),
    )
    .limit(1);
  return rows[0];
}

const CURRENT_RATE = and(
  eq(dailyLeaseRate.dailyLeaseId, dailyLease.id),
  isNull(dailyLeaseRate.effectiveTo),
);

export interface ActiveDailyLeaseRow {
  id: string;
  vehicleId: string;
  vehicleRegistration: string;
  vehicleType: string;
  driverId: string;
  driverName: string;
  dailyLeaseAmountMinor: bigint;
}

/**
 * Home item 3 (UI §3.2): every daily lease still running, one row each,
 * with the vehicle and driver already joined so the caller can render a day
 * card without a follow-up lookup per row (IG §2: bulk, not N+1). `effective_to
 * IS NULL` is the same "still active" test `findCurrentDailyLeaseForVehicle`
 * already uses. Ordered by registration — stable and deterministic, not
 * "most recently used" (§3.2's own rule for which card gets elevated at 2–3
 * vehicles): nothing in this schema tracks last-used-at yet, so the
 * frontend elevates the first row of a stable order rather than faking
 * recency, recorded as a real, deliberate gap rather than a silent one.
 */
export async function listActiveDailyLeasesForBusiness(
  db: ReadDb,
  businessId: string,
): Promise<ActiveDailyLeaseRow[]> {
  const rows = await db
    .select({
      id: dailyLease.id,
      vehicleId: dailyLease.vehicleId,
      vehicleRegistration: vehicle.registration,
      vehicleType: vehicle.vehicleType,
      driverId: dailyLease.driverId,
      driverName: driver.name,
      dailyLeaseAmountMinor: dailyLeaseRate.dailyLeaseAmountMinor,
    })
    .from(dailyLease)
    .innerJoin(vehicle, eq(vehicle.id, dailyLease.vehicleId))
    .innerJoin(driver, eq(driver.id, dailyLease.driverId))
    .innerJoin(dailyLeaseRate, CURRENT_RATE)
    .where(and(eq(dailyLease.businessId, businessId), isNull(dailyLease.effectiveTo)))
    .orderBy(asc(vehicle.registration));
  return rows;
}

export interface VehicleDailyLeaseHistoryRow {
  id: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  dailyLeaseAmountMinor: bigint;
  driverId: string;
  driverName: string;
}

/**
 * Vehicle overview's history tab (Web-P5): every arrangement-B period this
 * vehicle has had, ended ones included, driver already joined. Each row's
 * rate is its *current* one (`CURRENT_RATE`, `effective_to IS NULL`) — safe
 * today because no path yet changes a daily lease's rate after creation
 * (F-4.3, not built), so `dailyLeaseRate` never has more than one row per
 * daily lease. The same simplification `ConfirmDayCard`'s own doc comment
 * already records for exactly this reason.
 */
export async function listDailyLeasesForVehicle(
  db: ReadDb,
  businessId: string,
  vehicleId: string,
): Promise<VehicleDailyLeaseHistoryRow[]> {
  const rows = await db
    .select({
      id: dailyLease.id,
      effectiveFrom: dailyLease.effectiveFrom,
      effectiveTo: dailyLease.effectiveTo,
      dailyLeaseAmountMinor: dailyLeaseRate.dailyLeaseAmountMinor,
      driverId: dailyLease.driverId,
      driverName: driver.name,
    })
    .from(dailyLease)
    .innerJoin(driver, eq(driver.id, dailyLease.driverId))
    .innerJoin(dailyLeaseRate, CURRENT_RATE)
    .where(and(eq(dailyLease.businessId, businessId), eq(dailyLease.vehicleId, vehicleId)))
    .orderBy(desc(dailyLease.effectiveFrom));
  return rows;
}
