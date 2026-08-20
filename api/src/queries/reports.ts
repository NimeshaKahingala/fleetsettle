import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import {
  accountingPeriod,
  adjustment,
  advance,
  appUser,
  bankingEvent,
  businessMember,
  customer,
  dayRecord,
  deposit,
  driver,
  expense,
  incident,
  obligation,
  odometerReading,
  ownershipShare,
  payment,
  trip,
  vehicle,
  vehicleUnavailability,
} from "../db/schema.js";
import { sumDepositMovements } from "./driver-money.js";

type ReadDb = Reader | Writer | Tx;

/**
 * GAP-145: the one accumulate-into-a-pre-seeded-map step every bulk sum
 * below shares. Every map passed here was built as
 * `new Map(ids.map((id) => [id, 0n]))` before its own SQL rows are folded
 * in, so a missing key at this point is a real bug (an id that reached
 * here without being seeded), not a legitimate absence — W-56 governs a
 * vehicle with no matching rows, which is exactly what the pre-seeded 0n
 * already represents, correctly, before this function is ever called.
 */
function addToBigIntMap(map: Map<string, bigint>, key: string, amount: bigint): void {
  // eslint-disable-next-line no-restricted-syntax -- allow: see this function's own doc comment — every map reaching here is pre-seeded with 0n for every legal key
  map.set(key, (map.get(key) ?? 0n) + amount);
}

/** GAP-145: `new Map(ids.map((id) => [id, 0n]))`, named — every bulk-sum function below starts from this, so a missing id downstream is always a real bug, never a legitimate absence (`addToBigIntMap`'s own comment). */
function zeroSeededMap(ids: string[]): Map<string, bigint> {
  return new Map(ids.map((id) => [id, 0n]));
}

interface VehicleTotalRow {
  vehicleId: string | null;
  total: string;
}

/**
 * GAP-145: the one "fold a `GROUP BY vehicle_id` query's rows into a
 * pre-seeded map" step every single-dimension bulk sum shares —
 * `sumVehicleEarnedForPeriodBulk`/`CostsForPeriodBulk`/`EarnedForDateRangeBulk`/
 * `CostsForDateRangeBulk` each run this twice, once per source table. A
 * `NULL` `vehicleId` only happens on `obligation`'s own overhead rows,
 * already excluded by every caller's `inArray(vehicleId, vehicleIds)` —
 * checked here once rather than once per call site.
 */
function foldIntoBigIntMap(map: Map<string, bigint>, rows: VehicleTotalRow[]): void {
  for (const r of rows) {
    if (r.vehicleId === null) continue;
    addToBigIntMap(map, r.vehicleId, BigInt(r.total));
  }
}

interface VehiclePeriodTotalRow {
  vehicleId: string | null;
  periodId: string | null;
  total: string;
}

/** `foldIntoBigIntMap`'s own shape, one level deeper — for `sumVehicleEarnedForPeriodsBulk`/`CostsForPeriodsBulk`, whose maps are keyed by period first. A row naming a period this map was never seeded for (should not happen — every caller seeds from the exact `periodIds` its own query filters on) is silently skipped rather than thrown, the same "trust the seed, don't invent a bucket for it" reasoning `addToBigIntMap` already carries. */
function foldIntoNestedBigIntMap(
  map: Map<string, Map<string, bigint>>,
  rows: VehiclePeriodTotalRow[],
): void {
  for (const r of rows) {
    if (r.vehicleId === null || r.periodId === null) continue;
    const byVehicle = map.get(r.periodId);
    if (!byVehicle) continue;
    addToBigIntMap(byVehicle, r.vehicleId, BigInt(r.total));
  }
}

/** UC-70/DM §15: "everything recognised in the accounting period" (W-40) — rent, the daily amount, and mileage excess all live on `obligation`; trip income is recognised at closing (W-41), never on `obligation`. */
export async function sumVehicleEarnedForPeriod(
  db: ReadDb,
  vehicleId: string,
  periodId: string,
): Promise<bigint> {
  const obligationRows = await db
    .select({ amountMinor: obligation.amountMinor })
    .from(obligation)
    .where(
      and(
        eq(obligation.vehicleId, vehicleId),
        eq(obligation.postedPeriodId, periodId),
        eq(obligation.direction, "owed_to_us"),
        sql`${obligation.kind} IN ('rent', 'daily_amount', 'mileage_excess')`,
        isNull(obligation.voidedAt),
      ),
    );
  const tripRows = await db
    .select({ amountMinor: trip.agreedAmountMinor })
    .from(trip)
    .where(
      and(
        eq(trip.vehicleId, vehicleId),
        eq(trip.postedPeriodId, periodId),
        eq(trip.status, "closed"),
      ),
    );
  return (
    obligationRows.reduce((sum, r) => sum + r.amountMinor, 0n) +
    tripRows.reduce((sum, r) => sum + r.amountMinor, 0n)
  );
}

/**
 * GAP-145: `sumVehicleEarnedForPeriod`'s own two queries, grouped across
 * every vehicle in `vehicleIds` instead of run once per vehicle —
 * `getVehicleMonthReport`'s own per-vehicle loop was the direct cause of a
 * live 500 (`GET /api/partner/{userId}`), which recomputes this report once
 * per accounting period: at 79 subrequests for one six-vehicle business
 * against a Workers Free ceiling of 50. Two queries total, not `2 ×
 * vehicles`. Every id in `vehicleIds` gets an entry in the returned map,
 * `0n` when nothing was found — the caller's own `?? 0n` fallback moves
 * here so nothing downstream has to know the difference between "zero" and
 * "absent" (W-56 is still honoured: a vehicle with no rows genuinely earned
 * nothing in this period, not a missing figure).
 */
export async function sumVehicleEarnedForPeriodBulk(
  db: ReadDb,
  vehicleIds: string[],
  periodId: string,
): Promise<Map<string, bigint>> {
  const out = zeroSeededMap(vehicleIds);
  if (vehicleIds.length === 0) return out;

  const obligationRows = await db
    .select({
      vehicleId: obligation.vehicleId,
      total: sql<string>`SUM(${obligation.amountMinor})`,
    })
    .from(obligation)
    .where(
      and(
        inArray(obligation.vehicleId, vehicleIds),
        eq(obligation.postedPeriodId, periodId),
        eq(obligation.direction, "owed_to_us"),
        sql`${obligation.kind} IN ('rent', 'daily_amount', 'mileage_excess')`,
        isNull(obligation.voidedAt),
      ),
    )
    .groupBy(obligation.vehicleId);
  const tripRows = await db
    .select({ vehicleId: trip.vehicleId, total: sql<string>`SUM(${trip.agreedAmountMinor})` })
    .from(trip)
    .where(
      and(
        inArray(trip.vehicleId, vehicleIds),
        eq(trip.postedPeriodId, periodId),
        eq(trip.status, "closed"),
      ),
    )
    .groupBy(trip.vehicleId);

  foldIntoBigIntMap(out, obligationRows);
  foldIntoBigIntMap(out, tripRows);
  return out;
}

/**
 * GAP-145: `sumVehicleEarnedForPeriodBulk`'s own two queries, additionally
 * grouped by `postedPeriodId` — every vehicle across every period in
 * `periodIds` in one round trip each, rather than one call per period.
 * Built for `sumAllTimeEarnedForUser` (partner.ts), which used to call the
 * single-period, single-vehicle version once per accounting period —
 * `O(vehicles × periods)` round trips on the same endpoint GAP-145 already
 * found fanning out past Workers Free's subrequest ceiling.
 */
