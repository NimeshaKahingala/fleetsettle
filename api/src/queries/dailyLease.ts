import { and, eq, isNull, lte, or, gte } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import { dailyLease, dailyLeaseRate } from "../db/schema.js";

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

/** §6.7's borne-by default for arrangement B — "the driver" is whoever currently holds the vehicle's daily lease; none found falls back to `us`, the same as arrangement A with no active lease. */
export async function findCurrentDailyLeaseForVehicle(
  db: ReadDb,
  vehicleId: string,
): Promise<{ driverId: string } | undefined> {
  const rows = await db
    .select({ driverId: dailyLease.driverId })
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
): Promise<{ dailyLeaseAmountMinor: bigint } | undefined> {
  const rows = await db
    .select({ dailyLeaseAmountMinor: dailyLeaseRate.dailyLeaseAmountMinor })
    .from(dailyLeaseRate)
    .where(and(eq(dailyLeaseRate.dailyLeaseId, dailyLeaseId), isNull(dailyLeaseRate.effectiveTo)))
    .limit(1);
  return rows[0];
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
