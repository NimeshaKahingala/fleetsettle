import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
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
} from "../db/schema.js";
import { sumDepositMovements } from "./driver-money.js";

type ReadDb = Reader | Writer | Tx;

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

export interface OwnershipShareRow {
  userId: string;
  shareBp: number;
}

/** The shares in force as of `asOfDate` — effective-dated (INV-16), so recomputing an old month never yields a different split. */
export async function findOwnershipSharesAsOf(
  db: ReadDb,
  vehicleId: string,
  asOfDate: string,
): Promise<OwnershipShareRow[]> {
  const rows = await db
    .select({ userId: ownershipShare.userId, shareBp: ownershipShare.shareBp })
    .from(ownershipShare)
    .where(
      and(
        eq(ownershipShare.vehicleId, vehicleId),
        lte(ownershipShare.effectiveFrom, asOfDate),
        sql`(${ownershipShare.effectiveTo} IS NULL OR ${ownershipShare.effectiveTo} >= ${asOfDate})`,
      ),
    );
  return rows;
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
      ),
    )
    .groupBy(dayRecord.driverId, sql`EXTRACT(dow FROM ${dayRecord.businessDate})`);
  return rows.map((r) => ({ ...r, lostValueMinor: BigInt(r.lostValueMinor) }));
}

/** UC-77: every waiver you chose to give (`waiver`/`auto_waiver`/`goodwill`), never pooled with a write-off (W-28) — a write-off is reported entirely separately, from `write_off`, not this table. */
export async function sumGoodwillGiven(
  db: ReadDb,
  businessId: string,
  from: string,
  to: string,
): Promise<bigint> {
  const rows = await db
    .select({ amountMinor: adjustment.amountMinor })
    .from(adjustment)
    .where(
      and(
        eq(adjustment.businessId, businessId),
        sql`${adjustment.adjustmentType} IN ('waiver', 'auto_waiver', 'goodwill')`,
        isNull(adjustment.voidedAt),
        gte(adjustment.createdAt, from),
        lte(adjustment.createdAt, to),
      ),
    );
  return rows.reduce((sum, r) => sum + r.amountMinor, 0n);
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

export { desc };