export async function sumVehicleEarnedForPeriodsBulk(
  db: ReadDb,
  vehicleIds: string[],
  periodIds: string[],
): Promise<Map<string, Map<string, bigint>>> {
  const out = new Map(periodIds.map((pid) => [pid, zeroSeededMap(vehicleIds)]));
  if (vehicleIds.length === 0 || periodIds.length === 0) return out;

  const obligationRows = await db
    .select({
      vehicleId: obligation.vehicleId,
      periodId: obligation.postedPeriodId,
      total: sql<string>`SUM(${obligation.amountMinor})`,
    })
    .from(obligation)
    .where(
      and(
        inArray(obligation.vehicleId, vehicleIds),
        inArray(obligation.postedPeriodId, periodIds),
        eq(obligation.direction, "owed_to_us"),
        sql`${obligation.kind} IN ('rent', 'daily_amount', 'mileage_excess')`,
        isNull(obligation.voidedAt),
      ),
    )
    .groupBy(obligation.vehicleId, obligation.postedPeriodId);
  const tripRows = await db
    .select({
      vehicleId: trip.vehicleId,
      periodId: trip.postedPeriodId,
      total: sql<string>`SUM(${trip.agreedAmountMinor})`,
    })
    .from(trip)
    .where(
      and(
        inArray(trip.vehicleId, vehicleIds),
        inArray(trip.postedPeriodId, periodIds),
        eq(trip.status, "closed"),
      ),
    )
    .groupBy(trip.vehicleId, trip.postedPeriodId);

  foldIntoNestedBigIntMap(out, obligationRows);
  foldIntoNestedBigIntMap(out, tripRows);
  return out;
}

/** `sumVehicleCostsForPeriodBulk`'s own two queries, additionally grouped by `postedPeriodId` — see `sumVehicleEarnedForPeriodsBulk`'s comment for why. */
export async function sumVehicleCostsForPeriodsBulk(
  db: ReadDb,
  vehicleIds: string[],
  periodIds: string[],
): Promise<Map<string, Map<string, bigint>>> {
  const out = new Map(periodIds.map((pid) => [pid, zeroSeededMap(vehicleIds)]));
  if (vehicleIds.length === 0 || periodIds.length === 0) return out;

  const expenseRows = await db
    .select({
      vehicleId: expense.vehicleId,
      periodId: expense.postedPeriodId,
      total: sql<string>`SUM(${expense.amountMinor})`,
    })
    .from(expense)
    .where(
      and(
        inArray(expense.vehicleId, vehicleIds),
        inArray(expense.postedPeriodId, periodIds),
        eq(expense.borneBy, "us"),
        isNull(expense.voidedAt),
      ),
    )
    .groupBy(expense.vehicleId, expense.postedPeriodId);
  const obligationRows = await db
    .select({
      vehicleId: obligation.vehicleId,
      periodId: obligation.postedPeriodId,
      total: sql<string>`SUM(${obligation.amountMinor})`,
    })
    .from(obligation)
    .where(
      and(
        inArray(obligation.vehicleId, vehicleIds),
        inArray(obligation.postedPeriodId, periodIds),
        eq(obligation.direction, "owed_by_us"),
        sql`${obligation.kind} IN ('driver_fee', 'management_fee')`,
        isNull(obligation.voidedAt),
      ),
    )
    .groupBy(obligation.vehicleId, obligation.postedPeriodId);

  foldIntoNestedBigIntMap(out, expenseRows);
  foldIntoNestedBigIntMap(out, obligationRows);
  return out;
}

/**
 * UC-79/GAP-19: `sumVehicleEarnedForPeriod`'s own logic, keyed by an
 * arbitrary date window instead of an accounting period — the utilisation
 * report's own `from`/`to` rarely lines up with one. Same fact, same
 * columns, same "never spread across days it wasn't actually posted for"
 * reading `postedPeriodId` already carries (W-25: rent is a fixed amount
 * per billing period, never prorated per day) — a monthly `rent` obligation
 * counts on its own `due_on`, exactly as it already does when it happens to
 * land in one accounting period rather than another. `obligation.dueOn` for
 * the window, `trip.closingDate` for the window (UC-70's own "trips by
 * closing date", INV-30).
 */
export async function sumVehicleEarnedForDateRange(
  db: ReadDb,
  vehicleId: string,
  from: string,
  to: string,
): Promise<bigint> {
  const obligationRows = await db
    .select({ amountMinor: obligation.amountMinor })
    .from(obligation)
    .where(
      and(
        eq(obligation.vehicleId, vehicleId),
        gte(obligation.dueOn, from),
        lte(obligation.dueOn, to),
        eq(obligation.direction, "owed_to_us"),
        sql`${obligation.kind} IN ('rent', 'daily_amount', 'mileage_excess')`,
        isNull(obligation.voidedAt),
      ),
    );
  const tripRows = await db
    .select({ amountMinor: trip.agreedAmountMinor })
    .from(trip)
    .where(
      and(
        eq(trip.vehicleId, vehicleId),
        gte(trip.closingDate, from),
        lte(trip.closingDate, to),
        eq(trip.status, "closed"),
      ),
    );
  return (
    obligationRows.reduce((sum, r) => sum + r.amountMinor, 0n) +
    tripRows.reduce((sum, r) => sum + r.amountMinor, 0n)
  );
}

/** GAP-145: `sumVehicleEarnedForDateRange`'s own two queries, grouped across every vehicle in `vehicleIds` — `getVehicleYearReport`'s own per-vehicle loop, see `sumVehicleEarnedForPeriodBulk`'s comment for why this exists. */
export async function sumVehicleEarnedForDateRangeBulk(
  db: ReadDb,
  vehicleIds: string[],
  from: string,
  to: string,
): Promise<Map<string, bigint>> {
  const out = zeroSeededMap(vehicleIds);
  if (vehicleIds.length === 0) return out;

  const obligationRows = await db
    .select({
      vehicleId: obligation.vehicleId,
      total: sql<string>`SUM(${obligation.amountMinor})`,
    })
    .from(obligation)
    .where(
      and(
        inArray(obligation.vehicleId, vehicleIds),
        gte(obligation.dueOn, from),
        lte(obligation.dueOn, to),
        eq(obligation.direction, "owed_to_us"),
        sql`${obligation.kind} IN ('rent', 'daily_amount', 'mileage_excess')`,
        isNull(obligation.voidedAt),
      ),
    )
    .groupBy(obligation.vehicleId);
  const tripRows = await db
    .select({ vehicleId: trip.vehicleId, total: sql<string>`SUM(${trip.agreedAmountMinor})` })
    .from(trip)
    .where(
      and(
        inArray(trip.vehicleId, vehicleIds),
        gte(trip.closingDate, from),
        lte(trip.closingDate, to),
        eq(trip.status, "closed"),
      ),
    )
    .groupBy(trip.vehicleId);

  foldIntoBigIntMap(out, obligationRows);
  foldIntoBigIntMap(out, tripRows);
  return out;
}

/**
 * GAP-18/UC-73: `sumVehicleCostsForPeriod`'s own logic, keyed by an
 * arbitrary date window the way `sumVehicleEarnedForDateRange` already is
 * for the earned side — `expense.spentOn` and `obligation.dueOn` in place of
 * `postedPeriodId`, same kind/direction/borne-by filters, same reasoning.
 */
export async function sumVehicleCostsForDateRange(
  db: ReadDb,
  vehicleId: string,
  from: string,
  to: string,
): Promise<bigint> {
  const expenseRows = await db
    .select({ amountMinor: expense.amountMinor })
    .from(expense)
    .where(
      and(
        eq(expense.vehicleId, vehicleId),
        gte(expense.spentOn, from),
        lte(expense.spentOn, to),
        eq(expense.borneBy, "us"),
        isNull(expense.voidedAt),
      ),
    );
  const obligationRows = await db
    .select({ amountMinor: obligation.amountMinor })
    .from(obligation)
    .where(
      and(
        eq(obligation.vehicleId, vehicleId),
        gte(obligation.dueOn, from),
        lte(obligation.dueOn, to),
        eq(obligation.direction, "owed_by_us"),
        sql`${obligation.kind} IN ('driver_fee', 'management_fee')`,
        isNull(obligation.voidedAt),
      ),
    );
  return (
    expenseRows.reduce((sum, r) => sum + r.amountMinor, 0n) +
    obligationRows.reduce((sum, r) => sum + r.amountMinor, 0n)
  );
}

