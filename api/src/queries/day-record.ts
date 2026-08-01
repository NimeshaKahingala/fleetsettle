import { and, eq } from "drizzle-orm";
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
