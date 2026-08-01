import { and, eq } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import { trip, vehicleDayAllocation } from "../db/schema.js";

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

export interface TripRow {
  id: string;
  vehicleId: string;
  customerId: string | null;
  driverId: string | null;
  status: "hold" | "booked" | "in_progress" | "closed" | "cancelled";
  startDate: string;
  endDate: string;
  destination: string | null;
  agreedAmountMinor: bigint;
  driverFeeMinor: bigint;
}

const COLUMNS = {
  id: trip.id,
  vehicleId: trip.vehicleId,
  customerId: trip.customerId,
  driverId: trip.driverId,
  status: trip.status,
  startDate: trip.startDate,
  endDate: trip.endDate,
  destination: trip.destination,
  agreedAmountMinor: trip.agreedAmountMinor,
  driverFeeMinor: trip.driverFeeMinor,
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
