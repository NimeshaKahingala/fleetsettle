import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import { driver } from "../db/schema.js";

type WriteDb = Writer | Tx;
type ReadDb = Reader | Writer | Tx;

export interface NewDriver {
  id: string;
  businessId: string;
  name: string;
  mobile?: string;
  driverDayFeeMinor?: bigint;
  driverTripFeeMinor?: bigint;
  licenceExpiry?: string;
  // GAP-135: both omitted defaults to 'daily'/NULL, the column's own
  // DEFAULT — createDriverRequestSchema's paired refine is what makes
  // 'weekly' + undefined unreachable by the time this runs.
  settlementRhythm?: string;
  settlementWeekday?: number;
}

export async function insertDriver(db: WriteDb, values: NewDriver): Promise<void> {
  await db.insert(driver).values(values);
}

export interface DriverRow {
  id: string;
  name: string;
  mobile: string | null;
  driverDayFeeMinor: bigint | null;
  driverTripFeeMinor: bigint | null;
  licenceExpiry: string | null;
  settlementRhythm: string;
  settlementWeekday: number | null;
  voidedAt: string | null;
}

const COLUMNS = {
  id: driver.id,
  name: driver.name,
  mobile: driver.mobile,
  driverDayFeeMinor: driver.driverDayFeeMinor,
  driverTripFeeMinor: driver.driverTripFeeMinor,
  licenceExpiry: driver.licenceExpiry,
  settlementRhythm: driver.settlementRhythm,
  settlementWeekday: driver.settlementWeekday,
  voidedAt: driver.voidedAt,
};

/**
 * Scoped by `businessId` — the same shape every P2+ read gets (CLAUDE.md → Tenancy).
 *
 * GAP-190/B13 (Gitar review): `forUpdate` locks this row for the caller's
 * own transaction — `archiveDriver` takes it before checking open money, so
 * it conflicts with migration 0034's `assert_party_not_archived()`, which
 * now takes `FOR SHARE` on the same row before checking `voided_at`. Without
 * both sides locking, a concurrent archive and a concurrent money insert can
 * each read the other's pre-commit state and both succeed, leaving an
 * archived driver with open money (INV-35) — the same reasoning
 * `deposit.ts`'s own `FOR UPDATE` comment gives for a deposit's parent row.
 */
export async function findDriverForBusiness(
  db: ReadDb,
  businessId: string,
  driverId: string,
  forUpdate = false,
): Promise<DriverRow | undefined> {
  const query = db
    .select(COLUMNS)
    .from(driver)
    .where(and(eq(driver.id, driverId), eq(driver.businessId, businessId)))
    .limit(1);
  const rows = await (forUpdate ? query.for("update") : query);
  return rows[0];
}

export async function listDriversForBusiness(db: ReadDb, businessId: string): Promise<DriverRow[]> {
  return db
    .select(COLUMNS)
    .from(driver)
    .where(eq(driver.businessId, businessId))
    .orderBy(driver.createdAt);
}

/**
 * GAP-187/PR#186 review. `FOR SHARE`, not `FOR UPDATE` — mirrors migration
 * 0034/0037's own DB-side triggers (`assert_party_not_archived`/
 * `assert_adjustment_party_not_archived`), which already take `FOR SHARE` on
 * this row before reading `voided_at`. Matching that lock strength here is
 * what makes two ordinary `saveOpeningBalance` calls against different
 * drivers never block each other, while either one still conflicts with
 * `archiveDriver`'s own `FOR UPDATE` — the same race `assertArchivable`
 * closes for every other money write in this schema, applied to a table
 * (`opening_balance_entry`) migration 0031's own view structurally cannot
 * see (no `posted_period_id` of its own; the money it eventually produces
 * lives in tables that already carry the trigger).
 *
 * Set-based rather than one `SELECT … FOR SHARE` per driver — a bulk
 * opening-balance save may name several — per api/CLAUDE.md's "never a loop
 * issuing one query per row"; a missing ID's absence from the returned Map
 * is the caller's business-scoped existence check to have already ruled out.
 */
export async function lockDriversForShare(
  db: Tx,
  driverIds: string[],
): Promise<Map<string, string | null>> {
  if (driverIds.length === 0) return new Map();
  const rows = await db
    .select({ id: driver.id, voidedAt: driver.voidedAt })
    .from(driver)
    .where(inArray(driver.id, driverIds))
    .for("share");
  return new Map(rows.map((r) => [r.id, r.voidedAt]));
}

