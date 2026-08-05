import { and, asc, eq, gte, lte } from "drizzle-orm";
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
  status: "booked";
  startDate: string;
  endDate: string;
  destination?: string;
  agreedAmountMinor: bigint;
  driverFeeMinor: bigint;
  openingOdometerId?: string;
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

/** F-5.5/UC-45: "the daily arrangement resumes for those dates" — freeing the vehicle's calendar. `vehicle_day_allocation` carries no `voided_at` (DM §4.1); a cancelled trip's occupancy rows are deleted rather than kept, unlike a money table. */
export async function deleteAllocationDaysForTrip(db: WriteDb, tripId: string): Promise<void> {
  // eslint-disable-next-line no-restricted-syntax -- allow: vehicle_day_allocation is occupancy, not money — no voided_at column exists to correct-in-place (DM §4.1)
  await db
    .delete(vehicleDayAllocation)
    .where(
      and(eq(vehicleDayAllocation.sourceType, "trip"), eq(vehicleDayAllocation.sourceId, tripId)),
    );
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
  postedPeriodId: trip.postedPeriodId,
  belongsToPeriodId: trip.belongsToPeriodId,
};

/** Scoped by `businessId` — the same shape every P2+ read gets (CLAUDE.md → Tenancy). */
export async function findTripForBusiness(
  db: ReadDb,
  businessId: string,
  tripId: string,
): Promise<TripRow | undefined> {
  const rows = await db
    .select(COLUMNS)
    .from(trip)
    .where(and(eq(trip.id, tripId), eq(trip.businessId, businessId)))
    .limit(1);
  return rows[0] as TripRow | undefined;
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

export interface CancelTripValues {
  cancelReason?: string;
  advanceDisposition?: "refunded" | "retained";
}

/** F-5.5/UC-45: "any advance refunded or retained as income — a choice, recorded" — the trip keeps which one was decided, not just that it was cancelled. */
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
