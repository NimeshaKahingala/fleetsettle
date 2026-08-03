import { and, asc, eq, gte, inArray, lt, lte } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import { dayRecord, driver, obligation, vehicle } from "../db/schema.js";

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

export interface DriverViewDayRow {
  businessDate: string;
  state: DayRecordRow["state"];
  earnedMinor: bigint;
  receivedMinor: bigint;
  lostReason: string | null;
}

/**
 * F-6.8/UC-59: the linked driver's own days, including excused ones (§7.9).
 * `earned_minor` lives on `day_record` itself; `received` is assembled from
 * each day's own `obligation` (source `day_record`/its id, P3's own join),
 * bulk-fetched in one query rather than one round trip per day (IG §2). A
 * `did_not_run` day has no obligation at all (INV-6) — a real zero, not a
 * missing figure (W-56).
 */
export async function listDayRecordsForDriver(
  db: ReadDb,
  businessId: string,
  driverId: string,
  from: string,
  to: string,
): Promise<DriverViewDayRow[]> {
  const rows = await db
    .select({
      id: dayRecord.id,
      businessDate: dayRecord.businessDate,
      state: dayRecord.state,
      earnedMinor: dayRecord.earnedMinor,
      lostReason: dayRecord.lostReason,
    })
    .from(dayRecord)
    .where(
      and(
        eq(dayRecord.businessId, businessId),
        eq(dayRecord.driverId, driverId),
        gte(dayRecord.businessDate, from),
        lte(dayRecord.businessDate, to),
      ),
    );
  if (rows.length === 0) return [];

  const dayRecordIds = rows.map((r) => r.id);
  const obligationRows = await db
    .select({ sourceId: obligation.sourceId, settledMinor: obligation.settledMinor })
    .from(obligation)
    .where(
      and(eq(obligation.sourceType, "day_record"), inArray(obligation.sourceId, dayRecordIds)),
    );
  const settledByDayRecord = new Map(obligationRows.map((r) => [r.sourceId, r.settledMinor]));

  return rows.map((r) => ({
    businessDate: r.businessDate,
    state: r.state as DayRecordRow["state"],
    earnedMinor: r.earnedMinor,
    // eslint-disable-next-line no-restricted-syntax -- a did_not_run day (INV-6) has no obligation at all; 0 is the fact for that day, not a stand-in for data we don't have (W-56)
    receivedMinor: settledByDayRecord.get(r.id) ?? 0n,
    lostReason: r.lostReason,
  }));
}

export interface UnconfirmedDayRecordRow {
  id: string;
  dailyLeaseId: string;
  vehicleId: string;
  vehicleRegistration: string;
  driverId: string;
  driverName: string;
  businessDate: string;
  expectedMinor: bigint;
}

/**
 * Home item 4 (UI §3.2): days scheduled but never confirmed, strictly
 * before `today` — a parameter the caller derives via `businessToday()`,
 * never a server-evaluated date literal (CLAUDE.md → Time). Today's own
 * card is item 3 and the two never interleave (§3.2). `state = 'open'` is
 * the whole filter: it already excludes `paused_for_trip` (FL §4.1's own
 * accept clause) and every terminal state, so there's no second condition
 * to get wrong.
 */
export async function listUnconfirmedDayRecordsForBusiness(
  db: ReadDb,
  businessId: string,
  today: string,
): Promise<UnconfirmedDayRecordRow[]> {
  const rows = await db
    .select({
      id: dayRecord.id,
      dailyLeaseId: dayRecord.dailyLeaseId,
      vehicleId: dayRecord.vehicleId,
      vehicleRegistration: vehicle.registration,
      driverId: dayRecord.driverId,
      driverName: driver.name,
      businessDate: dayRecord.businessDate,
      expectedMinor: dayRecord.expectedMinor,
    })
    .from(dayRecord)
    .innerJoin(vehicle, eq(vehicle.id, dayRecord.vehicleId))
    .innerJoin(driver, eq(driver.id, dayRecord.driverId))
    .where(
      and(
        eq(dayRecord.businessId, businessId),
        eq(dayRecord.state, "open"),
        lt(dayRecord.businessDate, today),
      ),
    )
    .orderBy(asc(dayRecord.businessDate));
  return rows;
}
