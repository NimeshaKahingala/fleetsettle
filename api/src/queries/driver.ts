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

/** F-1.11/GAP-36: archive, never delete (W-58) — the same `voided_*` trio migration 0023 gave this table, so a closed month that names this driver keeps rendering exactly as before. INV-35's open-money check runs before this is ever called. */
export async function archiveDriverRow(
  db: WriteDb,
  driverId: string,
  values: { voidedReason: string; voidedBy: string },
): Promise<{ voidedAt: string }> {
  const rows = await db
    .update(driver)
    .set({ voidedAt: sql`now()`, voidedReason: values.voidedReason, voidedBy: values.voidedBy })
    .where(eq(driver.id, driverId))
    .returning({ voidedAt: driver.voidedAt });
  // Written by the SET above, in the same statement — never null on the row this WHERE just matched.
  return rows[0] as { voidedAt: string };
}

/** F-1.11's "Unarchive" alternate: nothing about his history changed while he was gone, so there is nothing else to touch. */
export async function unarchiveDriverRow(db: WriteDb, driverId: string): Promise<void> {
  await db
    .update(driver)
    .set({ voidedAt: null, voidedReason: null, voidedBy: null })
    .where(eq(driver.id, driverId));
}