/** GAP-145: `sumVehicleCostsForDateRange`'s own two queries, grouped across every vehicle in `vehicleIds` — see `sumVehicleEarnedForPeriodBulk`'s comment for why this exists. */
export async function sumVehicleCostsForDateRangeBulk(
  db: ReadDb,
  vehicleIds: string[],
  from: string,
  to: string,
): Promise<Map<string, bigint>> {
  const out = zeroSeededMap(vehicleIds);
  if (vehicleIds.length === 0) return out;

  const expenseRows = await db
    .select({ vehicleId: expense.vehicleId, total: sql<string>`SUM(${expense.amountMinor})` })
    .from(expense)
    .where(
      and(
        inArray(expense.vehicleId, vehicleIds),
        gte(expense.spentOn, from),
        lte(expense.spentOn, to),
        eq(expense.borneBy, "us"),
        isNull(expense.voidedAt),
      ),
    )
    .groupBy(expense.vehicleId);
  const obligationRows = await db
    .select({
      vehicleId: obligation.vehicleId,
      total: sql<string>`SUM(${obligation.amountMinor})`,
    })
    .from(obligation)
    .where(
      and(
        inArray(obligation.vehicleId, vehicleIds),
        gte(obligation.dueOn, from),
        lte(obligation.dueOn, to),
        eq(obligation.direction, "owed_by_us"),
        sql`${obligation.kind} IN ('driver_fee', 'management_fee')`,
        isNull(obligation.voidedAt),
      ),
    )
    .groupBy(obligation.vehicleId);

  foldIntoBigIntMap(out, expenseRows);
  foldIntoBigIntMap(out, obligationRows);
  return out;
}

/** UC-70/DM §15, reproduced verbatim: a cost query reading only `expense` under-reports every month with a trip by exactly its driver fee (W-53 covers the management fee the same way). Verified against G-1: 37,000 + 9,000 = 46,000. */
export async function sumVehicleCostsForPeriod(
  db: ReadDb,
  vehicleId: string,
  periodId: string,
): Promise<bigint> {
  const expenseRows = await db
    .select({ amountMinor: expense.amountMinor })
    .from(expense)
    .where(
      and(
        eq(expense.vehicleId, vehicleId),
        eq(expense.postedPeriodId, periodId),
        eq(expense.borneBy, "us"),
        isNull(expense.voidedAt),
      ),
    );
  const obligationRows = await db
    .select({ amountMinor: obligation.amountMinor })
    .from(obligation)
    .where(
      and(
        eq(obligation.vehicleId, vehicleId),
        eq(obligation.postedPeriodId, periodId),
        eq(obligation.direction, "owed_by_us"),
        sql`${obligation.kind} IN ('driver_fee', 'management_fee')`,
        isNull(obligation.voidedAt),
      ),
    );
  return (
    expenseRows.reduce((sum, r) => sum + r.amountMinor, 0n) +
    obligationRows.reduce((sum, r) => sum + r.amountMinor, 0n)
  );
}

/** GAP-145: `sumVehicleCostsForPeriod`'s own two queries, grouped across every vehicle in `vehicleIds` instead of run once per vehicle — see `sumVehicleEarnedForPeriodBulk`'s own comment for why. */
export async function sumVehicleCostsForPeriodBulk(
  db: ReadDb,
  vehicleIds: string[],
  periodId: string,
): Promise<Map<string, bigint>> {
  const out = zeroSeededMap(vehicleIds);
  if (vehicleIds.length === 0) return out;

  const expenseRows = await db
    .select({ vehicleId: expense.vehicleId, total: sql<string>`SUM(${expense.amountMinor})` })
    .from(expense)
    .where(
      and(
        inArray(expense.vehicleId, vehicleIds),
        eq(expense.postedPeriodId, periodId),
        eq(expense.borneBy, "us"),
        isNull(expense.voidedAt),
      ),
    )
    .groupBy(expense.vehicleId);
  const obligationRows = await db
    .select({
      vehicleId: obligation.vehicleId,
      total: sql<string>`SUM(${obligation.amountMinor})`,
    })
    .from(obligation)
    .where(
      and(
        inArray(obligation.vehicleId, vehicleIds),
        eq(obligation.postedPeriodId, periodId),
        eq(obligation.direction, "owed_by_us"),
        sql`${obligation.kind} IN ('driver_fee', 'management_fee')`,
        isNull(obligation.voidedAt),
      ),
    )
    .groupBy(obligation.vehicleId);

  foldIntoBigIntMap(out, expenseRows);
  foldIntoBigIntMap(out, obligationRows);
  return out;
}

/**
 * GAP-41/UC-66/W-32: the same filter set as `sumVehicleCostsForPeriod`'s
 * `expense` half, with `vehicle_id IS NULL` in place of a specific
 * vehicle. No `obligation` half — `driver_fee` and `management_fee` are
 * always raised against a vehicle's own arrangement, so an overhead
 * obligation cannot exist to double-count.
 */
export async function sumOverheadsForPeriod(
  db: ReadDb,
  businessId: string,
  periodId: string,
): Promise<bigint> {
  const rows = await db
    .select({ amountMinor: expense.amountMinor })
    .from(expense)
    .where(
      and(
        eq(expense.businessId, businessId),
        isNull(expense.vehicleId),
        eq(expense.postedPeriodId, periodId),
        eq(expense.borneBy, "us"),
        isNull(expense.voidedAt),
      ),
    );
  return rows.reduce((sum, r) => sum + r.amountMinor, 0n);
}

/** GAP-18/UC-73: `sumOverheadsForPeriod`'s own filter set, keyed by a date window (`expense.spent_on`) instead of `postedPeriodId` — a year has no single accounting period to key an overheads figure to. */
export async function sumOverheadsForDateRange(
  db: ReadDb,
  businessId: string,
  from: string,
  to: string,
): Promise<bigint> {
  const rows = await db
    .select({ amountMinor: expense.amountMinor })
    .from(expense)
    .where(
      and(
        eq(expense.businessId, businessId),
        isNull(expense.vehicleId),
        gte(expense.spentOn, from),
        lte(expense.spentOn, to),
        eq(expense.borneBy, "us"),
        isNull(expense.voidedAt),
      ),
    );
  return rows.reduce((sum, r) => sum + r.amountMinor, 0n);
}

export interface OwnershipShareRow {
  userId: string;
  shareBp: number;
}

/**
 * GAP-145: batched across every vehicle in `vehicleIds` rather than one
 * query per vehicle — this replaced a per-vehicle `findOwnershipSharesAsOf`
 * that was `getVehicleMonthReport`'s own share of the subrequest fan-out
 * behind a live 500 (`GET /api/partner/{userId}`, 79 subrequests for one
 * six-vehicle business against Workers Free's 50 ceiling). Valid only when
 * every vehicle in the batch shares the same `asOfDate` — true for both
 * current callers (`getVehicleMonthReport`'s one period end,
 * `getVehicleYearReport`'s one window end), never true across periods,
 * which is why `sumAllTimeEarnedForUser`'s own per-period loop reads its
 * ownership history separately rather than calling this once per period.
 *
 * Explicitly ordered by `id` (UUIDv7, so insertion order): `splitInteger`
 * (packages/shared) breaks a remainder tie by array position — "the
 * earlier index wins" — so the order shares arrive in is part of the money
 * result, not incidental, and an unordered `SELECT` leaves that to
 * whatever the query planner happens to pick.
 */
