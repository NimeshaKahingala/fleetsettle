import { and, eq, isNull, sql } from "drizzle-orm";
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
  voidedAt: string | null;
}

const COLUMNS = {
  id: driver.id,
  name: driver.name,
  mobile: driver.mobile,
  driverDayFeeMinor: driver.driverDayFeeMinor,
  driverTripFeeMinor: driver.driverTripFeeMinor,
  licenceExpiry: driver.licenceExpiry,
  voidedAt: driver.voidedAt,
};

/** Scoped by `businessId` — the same shape every P2+ read gets (CLAUDE.md → Tenancy). */
export async function findDriverForBusiness(
  db: ReadDb,
  businessId: string,
  driverId: string,
): Promise<DriverRow | undefined> {
  const rows = await db
    .select(COLUMNS)
    .from(driver)
    .where(and(eq(driver.id, driverId), eq(driver.businessId, businessId)))
    .limit(1);
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
 * GAP-135/DM D-5. Read on its own rather than added to `COLUMNS`: that set
 * feeds `DriverRow` into every driver response, and this column is an
 * internal guard input, not something the client has any use for. Returns
 * `undefined` for a driver that does not exist — the caller is always inside
 * a flow that has already proven the id, so it treats that as nothing to
 * check rather than as a not-found of its own.
 */
export async function findDriverSettlementRhythm(
  db: ReadDb,
  driverId: string,
): Promise<string | undefined> {
  const rows = await db
    .select({ settlementRhythm: driver.settlementRhythm })
    .from(driver)
    .where(eq(driver.id, driverId))
    .limit(1);
  return rows[0]?.settlementRhythm;
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
export async function archiveDriverRow(
  db: WriteDb,
  driverId: string,
  values: { voidedReason: string; voidedBy: string },
): Promise<{ voidedAt: string } | undefined> {
  const rows = await db
    .update(driver)
    .set({ voidedAt: sql`now()`, voidedReason: values.voidedReason, voidedBy: values.voidedBy })
    .where(and(eq(driver.id, driverId), isNull(driver.voidedAt)))
    .returning({ voidedAt: driver.voidedAt });
  return rows[0] as { voidedAt: string } | undefined;
}

/** F-1.11's "Unarchive" alternate: nothing about his history changed while he was gone, so there is nothing else to touch. */
export async function unarchiveDriverRow(db: WriteDb, driverId: string): Promise<void> {
  await db
    .update(driver)
    .set({ voidedAt: null, voidedReason: null, voidedBy: null })
    .where(eq(driver.id, driverId));
}
