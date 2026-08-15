import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import { customer, driver, trip, vehicle, vehicleDayAllocation } from "../db/schema.js";

type WriteDb = Writer | Tx;
type ReadDb = Reader | Writer | Tx;

export interface NewTrip {
  id: string;
  businessId: string;
  vehicleId: string;
  customerId?: string;
  driverId?: string;
  status: "hold" | "booked";
  startDate: string;
  endDate: string;
  destination?: string;
  agreedAmountMinor: bigint;
  driverFeeMinor: bigint;
  openingOdometerId?: string;
  /** GAP-7/D-13: set only when `status` is `'hold'` — `trip_hold_expires_on_check` refuses the other combination. */
  holdExpiresOn?: string;
}

export async function insertTrip(db: WriteDb, values: NewTrip): Promise<void> {
  await db.insert(trip).values(values);
}

export interface NewAllocationDay {
  id: string;
  businessId: string;
  vehicleId: string;
  businessDate: string;
  arrangement: "A" | "B" | "C";
  sourceType: "lease" | "daily_lease" | "trip";
  sourceId: string;
  /** GAP-7: set only by a hold's own allocation rows — `false`/omitted for every other caller (booked trips, leases, daily leases), which is the column's own default. */
  isHold?: boolean;
}

/**
 * One multi-row INSERT (IG §3.1: bulk operations, never a loop issuing one
 * query per row) — `days` is bounded by the trip's own date range, which
 * F-5.1 requires to be materialised in full at booking (DM §4.1), so it is
 * never unbounded the way a lease's rolling horizon would be.
 */
export async function insertAllocationDays(db: WriteDb, days: NewAllocationDay[]): Promise<void> {
  if (days.length === 0) return;
  await db.insert(vehicleDayAllocation).values(days);
}

/** F-5.5/UC-45: "the daily arrangement resumes for those dates" — freeing the vehicle's calendar. D-11/W-58: voided, never deleted (DM §4.1). */
export async function deleteAllocationDaysForTrip(
  db: WriteDb,
  tripId: string,
  voidedBy: string,
): Promise<void> {
  await db
    .update(vehicleDayAllocation)
    .set({ voidedAt: sql`now()`, voidedReason: "Trip cancelled", voidedBy })
    .where(
      and(
        eq(vehicleDayAllocation.sourceType, "trip"),
        eq(vehicleDayAllocation.sourceId, tripId),
        isNull(vehicleDayAllocation.voidedAt),
      ),
    );
}

/**
 * GAP-119: a charter over a vehicle already on daily lease frees that
 * lease's own occupancy for the trip's range first, so `insertAllocationDays`
 * below doesn't collide with `one_arrangement_per_vehicle_day` (D-12,
 * data-model.md §4.1 — "the daily-lease allocation row is REPLACED by the
 * trip's"). Scoped by `vehicleId` + range, not a specific lease id —
 * `bookTrip` has no daily-lease context, only the vehicle and the dates, and
 * the live-row uniqueness the index itself enforces means at most one
 * `daily_lease` source can occupy a given vehicle-day anyway. `cancelTrip`
 * re-materialises whatever lease is current for the vehicle at that point,
 * never this function's own concern.
 */
export async function releaseDailyLeaseAllocationsForRange(
  db: WriteDb,
  vehicleId: string,
  startDate: string,
  endDate: string,
  voidedBy: string,
): Promise<void> {
  await db
    .update(vehicleDayAllocation)
    .set({
      voidedAt: sql`now()`,
      voidedReason: "Vehicle booked on a trip over its daily lease",
      voidedBy,
    })
    .where(
      and(
        eq(vehicleDayAllocation.vehicleId, vehicleId),
        eq(vehicleDayAllocation.sourceType, "daily_lease"),
        gte(vehicleDayAllocation.businessDate, startDate),
        lte(vehicleDayAllocation.businessDate, endDate),
        isNull(vehicleDayAllocation.voidedAt),
      ),
    );
}

export interface ReleasedExpiredHolds {
  released: number;
  /**
   * Distinct (businessId, vehicleId) pairs whose holds were released — the
   * caller re-materialises each one's *current* daily-lease horizon
   * afterward (GAP-7 calendar-hole fix), the same restore `cancelTrip`
   * already does for GAP-119. `businessId` travels with each pair rather
   * than being a single argument because the nightly cron calls this
   * unscoped, across every business at once.
   */
  affected: { businessId: string; vehicleId: string }[];
}