export async function findOwnershipSharesAsOfBulk(
  db: ReadDb,
  vehicleIds: string[],
  asOfDate: string,
): Promise<Map<string, OwnershipShareRow[]>> {
  const out = new Map<string, OwnershipShareRow[]>(vehicleIds.map((id) => [id, []]));
  if (vehicleIds.length === 0) return out;

  const rows = await db
    .select({
      id: ownershipShare.id,
      vehicleId: ownershipShare.vehicleId,
      userId: ownershipShare.userId,
      shareBp: ownershipShare.shareBp,
    })
    .from(ownershipShare)
    .where(
      and(
        inArray(ownershipShare.vehicleId, vehicleIds),
        lte(ownershipShare.effectiveFrom, asOfDate),
        sql`(${ownershipShare.effectiveTo} IS NULL OR ${ownershipShare.effectiveTo} >= ${asOfDate})`,
      ),
    )
    .orderBy(ownershipShare.id);
  for (const r of rows) {
    const existing = out.get(r.vehicleId) ?? [];
    existing.push({ userId: r.userId, shareBp: r.shareBp });
    out.set(r.vehicleId, existing);
  }
  return out;
}

export interface OwnershipShareHistoryRow extends OwnershipShareRow {
  effectiveFrom: string;
  effectiveTo: string | null;
}

/**
 * GAP-145: `sumAllTimeEarnedForUser`'s own read — every ownership-share row
 * that has ever existed for `vehicleIds`, one query, rather than one
 * `findOwnershipSharesAsOf`-shaped call per accounting period. INV-16's
 * effective-dating is evaluated in memory per period afterward, since a
 * vehicle's ownership can change between periods and each period's own
 * profit must split by whoever owned it as of *that* period's end — the
 * whole reason GAP-74 replays every period rather than reading one current
 * split. Same explicit `id` order as `findOwnershipSharesAsOfBulk`, for the
 * same `splitInteger` tie-break reason.
 */
export async function listOwnershipShareHistoryForVehicles(
  db: ReadDb,
  vehicleIds: string[],
): Promise<Map<string, OwnershipShareHistoryRow[]>> {
  const out = new Map<string, OwnershipShareHistoryRow[]>(vehicleIds.map((id) => [id, []]));
  if (vehicleIds.length === 0) return out;

  const rows = await db
    .select({
      id: ownershipShare.id,
      vehicleId: ownershipShare.vehicleId,
      userId: ownershipShare.userId,
      shareBp: ownershipShare.shareBp,
      effectiveFrom: ownershipShare.effectiveFrom,
      effectiveTo: ownershipShare.effectiveTo,
    })
    .from(ownershipShare)
    .where(inArray(ownershipShare.vehicleId, vehicleIds))
    .orderBy(ownershipShare.id);
  for (const r of rows) {
    const existing = out.get(r.vehicleId) ?? [];
    existing.push({
      userId: r.userId,
      shareBp: r.shareBp,
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo,
    });
    out.set(r.vehicleId, existing);
  }
  return out;
}

/** UC-71: every closed trip for this business, with what a ranking needs — the cost sum and the two odometer readings, each fetched in one bulk query rather than one per trip. */
export interface ClosedTripForReport {
  id: string;
  vehicleId: string;
  agreedAmountMinor: bigint;
  driverFeeMinor: bigint;
  costsMinor: bigint;
  distanceKm: number | null;
}

export async function listClosedTripsForReport(
  db: ReadDb,
  businessId: string,
): Promise<ClosedTripForReport[]> {
  const trips = await db
    .select({
      id: trip.id,
      vehicleId: trip.vehicleId,
      agreedAmountMinor: trip.agreedAmountMinor,
      driverFeeMinor: trip.driverFeeMinor,
      openingOdometerId: trip.openingOdometerId,
      closingOdometerId: trip.closingOdometerId,
    })
    .from(trip)
    .where(and(eq(trip.businessId, businessId), eq(trip.status, "closed")));
  if (trips.length === 0) return [];

  const tripIds = trips.map((t) => t.id);
  const costRows = await db
    .select({ tripId: expense.tripId, amountMinor: sql<string>`SUM(${expense.amountMinor})` })
    .from(expense)
    .where(
      and(inArray(expense.tripId, tripIds), eq(expense.borneBy, "us"), isNull(expense.voidedAt)),
    )
    .groupBy(expense.tripId);
  const costByTrip = new Map(costRows.map((r) => [r.tripId, BigInt(r.amountMinor)]));

  const odometerIds = trips
    .flatMap((t) => [t.openingOdometerId, t.closingOdometerId])
    .filter((id): id is string => id !== null);
  const odometerRows =
    odometerIds.length > 0
      ? await db
          .select({ id: odometerReading.id, readingKm: odometerReading.readingKm })
          .from(odometerReading)
          .where(inArray(odometerReading.id, odometerIds))
      : [];
  const kmById = new Map(odometerRows.map((r) => [r.id, r.readingKm]));

  return trips.map((t) => {
    const openingKm =
      t.openingOdometerId !== null ? (kmById.get(t.openingOdometerId) ?? null) : null;
    const closingKm =
      t.closingOdometerId !== null ? (kmById.get(t.closingOdometerId) ?? null) : null;
    return {
      id: t.id,
      vehicleId: t.vehicleId,
      agreedAmountMinor: t.agreedAmountMinor,
      driverFeeMinor: t.driverFeeMinor,
      // eslint-disable-next-line no-restricted-syntax -- allow: no expense row for this trip is a real zero cost, not a missing figure (W-56 governs an unknown, not an absent one)
      costsMinor: costByTrip.get(t.id) ?? 0n,
      distanceKm: openingKm !== null && closingKm !== null ? closingKm - openingKm : null,
    };
  });
}

/** UC-72: fuel efficiency only for `borne_by = 'us'` fuel — his own fuel on a daily lease has no litres you can trust (W-20). Grouped by vehicle; ordered by date so the caller can read it as a fill-to-fill series and pair each fill against the one before it. */
export interface FuelFillForReport {
  vehicleId: string;
  spentOn: string;
  amountMinor: bigint;
  litres: number | null;
  readingKm: number | null;
}

export async function listUsBoughtFuelFills(
  db: ReadDb,
  businessId: string,
  vehicleId: string,
  from: string,
  to: string,
): Promise<FuelFillForReport[]> {
  const rows = await db
    .select({
      vehicleId: expense.vehicleId,
      spentOn: expense.spentOn,
      amountMinor: expense.amountMinor,
      litres: expense.litres,
      odometerReadingId: expense.odometerReadingId,
    })
    .from(expense)
    .where(
      and(
        eq(expense.businessId, businessId),
        eq(expense.vehicleId, vehicleId),
        eq(expense.category, "fuel"),
        eq(expense.borneBy, "us"),
        isNull(expense.voidedAt),
        gte(expense.spentOn, from),
        lte(expense.spentOn, to),
      ),
    )
    .orderBy(asc(expense.spentOn));

  const readingIds = rows.map((r) => r.odometerReadingId).filter((id): id is string => id !== null);
  const readingRows =
    readingIds.length > 0
      ? await db
          .select({ id: odometerReading.id, readingKm: odometerReading.readingKm })
          .from(odometerReading)
          .where(inArray(odometerReading.id, readingIds))
      : [];
  const kmById = new Map(readingRows.map((r) => [r.id, r.readingKm]));

  return rows.map((r) => ({
    vehicleId: r.vehicleId as string,
    spentOn: r.spentOn,
    amountMinor: r.amountMinor,
    litres: r.litres,
    readingKm: r.odometerReadingId !== null ? (kmById.get(r.odometerReadingId) ?? null) : null,
  }));
}

