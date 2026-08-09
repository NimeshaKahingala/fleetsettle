import { and, asc, desc, eq, isNull, lte, or, gte } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import { dailyLease, dailyLeaseRate, driver, vehicle } from "../db/schema.js";

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
): Promise<{ dailyLeaseAmountMinor: bigint } | undefined> {
  const rows = await db
    .select({ dailyLeaseAmountMinor: dailyLeaseRate.dailyLeaseAmountMinor })
    .from(dailyLeaseRate)
    .where(and(eq(dailyLeaseRate.dailyLeaseId, dailyLeaseId), isNull(dailyLeaseRate.effectiveTo)))
    .limit(1);
  return rows[0];
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