/**
 * GAP-7/ST-5: release is synchronous, never only by cron — `bookTrip`,
 * `startDailyLease` and `startLease` each call this for their own vehicle
 * before checking for a conflict, so a stale hold nobody confirmed cannot
 * block a real booking just because the nightly sweep has not run yet
 * (CLAUDE.md → Writes: no cron is a prerequisite for a user action). Two
 * bulk statements bounded by however many holds this vehicle actually has
 * outstanding — never a per-row loop. Omitting `vehicleId` is the nightly
 * cron's own shape (`generate-day-cards`'s siblings are deliberately
 * unscoped by business, TS §4); voiding twice is a no-op both times, since
 * the second pass's `WHERE status = 'hold'` matches nothing already
 * cancelled.
 */
export async function releaseExpiredHolds(
  db: WriteDb,
  today: string,
  vehicleId?: string,
  /** Who caused the release — the user whose booking/lease-start triggered it. `undefined` for the nightly sweep, which has no actor. */
  voidedBy?: string,
): Promise<ReleasedExpiredHolds> {
  const expired = await db
    .select({ id: trip.id, vehicleId: trip.vehicleId, businessId: trip.businessId })
    .from(trip)
    .where(
      and(
        eq(trip.status, "hold"),
        lt(trip.holdExpiresOn, today),
        ...(vehicleId !== undefined ? [eq(trip.vehicleId, vehicleId)] : []),
      ),
    );
  if (expired.length === 0) return { released: 0, affected: [] };
  const expiredIds = expired.map((r) => r.id);
  const affected = [...new Map(expired.map((r) => [r.vehicleId, r])).values()].map((r) => ({
    businessId: r.businessId,
    vehicleId: r.vehicleId,
  }));

  await db
    .update(vehicleDayAllocation)
    .set({ voidedAt: sql`now()`, voidedReason: "Hold expired", voidedBy })
    .where(
      and(
        eq(vehicleDayAllocation.sourceType, "trip"),
        inArray(vehicleDayAllocation.sourceId, expiredIds),
        isNull(vehicleDayAllocation.voidedAt),
      ),
    );

  await db
    .update(trip)
    .set({ status: "cancelled", cancelReason: "Hold expired", holdExpiresOn: null })
    .where(inArray(trip.id, expiredIds));

  return { released: expiredIds.length, affected };
}

export interface TripRow {
  id: string;
  businessId: string;
  vehicleId: string;
  customerId: string | null;
  driverId: string | null;
  status: "hold" | "booked" | "in_progress" | "closed" | "cancelled";
  startDate: string;
  endDate: string;
  destination: string | null;
  agreedAmountMinor: bigint;
  driverFeeMinor: bigint;
  openingOdometerId: string | null;
  closingOdometerId: string | null;
  closingDate: string | null;
  cancelReason: string | null;
  advanceDisposition: "refunded" | "retained" | null;
  /** GAP-7/D-13: the only source of truth for when a hold releases — `null` once confirmed or cancelled. */
  holdExpiresOn: string | null;
  postedPeriodId: string | null;
  belongsToPeriodId: string | null;
}

const COLUMNS = {
  id: trip.id,
  businessId: trip.businessId,
  vehicleId: trip.vehicleId,
  customerId: trip.customerId,
  driverId: trip.driverId,
  status: trip.status,
  startDate: trip.startDate,
  endDate: trip.endDate,
  destination: trip.destination,
  agreedAmountMinor: trip.agreedAmountMinor,
  driverFeeMinor: trip.driverFeeMinor,
  openingOdometerId: trip.openingOdometerId,
  closingOdometerId: trip.closingOdometerId,
  closingDate: trip.closingDate,
  cancelReason: trip.cancelReason,
  advanceDisposition: trip.advanceDisposition,
  holdExpiresOn: trip.holdExpiresOn,
  postedPeriodId: trip.postedPeriodId,
  belongsToPeriodId: trip.belongsToPeriodId,
};

/**
 * Scoped by `businessId` — the same shape every P2+ read gets (CLAUDE.md →
 * Tenancy).
 *
 * `forUpdate` locks the row for the caller's own transaction — the GAP-5a
 * discipline, here closing the race between two concurrent `confirm`
 * requests (or a confirm racing the synchronous/cron hold release) reading
 * the same stale `status` before either has written. Defaults `false`;
 * only `confirmTripHold`'s write path passes `true`.
 */
export async function findTripForBusiness(
  db: ReadDb,
  businessId: string,
  tripId: string,
  forUpdate = false,
): Promise<TripRow | undefined> {
  const query = db
    .select(COLUMNS)
    .from(trip)
    .where(and(eq(trip.id, tripId), eq(trip.businessId, businessId)))
    .limit(1);
  const rows = await (forUpdate ? query.for("update") : query);
  return rows[0] as TripRow | undefined;
}