/** UC-74/DM §15, reproduced verbatim: one row per party. `written_off` obligations are already excluded by the `status IN ('pending','part_paid')` filter — the entire point of writing one off. */
export interface ReceivableRow {
  partyType: "customer" | "driver" | "partner";
  partyId: string;
  outstandingMinor: bigint;
  oldestDueOn: string;
}

export async function listReceivables(db: ReadDb, businessId: string): Promise<ReceivableRow[]> {
  const rows = await db
    .select({
      partyType: obligation.partyType,
      partyCustomerId: obligation.partyCustomerId,
      partyDriverId: obligation.partyDriverId,
      partyUserId: obligation.partyUserId,
      outstandingMinor: sql<string>`SUM(${obligation.amountMinor} - ${obligation.settledMinor} - ${obligation.waivedMinor})`,
      oldestDueOn: sql<string>`MIN(${obligation.effectiveDueOn})`,
    })
    .from(obligation)
    .where(
      and(
        eq(obligation.businessId, businessId),
        eq(obligation.direction, "owed_to_us"),
        sql`${obligation.status} IN ('pending', 'part_paid')`,
        isNull(obligation.voidedAt),
      ),
    )
    .groupBy(
      obligation.partyType,
      obligation.partyCustomerId,
      obligation.partyDriverId,
      obligation.partyUserId,
    );
  return rows.map((r) => ({
    partyType: r.partyType as "customer" | "driver" | "partner",
    partyId: (r.partyCustomerId ?? r.partyDriverId ?? r.partyUserId) as string,
    outstandingMinor: BigInt(r.outstandingMinor),
    oldestDueOn: r.oldestDueOn,
  }));
}

/** UC-78/DM §15, reproduced verbatim: each obligation ages on its own date; the party total is the sum of its buckets, never a bucket of its sum (the report's own correctness question). `asOfDate` is the business date, passed in as a parameter — the server's own clock/timezone never enters into it (CLAUDE.md → Time). */
export interface AgeingRow {
  partyType: "customer" | "driver" | "partner";
  partyId: string;
  bucket: "current" | "1-30" | "31-60" | "61-90" | "over-90";
  outstandingMinor: bigint;
}

