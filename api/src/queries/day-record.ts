import { and, eq, gte, lte } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import { dayRecord } from "../db/schema.js";

type WriteDb = Writer | Tx;
type ReadDb = Reader | Writer | Tx;

export interface DayRecordRow {
  id: string;
  dailyLeaseId: string;
  vehicleId: string;
  driverId: string;
  businessDate: string;
  state:
    "open" | "ran_paid_full" | "ran_paid_short" | "ran_unpaid" | "did_not_run" | "paused_for_trip";
  earnedMinor: bigint;
  expectedMinor: bigint;
  lostReason: string | null;
  note: string | null;
}

const COLUMNS = {
  id: dayRecord.id,
  dailyLeaseId: dayRecord.dailyLeaseId,
  vehicleId: dayRecord.vehicleId,
  driverId: dayRecord.driverId,
  businessDate: dayRecord.businessDate,
  state: dayRecord.state,
  earnedMinor: dayRecord.earnedMinor,
  expectedMinor: dayRecord.expectedMinor,
  lostReason: dayRecord.lostReason,
  note: dayRecord.note,
};

/** DM §7's `UNIQUE (daily_lease_id, business_date)` — the natural key a confirm is idempotent on. */
export async function findDayRecordByLeaseAndDate(
  db: ReadDb,
  dailyLeaseId: string,
  businessDate: string,
): Promise<DayRecordRow | undefined> {
  const rows = await db
    .select(COLUMNS)
    .from(dayRecord)
    .where(and(eq(dayRecord.dailyLeaseId, dailyLeaseId), eq(dayRecord.businessDate, businessDate)))
    .limit(1);
  return rows[0] as DayRecordRow | undefined;
}

export interface NewDayRecord {
  id: string;
  businessId: string;
  dailyLeaseId: string;
  vehicleId: string;
  driverId: string;
  businessDate: string;
  state: DayRecordRow["state"];
  earnedMinor: bigint;
  expectedMinor: bigint;
  lostReason?: string;
  note?: string;
  postedPeriodId: string;
  belongsToPeriodId?: string;
}

/** F-4.2/F-4.4: the on-demand card — confirming a day with no row generates it, already in its confirmed state (never an intermediate `open` insert). */
export async function insertDayRecord(db: WriteDb, values: NewDayRecord): Promise<void> {
  await db.insert(dayRecord).values(values);
}

/**
 * F-5.1's flagged gap: "a future trip has no day records to pause" — this is
 * the half of that sentence that DOES have something to pause. Only rows
 * still `open` move; a day already confirmed one way or another keeps its
 * own fact rather than being silently overwritten by the booking. One
 * bulk `UPDATE`, never a loop per day (IG §2: bounded Worker CPU).
 */
export async function pauseDayRecordsForTrip(
  db: WriteDb,
  vehicleId: string,
  startDate: string,
  endDate: string,
  tripId: string,
): Promise<void> {
  await db
    .update(dayRecord)
    .set({ state: "paused_for_trip", tripId })
    .where(
      and(
        eq(dayRecord.vehicleId, vehicleId),
        gte(dayRecord.businessDate, startDate),
        lte(dayRecord.businessDate, endDate),
        eq(dayRecord.state, "open"),
      ),
    );
}

/** F-5.5/UC-45: "the daily arrangement resumes" — only the rows this trip itself paused come back, never a day some other cause already touched. */
export async function resumeDayRecordsForTrip(db: WriteDb, tripId: string): Promise<void> {
  await db
    .update(dayRecord)
    .set({ state: "open", tripId: null })
    .where(and(eq(dayRecord.tripId, tripId), eq(dayRecord.state, "paused_for_trip")));
}