/**
 * F-1.2/UC-94/GAP-54: the arrangement-change precondition — "no open
 * trip… conflicting with the effective date." A `hold`/`booked`/`in_progress`
 * trip whose own range still reaches or passes the effective date occupies
 * the vehicle regardless of the arrangement label being changed underneath
 * it (GAP-87 is the mirror gap — `bookTrip` not checking the label either).
 */
export async function findOpenTripForVehicle(
  db: ReadDb,
  vehicleId: string,
  effectiveFrom: string,
): Promise<{ id: string } | undefined> {
  const rows = await db
    .select({ id: trip.id })
    .from(trip)
    .where(
      and(
        eq(trip.vehicleId, vehicleId),
        inArray(trip.status, ["hold", "booked", "in_progress"]),
        gte(trip.endDate, effectiveFrom),
      ),
    )
    .limit(1);
  return rows[0];
}

export interface VehicleTripHistoryRow {
  id: string;
  status: "hold" | "booked" | "in_progress" | "closed" | "cancelled";
  startDate: string;
  endDate: string;
  destination: string | null;
  customerId: string | null;
  customerName: string | null;
  driverId: string | null;
  driverName: string | null;
  agreedAmountMinor: bigint;
}

/**
 * GAP-77/UC-71: an arrangement-C vehicle's own trip history — every status,
 * most recent first. Sibling of `listVehicleLeaseHistoryHandler`/
 * `listVehicleDailyLeaseHistoryHandler`, the arrangement-A/B history reads;
 * arrangement C had no equivalent. Left-joined the same way
 * `listInProgressTripsForBusiness` is — a driver-only or customer-only trip
 * is real (DM §8).
 */
export async function listTripsForVehicle(
  db: ReadDb,
  businessId: string,
  vehicleId: string,
): Promise<VehicleTripHistoryRow[]> {
  const rows = await db
    .select({
      id: trip.id,
      status: trip.status,
      startDate: trip.startDate,
      endDate: trip.endDate,
      destination: trip.destination,
      customerId: trip.customerId,
      customerName: customer.name,
      driverId: trip.driverId,
      driverName: driver.name,
      agreedAmountMinor: trip.agreedAmountMinor,
    })
    .from(trip)
    .leftJoin(customer, eq(customer.id, trip.customerId))
    .leftJoin(driver, eq(driver.id, trip.driverId))
    .where(and(eq(trip.businessId, businessId), eq(trip.vehicleId, vehicleId)))
    .orderBy(desc(trip.startDate));
  return rows.map((r) => ({
    ...r,
    status: r.status as VehicleTripHistoryRow["status"],
    customerId: r.customerId ?? null,
    customerName: r.customerName ?? null,
    driverId: r.driverId ?? null,
    driverName: r.driverName ?? null,
  }));
}

export interface DriverViewTripRow {
  id: string;
  vehicleId: string;
  closingDate: string | null;
  agreedAmountMinor: bigint;
  driverFeeMinor: bigint;
}

/** F-6.8/UC-59: the linked driver's own closed trips and fees, scoped to the window the caller asked for (never the server's own idea of "recent"). */
export async function listClosedTripsForDriver(
  db: ReadDb,
  businessId: string,
  driverId: string,
  from: string,
  to: string,
): Promise<DriverViewTripRow[]> {
  const rows = await db
    .select({
      id: trip.id,
      vehicleId: trip.vehicleId,
      closingDate: trip.closingDate,
      agreedAmountMinor: trip.agreedAmountMinor,
      driverFeeMinor: trip.driverFeeMinor,
    })
    .from(trip)
    .where(
      and(
        eq(trip.businessId, businessId),
        eq(trip.driverId, driverId),
        eq(trip.status, "closed"),
        gte(trip.closingDate, from),
        lte(trip.closingDate, to),
      ),
    );
  return rows;
}

export interface CloseTripValues {
  closingDate: string;
  closingOdometerId?: string;
  postedPeriodId: string;
  belongsToPeriodId?: string;
}

/** F-5.4/UC-44/W-41: `posted_period_id` is set only here, on the closing date — trip income and cost recognise on close, never on booking. */
export async function closeTripRow(
  db: WriteDb,
  tripId: string,
  values: CloseTripValues,
): Promise<void> {
  await db
    .update(trip)
    .set({
      status: "closed",
      closingDate: values.closingDate,
      closingOdometerId: values.closingOdometerId,
      postedPeriodId: values.postedPeriodId,
      belongsToPeriodId: values.belongsToPeriodId,
    })
    .where(eq(trip.id, tripId));
}