export async function listAgeingBuckets(
  db: ReadDb,
  businessId: string,
  asOfDate: string,
): Promise<AgeingRow[]> {
  const rows = await db
    .select({
      partyType: obligation.partyType,
      partyCustomerId: obligation.partyCustomerId,
      partyDriverId: obligation.partyDriverId,
      partyUserId: obligation.partyUserId,
      outstandingMinor: obligation.amountMinor,
      settledMinor: obligation.settledMinor,
      waivedMinor: obligation.waivedMinor,
      effectiveDueOn: obligation.effectiveDueOn,
    })
    .from(obligation)
    .where(
      and(
        eq(obligation.businessId, businessId),
        eq(obligation.direction, "owed_to_us"),
        sql`${obligation.status} IN ('pending', 'part_paid')`,
        isNull(obligation.voidedAt),
      ),
    );

  const buckets = new Map<string, AgeingRow>();
  for (const row of rows) {
    const outstanding = row.outstandingMinor - row.settledMinor - row.waivedMinor;
    if (outstanding <= 0n) continue;

    const daysLate =
      (Date.parse(asOfDate) - Date.parse(row.effectiveDueOn)) / (1000 * 60 * 60 * 24);
    const bucket: AgeingRow["bucket"] =
      daysLate <= 0
        ? "current"
        : daysLate <= 30
          ? "1-30"
          : daysLate <= 60
            ? "31-60"
            : daysLate <= 90
              ? "61-90"
              : "over-90";

    const partyId = (row.partyCustomerId ?? row.partyDriverId ?? row.partyUserId) as string;
    const key = `${row.partyType}:${partyId}:${bucket}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.outstandingMinor += outstanding;
    } else {
      buckets.set(key, {
        partyType: row.partyType as "customer" | "driver" | "partner",
        partyId,
        bucket,
        outstandingMinor: outstanding,
      });
    }
  }
  return [...buckets.values()];
}

/** UC-75/DM §15, reproduced verbatim (with the DM §15's own found-and-fixed correction: `payment` has no `voided_at` — it is corrected through `status` instead, §10.2). Deposits are deliberately not part of this figure — they are a liability shown beside it, never netted in (§6.13). */
export interface PartnerCashRow {
  userId: string;
  displayName: string | null;
  heldMinor: bigint;
}

export async function listPartnerCashPositions(
  db: ReadDb,
  businessId: string,
): Promise<PartnerCashRow[]> {
  const memberRows = await db
    .select({ userId: businessMember.userId })
    .from(businessMember)
    .where(and(eq(businessMember.businessId, businessId), isNull(businessMember.revokedAt)));
  const userIds = memberRows.map((r) => r.userId);
  if (userIds.length === 0) return [];

  const users = await db
    .select({ id: appUser.id, displayName: appUser.displayName })
    .from(appUser)
    .where(inArray(appUser.id, userIds));

  const receivedRows = await db
    .select({
      uid: payment.handledByUserId,
      total: sql<string>`SUM(${payment.amountMinor})`,
    })
    .from(payment)
    .where(
      and(
        eq(payment.businessId, businessId),
        eq(payment.direction, "received"),
        eq(payment.status, "active"),
        inArray(payment.handledByUserId, userIds),
      ),
    )
    .groupBy(payment.handledByUserId);
  const receivedByUser = new Map(receivedRows.map((r) => [r.uid, BigInt(r.total)]));

  const bankedRows = await db
    .select({
      uid: bankingEvent.fromUserId,
      total: sql<string>`SUM(${bankingEvent.amountCountedMinor})`,
    })
    .from(bankingEvent)
    .where(and(eq(bankingEvent.businessId, businessId), isNull(bankingEvent.voidedAt)))
    .groupBy(bankingEvent.fromUserId);
  const bankedByUser = new Map(bankedRows.map((r) => [r.uid, BigInt(r.total)]));

  const advancedRows = await db
    .select({
      uid: advance.issuedByUserId,
      total: sql<string>`SUM(${advance.amountMinor})`,
    })
    .from(advance)
    .where(
      and(
        eq(advance.businessId, businessId),
        ne(advance.status, "settled"),
        isNull(advance.voidedAt),
      ),
    )
    .groupBy(advance.issuedByUserId);
  const advancedByUser = new Map(advancedRows.map((r) => [r.uid, BigInt(r.total)]));

  // allow: a partner with no rows in one of these three sums genuinely moved nothing in that category — a real zero, not a missing figure (W-56)
  return users.map((u) => {
    const received = receivedByUser.get(u.id) ?? 0n; // eslint-disable-line no-restricted-syntax -- see the allow note above
    const banked = bankedByUser.get(u.id) ?? 0n; // eslint-disable-line no-restricted-syntax -- see the allow note above
    const advanced = advancedByUser.get(u.id) ?? 0n; // eslint-disable-line no-restricted-syntax -- see the allow note above
    return { userId: u.id, displayName: u.displayName, heldMinor: received - banked - advanced };
  });
}

/** GAP-70/DM §15: the same `banking_event` rows `listPartnerCashPositions` already subtracts, regrouped by destination — no enum, `destination` is free text a manager types once and reuses (F-7.4). */
export interface BankedRow {
  destination: string;
  heldMinor: bigint;
}

export async function listBankedByDestination(
  db: ReadDb,
  businessId: string,
): Promise<BankedRow[]> {
  const rows = await db
    .select({
      destination: bankingEvent.destination,
      total: sql<string>`SUM(${bankingEvent.amountCountedMinor})`,
    })
    .from(bankingEvent)
    .where(and(eq(bankingEvent.businessId, businessId), isNull(bankingEvent.voidedAt)))
    .groupBy(bankingEvent.destination);
  return rows.map((r) => ({ destination: r.destination, heldMinor: BigInt(r.total) }));
}

/**
 * GAP-70/DM §15: the same unsettled-advance rows `listPartnerCashPositions`
 * already subtracts, regrouped by who is holding the cash rather than who
 * issued it. Kept arithmetically consistent with that query's own
 * simplification — a `part_settled` advance counts at its full
 * `amount_minor` here too, not netted against `advance_settlement`
 * (correcting that underlying simplification is a separate question, DM
 * §15's own stated reason for not doing it here).
 */
export interface DriverAdvanceRow {
  driverId: string;
  driverName: string | null;
  outstandingMinor: bigint;
}

export async function listAdvancesOutstandingByDriver(
  db: ReadDb,
  businessId: string,
): Promise<DriverAdvanceRow[]> {
  const rows = await db
    .select({
      driverId: driver.id,
      driverName: driver.name,
      total: sql<string>`SUM(${advance.amountMinor})`,
    })
    .from(advance)
    .innerJoin(driver, eq(driver.id, advance.driverId))
    .where(
      and(
        eq(advance.businessId, businessId),
        ne(advance.status, "settled"),
        isNull(advance.voidedAt),
      ),
    )
    .groupBy(driver.id, driver.name);
  return rows.map((r) => ({
    driverId: r.driverId,
    driverName: r.driverName,
    outstandingMinor: BigInt(r.total),
  }));
}

/**
 * Deposits held — the liability shown *beside* the cash position (§6.13),
 * never netted into `listPartnerCashPositions`'s own figure. DM §10.4's own
 * design: the held balance is the SUM of a deposit's movements, never a
 * stored column this read could go stale against — `sumDepositMovements`
 * (queries/driver-money.ts) is the one place that sign logic lives, reused
 * here rather than re-derived. The number of currently-held deposits is
 * bounded (one per driver/customer with an open deposit), so summing each
 * individually is a small, real read, not the per-row bulk-write loop
 * IG §2 warns against.
 */
export async function sumDepositsHeld(db: ReadDb, businessId: string): Promise<bigint> {
  const rows = await db
    .select({ id: deposit.id })
    .from(deposit)
    .where(
      and(eq(deposit.businessId, businessId), sql`${deposit.status} IN ('held', 'hold_window')`),
    );
  let total = 0n;
  for (const row of rows) {
    total += await sumDepositMovements(db, row.id);
  }
  return total;
}

/** UC-76/DM §15, reproduced verbatim: off-pattern days have no row at all (§1.2 B), so `not_scheduled` is excluded by construction and charter days are excluded by the `state <> 'paused_for_trip'` filter — the denominator is `ran + lost` and cannot be inflated by either. */
export interface LostDaysRow {
  driverId: string;
  lost: number;
  ran: number;
  leaseEligible: number;
  lostValueMinor: bigint;
  weekday: number;
}

export async function listLostDays(
  db: ReadDb,
  businessId: string,
  from: string,
  to: string,
): Promise<LostDaysRow[]> {
  const rows = await db
    .select({
      driverId: dayRecord.driverId,

      lost: sql<number>`COUNT(*) FILTER (WHERE ${dayRecord.state} = 'did_not_run')::int`,

      ran: sql<number>`COUNT(*) FILTER (WHERE ${dayRecord.state} LIKE 'ran_%')::int`,

      leaseEligible: sql<number>`COUNT(*)::int`,
      lostValueMinor: sql<string>`COALESCE(SUM(${dayRecord.expectedMinor}) FILTER (WHERE ${dayRecord.state} = 'did_not_run'), 0)`,

      weekday: sql<number>`EXTRACT(dow FROM ${dayRecord.businessDate})::int`,
    })
    .from(dayRecord)
    .where(
      and(
        eq(dayRecord.businessId, businessId),
        gte(dayRecord.businessDate, from),
        lte(dayRecord.businessDate, to),
        ne(dayRecord.state, "paused_for_trip"),
        isNull(dayRecord.voidedAt), // GAP-118: a stale card off a changed driver is not that driver's ran/lost day
      ),
    )
    .groupBy(dayRecord.driverId, sql`EXTRACT(dow FROM ${dayRecord.businessDate})`);
  return rows.map((r) => ({ ...r, lostValueMinor: BigInt(r.lostValueMinor) }));
}

/** GAP-71/DM §15: the same rows as `listLostDays`, regrouped by calendar month instead of weekday — UI §11.1's primary form for UC-76 ("column per month"). `to_char` rather than `date_trunc`: the report reads a plain string bucket, not a timestamp, and a driver with no lost days in a given month simply has no row for it (W-56 — the correct absence, not a manufactured zero). */
export interface LostDaysMonthRow {
  driverId: string;
  lost: number;
  ran: number;
  leaseEligible: number;
  lostValueMinor: bigint;
  month: string;
}

export async function listLostDaysByMonth(
  db: ReadDb,
  businessId: string,
  from: string,
  to: string,
): Promise<LostDaysMonthRow[]> {
  const rows = await db
    .select({
      driverId: dayRecord.driverId,
      lost: sql<number>`COUNT(*) FILTER (WHERE ${dayRecord.state} = 'did_not_run')::int`,
      ran: sql<number>`COUNT(*) FILTER (WHERE ${dayRecord.state} LIKE 'ran_%')::int`,
      leaseEligible: sql<number>`COUNT(*)::int`,
      lostValueMinor: sql<string>`COALESCE(SUM(${dayRecord.expectedMinor}) FILTER (WHERE ${dayRecord.state} = 'did_not_run'), 0)`,
      month: sql<string>`to_char(${dayRecord.businessDate}, 'YYYY-MM')`,
    })
    .from(dayRecord)
    .where(
      and(
        eq(dayRecord.businessId, businessId),
        gte(dayRecord.businessDate, from),
        lte(dayRecord.businessDate, to),
        ne(dayRecord.state, "paused_for_trip"),
        isNull(dayRecord.voidedAt), // GAP-118: a stale card off a changed driver is not that driver's ran/lost day
      ),
    )
    .groupBy(dayRecord.driverId, sql`to_char(${dayRecord.businessDate}, 'YYYY-MM')`);
  return rows.map((r) => ({ ...r, lostValueMinor: BigInt(r.lostValueMinor) }));
}

/** GAP-71/DM §15: lost days only, grouped by `lost_reason` — CHECK-constrained non-null whenever `state = 'did_not_run'` (§7), so nothing this query touches can be `NULL` by construction. */
export interface LostDaysReasonRow {
  driverId: string;
  reason: string;
  lost: number;
  lostValueMinor: bigint;
}

export async function listLostDaysByReason(
  db: ReadDb,
  businessId: string,
  from: string,
  to: string,
): Promise<LostDaysReasonRow[]> {
  const rows = await db
    .select({
      driverId: dayRecord.driverId,
      reason: dayRecord.lostReason,
      lost: sql<number>`COUNT(*)::int`,
      lostValueMinor: sql<string>`COALESCE(SUM(${dayRecord.expectedMinor}), 0)`,
    })
    .from(dayRecord)
    .where(
      and(
        eq(dayRecord.businessId, businessId),
        gte(dayRecord.businessDate, from),
        lte(dayRecord.businessDate, to),
        eq(dayRecord.state, "did_not_run"),
        isNull(dayRecord.voidedAt), // GAP-118: a stale card off a changed driver is not that driver's lost day
      ),
    )
    .groupBy(dayRecord.driverId, dayRecord.lostReason);
  // allow: lost_reason is NOT NULL whenever state = 'did_not_run' (CHECK, DM §7) — the WHERE clause above guarantees every row's reason is non-null
  return rows.map((r) => ({
    ...r,
    reason: r.reason as string,
    lostValueMinor: BigInt(r.lostValueMinor),
  }));
}

/**
 * UC-77: every waiver you chose to give (`waiver`/`auto_waiver`/`goodwill`),
 * never pooled with a write-off (W-28) — a write-off is reported entirely
 * separately, from `write_off`, not this table.
 *
 * GAP-72: `from`/`to` are business dates, `created_at` is `timestamptz` —
 * comparing them directly (as this query did before) tests `to` at UTC
 * midnight, silently dropping the whole last day of every window, and
 * windows the business's own day against UTC rather than `timezone`
 * (CLAUDE.md → Time: never compare a business date to a bare timestamp).
 *
 * **`::date AT TIME ZONE tz` is not the fix it looks like** — verified
 * directly against Postgres, not assumed: `date AT TIME ZONE tz` first
 * upcasts the `date` to `timestamptz` at the *session's* zone (UTC on
 * this connection), then reinterprets that instant's wall-clock time in
 * `tz`, landing on the wrong value entirely (`pg_typeof` even reports the
 * result as `timestamp`, not `timestamptz` — a sign this was resolving to
 * a different overload than intended). Casting to a bare `::timestamp`
 * first — genuinely naive, no zone attached — is what makes `AT TIME
 * ZONE tz` read it as *that* wall-clock time *in* `tz` and convert
 * correctly to the equivalent `timestamptz`. `interval '1 day'` on the
 * upper bound for the same reason: `timestamp + integer` is not valid,
 * where `date + integer` silently was, on the wrong type.
 */
export interface GoodwillByTypeRow {
  adjustmentType: string;
  totalMinor: bigint;
}

/**
 * GAP-73: windows on `occurred_on` (migration 0017), the business date the
 * waiver was actually given — `created_at` was when the row was inserted,
 * which is a different date whenever U-8's "any record can be entered for a
 * past date" applies, exactly as GAP-56 was for `expense.spent_on` before
 * it. `occurred_on` is a plain `date`; no `AT TIME ZONE` conversion is
 * needed the way `created_at`'s `timestamptz` required, since the column is
 * already a business date, not an instant to localise.
 *
 * Grouped by `adjustment_type` — the real enum every row already carries —
 * rather than the sparse free-text `reason` column.
 *
 * `-sign * amount_minor` per row, not the bare (always-positive)
 * `amount_minor`: a `waiver`/`auto_waiver` is always `sign = -1` (the wire
 * schema's own `.refine()`, DM §10.3), so `-sign * amount_minor` is
 * `+amount_minor` — the waived amount, as goodwill given should read. A
 * free-standing `goodwill` adjustment can carry either sign (F-2.4's
 * general "adjustment ± with a reason"); `sign = -1` there is a discount —
 * goodwill given, same positive contribution — while `sign = 1` is an
 * increase, which the old bare sum counted as goodwill given regardless of
 * direction. The uniform `-sign * amount_minor` formula treats a `sign = 1`
 * entry against one of the three types as clawing back goodwill previously
 * given, not adding to it.
 */
export async function sumGoodwillGiven(
  db: ReadDb,
  businessId: string,
  from: string,
  to: string,
): Promise<GoodwillByTypeRow[]> {
  const rows = await db
    .select({
      adjustmentType: adjustment.adjustmentType,
      totalMinor: sql<string>`SUM(-${adjustment.sign} * ${adjustment.amountMinor})`,
    })
    .from(adjustment)
    .where(
      and(
        eq(adjustment.businessId, businessId),
        sql`${adjustment.adjustmentType} IN ('waiver', 'auto_waiver', 'goodwill')`,
        isNull(adjustment.voidedAt),
        gte(adjustment.occurredOn, from),
        lte(adjustment.occurredOn, to),
      ),
    )
    .groupBy(adjustment.adjustmentType);
  return rows.map((r) => ({ adjustmentType: r.adjustmentType, totalMinor: BigInt(r.totalMinor) }));
}

/** UC-79: a day is "earning" if it ran on a daily lease — everything else on this vehicle's own daily-lease calendar in range is idle or off-road, decided elsewhere. */
export async function countEarningDaysForVehicle(
  db: ReadDb,
  businessId: string,
  vehicleId: string,
  from: string,
  to: string,
): Promise<{ ranDays: number; lostDays: number }> {
  const rows = await db
    .select({
      ranDays: sql<number>`COUNT(*) FILTER (WHERE ${dayRecord.state} LIKE 'ran_%')::int`,

      lostDays: sql<number>`COUNT(*) FILTER (WHERE ${dayRecord.state} = 'did_not_run')::int`,
    })
    .from(dayRecord)
    .where(
      and(
        eq(dayRecord.businessId, businessId),
        eq(dayRecord.vehicleId, vehicleId),
        gte(dayRecord.businessDate, from),
        lte(dayRecord.businessDate, to),
        isNull(dayRecord.voidedAt), // GAP-118: a stale card off a changed driver is not this vehicle's ran/lost day either
      ),
    );
  return rows[0] ?? { ranDays: 0, lostDays: 0 };
}

/** UC-79: lease days (arrangement 'A') and trip days (arrangement 'C') both count as "earning" — read from `vehicle_day_allocation`'s own arrangement column rather than re-derived, since that table is already the single source for occupancy (P6). */
export async function countAllocatedDaysForVehicle(
  db: ReadDb,
  businessId: string,
  vehicleId: string,
  arrangement: "A" | "C",
  from: string,
  to: string,
): Promise<number> {
  const rows = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*) AS count FROM vehicle_day_allocation
     WHERE business_id = ${businessId} AND vehicle_id = ${vehicleId}
       AND business_date BETWEEN ${from} AND ${to}
       AND arrangement = ${arrangement} AND is_hold = false
  `);
  // eslint-disable-next-line no-restricted-syntax -- a day count, not money
  return Number(rows.rows[0]?.count ?? "0");
}

