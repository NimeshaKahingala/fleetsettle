import { and, asc, eq, gt, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
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
  /** GAP-118: read by confirmDay.ts alone, to refuse confirming a stale card a driver/arrangement change already voided. Never included in `toResponse` (handlers/day-record.ts) — not part of the wire contract. */
  voidedAt: string | null;
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
  voidedAt: dayRecord.voidedAt,
};

/**
 * DM §7's `UNIQUE (daily_lease_id, business_date)` — the natural key a confirm
 * is idempotent on.
 *
 * Deliberately NOT filtered on `voided_at` — this table's own unique index
 * (migration 0022's header) stayed table-wide, not partial, unlike
 * `vehicle_day_allocation`'s: GAP-118's voiding only ever touches a
 * *superseded* lease's own future rows, never the id a live confirm is
 * addressed to, so this lookup can never legitimately return a voided row for
 * the key it's given. Filtering it anyway would silently turn a genuine
 * conflict (an INSERT racing this exact unique index, `confirmDay.ts:277`'s
 * own `isUniqueViolation` recovery path) into a row this function claims does
 * not exist — the recovery would then find nothing and fall through to a
 * confusing 500 instead of the clean idempotent read it exists to provide.
 */
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

export interface ConfirmOpenDayRecordValues {
  state: DayRecordRow["state"];
  earnedMinor: bigint;
  expectedMinor: bigint;
  lostReason?: string;
  note?: string;
  postedPeriodId: string;
  belongsToPeriodId: string | null;
}

/**
 * GAP-3: P13's `generate-day-cards` cron pre-inserts a `day_record` in
 * `open` state for every scheduled day up to 90 days out — a placeholder,
 * not a confirmed fact. Confirming that day is an UPDATE of the existing
 * row, never a second INSERT (the `(daily_lease_id, business_date)` unique
 * index would reject that anyway). `state = 'open'` in the WHERE clause is
 * the idempotency guard itself: two concurrent confirms racing this exact
 * row have the second one's UPDATE re-evaluate the predicate against the
 * first's already-committed write and affect 0 rows — read by the caller as
 * "lost the race", the same "unique violation on an idempotent path is
 * success" rule the fresh-INSERT path already used, expressed here as an
 * empty result instead of a thrown constraint violation. Neither
 * `posted_period_id` nor `belongs_to_period_id` is guaranteed unchanged: the
 * placeholder captured whatever period was open at generation time, but a
 * day can sit unconfirmed long enough for that period to have since closed,
 * so both are re-set here to whatever `resolvePeriodLinkage` resolves *now*
 * — the same value a brand-new row would get, and exactly why this UPDATE
 * never conflicts with `assert_period_open()`: `day_record` carries no
 * `voided_at`, so 0006/0008's exception clears any UPDATE that leaves
 * `posted_period_id` where the trigger will find it (open, always, since
 * `resolvePeriodLinkage` never returns a closed one).
 */
export async function confirmOpenDayRecord(
  db: WriteDb,
  id: string,
  values: ConfirmOpenDayRecordValues,
): Promise<DayRecordRow | undefined> {
  const rows = await db
    .update(dayRecord)
    .set({
      state: values.state,
      earnedMinor: values.earnedMinor,
      expectedMinor: values.expectedMinor,
      lostReason: values.lostReason ?? null,
      note: values.note ?? null,
      postedPeriodId: values.postedPeriodId,
      belongsToPeriodId: values.belongsToPeriodId,
    })
    .where(and(eq(dayRecord.id, id), eq(dayRecord.state, "open")))
    .returning(COLUMNS);
  return rows[0] as DayRecordRow | undefined;
}

/**
 * F-5.1's flagged gap: "a future trip has no day records to pause" — this is
 * the half of that sentence that DOES have something to pause. Only rows
 * still `open` move; a day already confirmed one way or another keeps its
 * own fact rather than being silently overwritten by the booking. One
 * bulk `UPDATE`, never a loop per day (IG §2: bounded Worker CPU).
 *
 * Scoped by `vehicleId` + date range, not a specific lease — unlike
 * `confirmOpenDayRecord`, this can reach a stale row a driver/arrangement
 * change (GAP-118) already voided for a now-superseded lease covering the
 * same vehicle and date. `voided_at IS NULL` keeps a freed day free.
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
        isNull(dayRecord.voidedAt),
      ),
    );
}

/** F-5.5/UC-45: "the daily arrangement resumes" — only the rows this trip itself paused come back, never a day some other cause already touched. `voided_at IS NULL` for the same reason as `pauseDayRecordsForTrip` above, though a row this function paused can only have been voided afterward by a driver/arrangement change nothing in this codebase performs on a vehicle mid-trip. */
export async function resumeDayRecordsForTrip(db: WriteDb, tripId: string): Promise<void> {
  await db
    .update(dayRecord)
    .set({ state: "open", tripId: null })
    .where(
      and(
        eq(dayRecord.tripId, tripId),
        eq(dayRecord.state, "paused_for_trip"),
        isNull(dayRecord.voidedAt),
      ),
    );
}

/**
 * GAP-118: the day_record half of freeing a closed lease's future
 * occupancy — `releaseDailyLeaseAllocationsAfter` (queries/dailyLease.ts)
 * frees the calendar; this frees the "needs confirming" cards a driver or
 * arrangement change leaves stale. `state = 'open'` only, deliberately
 * narrower than "every future row": a card `paused_for_trip` sits under an
 * open trip that already blocked an arrangement change from reaching this
 * point (`findOpenTripForVehicle`) and `changeDailyLeaseDriver` names no
 * such guard of its own — voiding a day genuinely still in a trip's hands
 * is a different, unaddressed question this fix does not answer, so it is
 * left untouched rather than guessed at. A terminal state (already ran, or
 * confirmed as lost) is a fact that already happened and stays exactly as
 * confirmed, the same "history renders as it did" rule W-58 gives a
 * soft-deleted parent.
 */
export async function voidFutureOpenDayRecordsForLease(
  db: WriteDb,
  dailyLeaseId: string,
  afterDate: string,
  voidedReason: string,
  voidedBy: string,
): Promise<void> {
  await db
    .update(dayRecord)
    .set({ voidedAt: sql`now()`, voidedReason, voidedBy })
    .where(
      and(
        eq(dayRecord.dailyLeaseId, dailyLeaseId),
        gt(dayRecord.businessDate, afterDate),
        eq(dayRecord.state, "open"),
        isNull(dayRecord.voidedAt),
      ),
    );
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
 *
 * `voided_at IS NULL`: a day GAP-118 voided off this driver, because a
 * change moved it to someone else before it ran, is not this driver's day
 * any more — showing it here would tell a driver he earned a day he never
 * actually covered.
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
        isNull(dayRecord.voidedAt),
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
 * most of the filter, but not all of it since GAP-118: a driver/arrangement
 * change voids a stale future card without touching its `state`, so
 * `voided_at IS NULL` is what actually keeps a freed day off this list —
 * without it, a card belonging to a lease nobody can act on any more reads
 * to the manager as something still needing a tap.
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
        isNull(dayRecord.voidedAt),
      ),
    )
    .orderBy(asc(dayRecord.businessDate));
  return rows;
}