export interface DriverSettlementConfig {
  rhythm: string;
  weekday: number | null;
}

/**
 * GAP-135/DM D-5. Read on its own rather than through `COLUMNS` — this is
 * `confirmDay`'s own derivation input, called with only a `driverId` that a
 * day-record/daily-lease chain has already proven belongs to this business,
 * not a business-scoped read. Returns `undefined` for a driver that does
 * not exist — the caller treats that as nothing to derive against rather
 * than as a not-found of its own.
 */
export async function findDriverSettlementConfig(
  db: ReadDb,
  driverId: string,
): Promise<DriverSettlementConfig | undefined> {
  const rows = await db
    .select({ rhythm: driver.settlementRhythm, weekday: driver.settlementWeekday })
    .from(driver)
    .where(eq(driver.id, driverId))
    .limit(1);
  return rows[0];
}

/**
 * F-1.8/A11: guarded on `linked_user_id IS NULL` — this only ever runs from
 * inside `redeemInvite`'s transaction, after the invite row itself has
 * already been consumed under its own guard, so reaching 0 rows here means
 * the driver was linked to someone else in between (stale but still-active
 * invite, a rare race) rather than the ordinary case.
 */
export async function linkDriverToUser(
  db: WriteDb,
  driverId: string,
  userId: string,
): Promise<boolean> {
  const rows = await db
    .update(driver)
    .set({ linkedUserId: userId })
    .where(and(eq(driver.id, driverId), isNull(driver.linkedUserId)))
    .returning({ id: driver.id });
  return rows.length > 0;
}

/** F-1.8's "Unlink" alternate: "his access ends, his record and history are untouched" — clears the one column, touches nothing else. */
export async function unlinkDriver(db: WriteDb, driverId: string): Promise<void> {
  await db.update(driver).set({ linkedUserId: null }).where(eq(driver.id, driverId));
}

/**
 * F-1.11/GAP-36: archive, never delete (W-58) — the same `voided_*` trio
 * migration 0023 gave this table, so a closed month that names this driver
 * keeps rendering exactly as before. INV-35's open-money check runs before
 * this is ever called. `WHERE … voided_at IS NULL` (found by review, same
 * shape `voidAdvanceById` already uses): the already-archived check upstream
 * is a separate read, not atomic with this write, so two concurrent archives
 * could otherwise both pass the check and the second silently overwrite the
 * first's own reason and actor — this guard makes a losing race 0 rows
 * (mapped to `PartyAlreadyArchivedError` by the caller) rather than a
 * clobber.
 */
/**
 * NL-2, 31 Aug 2026: `businessId` in the `WHERE` — `setVehicleLifecycle`'s
 * own PR #144 fix (Copilot review), applied to this table's sibling.
 * `archiveDriver`'s own `FOR UPDATE` lock and `assertArchivable` check
 * already run first, so this closes no live route — it makes the write
 * itself assert tenancy too, not trust the caller's earlier check alone.
 */
export async function archiveDriverRow(
  db: WriteDb,
  businessId: string,
  driverId: string,
  values: { voidedReason: string; voidedBy: string },
): Promise<{ voidedAt: string } | undefined> {
  const rows = await db
    .update(driver)
    .set({ voidedAt: sql`now()`, voidedReason: values.voidedReason, voidedBy: values.voidedBy })
    .where(and(eq(driver.id, driverId), eq(driver.businessId, businessId), isNull(driver.voidedAt)))
    .returning({ voidedAt: driver.voidedAt });
  return rows[0] as { voidedAt: string } | undefined;
}

/**
 * F-1.11's "Unarchive" alternate: nothing about his history changed while
 * he was gone, so there is nothing else to touch.
 *
 * NL-2, 31 Aug 2026: same `businessId` fix as `archiveDriverRow` above.
 */
export async function unarchiveDriverRow(
  db: WriteDb,
  businessId: string,
  driverId: string,
): Promise<void> {
  await db
    .update(driver)
    .set({ voidedAt: null, voidedReason: null, voidedBy: null })
    .where(and(eq(driver.id, driverId), eq(driver.businessId, businessId)));
}