/**
 * UC-79's "days off the road": an incident's own `off_road_from`/`off_road_to`
 * range, clipped to `[from, to]` and summed — an incident with no off-road
 * window recorded (`continue`, the default treatment) contributes nothing.
 */
export interface OffRoadRangeRow {
  offRoadFrom: string;
  offRoadTo: string;
}

export async function listOffRoadRangesForVehicle(
  db: ReadDb,
  businessId: string,
  vehicleId: string,
  from: string,
  to: string,
): Promise<OffRoadRangeRow[]> {
  const rows = await db
    .select({ offRoadFrom: incident.offRoadFrom, offRoadTo: incident.offRoadTo })
    .from(incident)
    .where(
      and(
        eq(incident.businessId, businessId),
        eq(incident.vehicleId, vehicleId),
        sql`${incident.offRoadFrom} IS NOT NULL AND ${incident.offRoadTo} IS NOT NULL`,
        lte(incident.offRoadFrom, to),
        gte(incident.offRoadTo, from),
      ),
    );
  return rows as OffRoadRangeRow[];
}

/**
 * F-1.10/GAP-26: UC-79's second off-road source — every live
 * `vehicle_unavailability` range overlapping `[from, to]`, clipped to the
 * window here (an open-ended outage has no far edge to clip in SQL, so a
 * `NULL unavailable_to` reads as `to` — "still off the road at the end of
 * this window," never further). Deliberately the same `OffRoadRangeRow`
 * shape as `listOffRoadRangesForVehicle` so the domain layer can merge both
 * sources' days without caring which table a range came from.
 */