/** GAP-7: confirming a hold turns its own reserved days into an ordinary booked allocation — the calendar's "T?" glyph stops applying without re-touching which days are reserved. */
export async function clearHoldOnAllocationDaysForTrip(db: WriteDb, tripId: string): Promise<void> {
  await db
    .update(vehicleDayAllocation)
    .set({ isHold: false })
    .where(
      and(
        eq(vehicleDayAllocation.sourceType, "trip"),
        eq(vehicleDayAllocation.sourceId, tripId),
        isNull(vehicleDayAllocation.voidedAt),
      ),
    );
}

/**
 * GAP-7: `hold` → `booked` (ST-5) — `hold_expires_on` clears, since
 * `trip_hold_expires_on_check` refuses a non-null value once the row leaves
 * `hold`. `status = 'hold'` in the WHERE clause is a second guard alongside
 * `confirmTripHold`'s own `forUpdate` read lock: a blind update here would
 * silently resurrect a hold a concurrent release had already cancelled
 * between the lock being taken and this write. Returns whether a row
 * actually changed, so the caller can refuse rather than proceed as if it
 * had.
 */
export async function confirmTripHoldRow(db: WriteDb, tripId: string): Promise<boolean> {
  const updated = await db
    .update(trip)
    .set({ status: "booked", holdExpiresOn: null })
    .where(and(eq(trip.id, tripId), eq(trip.status, "hold")))
    .returning({ id: trip.id });
  return updated.length > 0;
}

export interface CancelTripValues {
  cancelReason?: string;
  advanceDisposition?: "refunded" | "retained";
}

/** F-5.5/UC-45: "any advance refunded or retained as income — a choice, recorded" — the trip keeps which one was decided, not just that it was cancelled. */
/**
 * GAP-7/D-13: `holdExpiresOn` clears here too, the same way
 * `confirmTripHoldRow` clears it on the other exit from `hold` —
 * `trip_hold_expires_on_check` (migration `0020`) refuses any non-`hold`
 * status with a non-null `hold_expires_on`, and cancelling a still-`hold`
 * trip (F-5.5's "cancels a hold directly" path) would otherwise try to
 * leave exactly that combination.
 */
export async function cancelTripRow(
  db: WriteDb,
  tripId: string,
  values: CancelTripValues,
): Promise<void> {
  await db
    .update(trip)
    .set({
      status: "cancelled",
      cancelReason: values.cancelReason,
      advanceDisposition: values.advanceDisposition,
      holdExpiresOn: null,
    })
    .where(eq(trip.id, tripId));
}

export interface InProgressTripRow {
  id: string;
  vehicleId: string;
  vehicleRegistration: string;
  customerId: string | null;
  customerName: string | null;
  driverId: string | null;
  driverName: string | null;
  startDate: string;
  endDate: string;
  destination: string | null;
}

/**
 * Home item 7 (UI §3.2): every trip still open. `status = 'booked'` is the
 * whole population right now — `arrangement.ts`'s own comment on
 * `tripResponseSchema` records that booking (F-5.1) writes `booked`
 * outright, and no path has ever produced `hold` or `in_progress` even
 * though the schema allows them, so filtering on the literal `'in_progress'`
 * would silently return nothing forever rather than the trips actually
 * still running. `customer`/`driver` are left-joined (a trip's own columns
 * are nullable per DM §8 — a driver-only or customer-only trip is real).
 */
export async function listInProgressTripsForBusiness(
  db: ReadDb,
  businessId: string,
): Promise<InProgressTripRow[]> {
  const rows = await db
    .select({
      id: trip.id,
      vehicleId: trip.vehicleId,
      vehicleRegistration: vehicle.registration,
      customerId: trip.customerId,
      customerName: customer.name,
      driverId: trip.driverId,
      driverName: driver.name,
      startDate: trip.startDate,
      endDate: trip.endDate,
      destination: trip.destination,
    })
    .from(trip)
    .innerJoin(vehicle, eq(vehicle.id, trip.vehicleId))
    .leftJoin(customer, eq(customer.id, trip.customerId))
    .leftJoin(driver, eq(driver.id, trip.driverId))
    .where(and(eq(trip.businessId, businessId), eq(trip.status, "booked")))
    .orderBy(asc(trip.startDate));
  return rows.map((r) => ({
    ...r,
    customerId: r.customerId ?? null,
    customerName: r.customerName ?? null,
    driverId: r.driverId ?? null,
    driverName: r.driverName ?? null,
  }));
}
