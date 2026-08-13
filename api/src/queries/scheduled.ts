import { and, eq, gte, isNull, lte, max, or } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import {
  accountingPeriod,
  billingPeriod,
  dailyLease,
  dayRecord,
  lease,
  vehicleDayAllocation,
} from "../db/schema.js";
import type { NewAllocationDay } from "./trip.js";

type ReadDb = Reader | Writer | Tx;
type WriteDb = Writer | Tx;

/**
 * P13's own read layer. Every function here is deliberately **unscoped by
 * `business_id`** — CLAUDE.md's tenancy rule ("never taken from a request
 * body or query param") exists to stop a request from crossing tenants, and
 * a scheduled job is not a request: there is no token, no caller, nothing to
 * confuse one business's row for another's. A Cron Trigger fires once for
 * the whole Worker and must see every business to do its job at all.
 */

export interface ActiveLeaseForCalendar {
  id: string;
  businessId: string;
  vehicleId: string;
  startDate: string;
  endDate: string | null;
}

/** DM §4.1: arrangement A's calendar extends through `end_date`, or to the rolling horizon when open-ended. */
export async function listActiveLeasesForCalendar(db: ReadDb): Promise<ActiveLeaseForCalendar[]> {
  const rows = await db
    .select({
      id: lease.id,
      businessId: lease.businessId,
      vehicleId: lease.vehicleId,
      startDate: lease.startDate,
      endDate: lease.endDate,
    })
    .from(lease)
    .where(eq(lease.status, "active"));
  return rows;
}

export interface ActiveDailyLeaseForCalendar {
  id: string;
  businessId: string;
  vehicleId: string;
  driverId: string;
  patternType: "every_day" | "alternate" | "weekdays";
  patternWeekdays: number[] | null;
  effectiveFrom: string;
  effectiveTo: string | null;
}

/** DM §4.1: arrangement B's calendar extends to the rolling horizon, written by `generate-day-cards` alongside each `day_record`. `effectiveTo` in the future still counts as active for today's run. */
export async function listActiveDailyLeasesForCalendar(
  db: ReadDb,
  today: string,
): Promise<ActiveDailyLeaseForCalendar[]> {
  const rows = await db
    .select({
      id: dailyLease.id,
      businessId: dailyLease.businessId,
      vehicleId: dailyLease.vehicleId,
      driverId: dailyLease.driverId,
      patternType: dailyLease.patternType,
      patternWeekdays: dailyLease.patternWeekdays,
      effectiveFrom: dailyLease.effectiveFrom,
      effectiveTo: dailyLease.effectiveTo,
    })
    .from(dailyLease)
    .where(or(isNull(dailyLease.effectiveTo), gte(dailyLease.effectiveTo, today)));
  return rows as ActiveDailyLeaseForCalendar[];
}

/** The dates already claimed on this vehicle's calendar in the window — what `generate-day-cards` must never write over (INV-1's own unique index is the backstop; this is the up-front check DM §4.1 requires before generating). */
export async function listAllocatedDatesForVehicle(
  db: ReadDb,
  vehicleId: string,
  from: string,
  to: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ businessDate: vehicleDayAllocation.businessDate })
    .from(vehicleDayAllocation)
    .where(
      and(
        eq(vehicleDayAllocation.vehicleId, vehicleId),
        gte(vehicleDayAllocation.businessDate, from),
        lte(vehicleDayAllocation.businessDate, to),
        isNull(vehicleDayAllocation.voidedAt), // D-11/W-58 — a voided day is a freed day (GAP-118)
      ),
    );
  return new Set(rows.map((r) => r.businessDate));
}

export interface LeaseDueForBillingPeriod {
  id: string;
  businessId: string;
}

/** `generate-billing-periods` (TS §4): every active lease whose latest billing period has already ended — the ones the cron's own re-run of `generateNextBillingPeriod` needs to catch up. Two bulk reads (IG §2), joined in JS, rather than a per-lease query for "what's the latest period." */
export interface OpenPeriodForCron {
  id: string;
  businessId: string;
  periodStart: string;
}

/** `generate-management-fee` (TS §4): every business's own currently open period — `one_open_period` (migration 0001) guarantees at most one row per business, so this is the whole population the generator needs to catch up. */
export async function listOpenPeriodsForCron(db: ReadDb): Promise<OpenPeriodForCron[]> {
  return db
    .select({
      id: accountingPeriod.id,
      businessId: accountingPeriod.businessId,
      periodStart: accountingPeriod.periodStart,
    })
    .from(accountingPeriod)
    .where(eq(accountingPeriod.status, "open"));
}

export async function listLeasesDueForNextBillingPeriod(
  db: ReadDb,
  today: string,
): Promise<LeaseDueForBillingPeriod[]> {
  const activeLeases = await db
    .select({ id: lease.id, businessId: lease.businessId })
    .from(lease)
    .where(eq(lease.status, "active"));
  if (activeLeases.length === 0) return [];

  const latestPeriodEnds = await db
    .select({ leaseId: billingPeriod.leaseId, latestPeriodEnd: max(billingPeriod.periodEnd) })
    .from(billingPeriod)
    .groupBy(billingPeriod.leaseId);
  const latestByLease = new Map(latestPeriodEnds.map((r) => [r.leaseId, r.latestPeriodEnd]));

  return activeLeases.filter((l) => {
    const latestPeriodEnd = latestByLease.get(l.id);
    return latestPeriodEnd !== undefined && latestPeriodEnd !== null && latestPeriodEnd < today;
  });
}

/**
 * `generate-day-cards`'s own insert — deliberately distinct from
 * `insertAllocationDays` (queries/trip.ts), which a real trip booking must
 * still use: a genuine INV-1 conflict there is a 409 the caller needs to
 * see, never silently dropped. Here, a conflict only ever means a concurrent
 * run (or the up-front `listAllocatedDatesForVehicle` check) got there
 * first, and "a job that fires twice is a no-op" (CLAUDE.md → Writes) is the
 * whole point.
 */
export async function insertAllocationDaysIdempotent(
  db: WriteDb,
  days: NewAllocationDay[],
): Promise<void> {
  if (days.length === 0) return;
  await db.insert(vehicleDayAllocation).values(days).onConflictDoNothing();
}

export interface NewDayRecordForCron {
  id: string;
  businessId: string;
  dailyLeaseId: string;
  vehicleId: string;
  driverId: string;
  businessDate: string;
  expectedMinor: bigint;
  postedPeriodId: string;
}

/** `generate-day-cards`'s own paired insert, always `state='open'` (the schema default) — the same idempotent-by-conflict reasoning as `insertAllocationDaysIdempotent` above, backed by `day_record`'s own `(daily_lease_id, business_date)` unique index. */
export async function insertDayRecordsIdempotent(
  db: WriteDb,
  rows: NewDayRecordForCron[],
): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(dayRecord)
    .values(rows.map((r) => ({ ...r, state: "open" as const })))
    .onConflictDoNothing();
}