export async function listVehicleUnavailabilityRangesForVehicle(
  db: ReadDb,
  businessId: string,
  vehicleId: string,
  from: string,
  to: string,
): Promise<OffRoadRangeRow[]> {
  const rows = await db
    .select({
      offRoadFrom: vehicleUnavailability.unavailableFrom,
      offRoadTo: sql<string>`least(coalesce(${vehicleUnavailability.unavailableTo}, ${to}), ${to})`,
    })
    .from(vehicleUnavailability)
    .where(
      and(
        eq(vehicleUnavailability.businessId, businessId),
        eq(vehicleUnavailability.vehicleId, vehicleId),
        isNull(vehicleUnavailability.voidedAt),
        lte(vehicleUnavailability.unavailableFrom, to),
        or(
          isNull(vehicleUnavailability.unavailableTo),
          gte(vehicleUnavailability.unavailableTo, from),
        ),
      ),
    );
  return rows;
}

/** For UC-74/76/78's own read: the customer/driver/partner name behind a receivable or ageing row — a convenience join the DM §15 queries themselves don't need, but a caller resolving a display list does. */
export async function findPartyNames(
  db: ReadDb,
  businessId: string,
  customerIds: string[],
  driverIds: string[],
  partnerUserIds: string[] = [],
): Promise<{
  customers: Map<string, string>;
  drivers: Map<string, string>;
  partners: Map<string, string | null>;
}> {
  const customerRows =
    customerIds.length > 0
      ? await db
          .select({ id: customer.id, name: customer.name })
          .from(customer)
          .where(and(eq(customer.businessId, businessId), inArray(customer.id, customerIds)))
      : [];
  const driverRows =
    driverIds.length > 0
      ? await db
          .select({ id: driver.id, name: driver.name })
          .from(driver)
          .where(and(eq(driver.businessId, businessId), inArray(driver.id, driverIds)))
      : [];
  const partnerRows =
    partnerUserIds.length > 0
      ? await db
          .select({ id: appUser.id, displayName: appUser.displayName })
          .from(appUser)
          .where(inArray(appUser.id, partnerUserIds))
      : [];
  return {
    customers: new Map(customerRows.map((r) => [r.id, r.name])),
    drivers: new Map(driverRows.map((r) => [r.id, r.name])),
    partners: new Map(partnerRows.map((r) => [r.id, r.displayName])),
  };
}

/** Scoped lookup for a report's own period boundaries — the server's clock/timezone never enters into it (IG §4.5/DM §15). */
export async function findPeriodBoundaries(
  db: ReadDb,
  businessId: string,
  periodId: string,
): Promise<{ periodStart: string; periodEnd: string } | undefined> {
  const rows = await db
    .select({ periodStart: accountingPeriod.periodStart, periodEnd: accountingPeriod.periodEnd })
    .from(accountingPeriod)
    .where(and(eq(accountingPeriod.id, periodId), eq(accountingPeriod.businessId, businessId)))
    .limit(1);
  return rows[0];
}

/**
 * GAP-18/UC-99: one row per money-recognition event in the window — the
 * spreadsheet is "a year of transactions", not a re-derived summary, so
 * these list rather than sum. `kind` carries the obligation kind, the
 * literal `"trip"`, or the expense `category`; the caller (domain layer)
 * gives each row its own human label. Business-wide, never per-vehicle
 * (UC-99 is one export for the year, not one per vehicle) — `registration`
 * is `null` for an overhead row (`vehicle_id IS NULL`), never a guessed one.
 */
export interface TransactionRow {
  date: string;
  vehicleId: string | null;
  registration: string | null;
  kind: string;
  direction: "in" | "out";
  amountMinor: bigint;
}

/** The `sumVehicleEarnedForDateRange`/`sumVehicleCostsForDateRange` obligation halves, row-level and business-wide rather than summed per vehicle — one bulk query per direction (api/CLAUDE.md's bounded-CPU rule), never one per row. */
async function listObligationTransactionsForDateRange(
  db: ReadDb,
  businessId: string,
  from: string,
  to: string,
  direction: "owed_to_us" | "owed_by_us",
  kinds: readonly string[],
): Promise<TransactionRow[]> {
  const rows = await db
    .select({
      date: obligation.dueOn,
      vehicleId: obligation.vehicleId,
      registration: vehicle.registration,
      kind: obligation.kind,
      amountMinor: obligation.amountMinor,
    })
    .from(obligation)
    .leftJoin(vehicle, eq(vehicle.id, obligation.vehicleId))
    .where(
      and(
        eq(obligation.businessId, businessId),
        gte(obligation.dueOn, from),
        lte(obligation.dueOn, to),
        eq(obligation.direction, direction),
        inArray(obligation.kind, kinds),
        isNull(obligation.voidedAt),
      ),
    );
  return rows.map((r) => ({
    date: r.date,
    vehicleId: r.vehicleId,
    registration: r.registration,
    kind: r.kind,
    direction: direction === "owed_to_us" ? ("in" as const) : ("out" as const),
    amountMinor: r.amountMinor,
  }));
}

/** UC-70's own trip-income basis (INV-30: recognised by `closing_date`), row-level and business-wide. */
async function listClosedTripTransactionsForDateRange(
  db: ReadDb,
  businessId: string,
  from: string,
  to: string,
): Promise<TransactionRow[]> {
  const rows = await db
    .select({
      date: trip.closingDate,
      vehicleId: trip.vehicleId,
      registration: vehicle.registration,
      amountMinor: trip.agreedAmountMinor,
    })
    .from(trip)
    .innerJoin(vehicle, eq(vehicle.id, trip.vehicleId))
    .where(
      and(
        eq(trip.businessId, businessId),
        eq(trip.status, "closed"),
        gte(trip.closingDate, from),
        lte(trip.closingDate, to),
      ),
    );
  return rows
    .filter((r): r is typeof r & { date: string } => r.date !== null)
    .map((r) => ({
      date: r.date,
      vehicleId: r.vehicleId,
      registration: r.registration,
      kind: "trip",
      direction: "in" as const,
      amountMinor: r.amountMinor,
    }));
}

/** `sumVehicleCostsForDateRange`'s own `expense` half (below-the-line `borne_by = 'us'` costs, UC-66's overheads included via a null `vehicleId`), row-level and business-wide. */
async function listCostExpenseTransactionsForDateRange(
  db: ReadDb,
  businessId: string,
  from: string,
  to: string,
): Promise<TransactionRow[]> {
  const rows = await db
    .select({
      date: expense.spentOn,
      vehicleId: expense.vehicleId,
      registration: vehicle.registration,
      category: expense.category,
      amountMinor: expense.amountMinor,
    })
    .from(expense)
    .leftJoin(vehicle, eq(vehicle.id, expense.vehicleId))
    .where(
      and(
        eq(expense.businessId, businessId),
        gte(expense.spentOn, from),
        lte(expense.spentOn, to),
        eq(expense.borneBy, "us"),
        isNull(expense.voidedAt),
      ),
    );
  return rows.map((r) => ({
    date: r.date,
    vehicleId: r.vehicleId,
    registration: r.registration,
    kind: r.category,
    direction: "out" as const,
    amountMinor: r.amountMinor,
  }));
}

/** GAP-18/UC-99: the whole year of transactions in one call — three bulk queries (never one per row), merged and left for the domain layer to sort and render. */
export async function listTransactionsForDateRange(
  db: ReadDb,
  businessId: string,
  from: string,
  to: string,
): Promise<TransactionRow[]> {
  const [earned, costs, trips] = await Promise.all([
    listObligationTransactionsForDateRange(db, businessId, from, to, "owed_to_us", [
      "rent",
      "daily_amount",
      "mileage_excess",
    ]),
    listObligationTransactionsForDateRange(db, businessId, from, to, "owed_by_us", [
      "driver_fee",
      "management_fee",
    ]),
    listClosedTripTransactionsForDateRange(db, businessId, from, to),
  ]);
  const expenses = await listCostExpenseTransactionsForDateRange(db, businessId, from, to);
  return [...earned, ...costs, ...trips, ...expenses];
}

export { desc };
