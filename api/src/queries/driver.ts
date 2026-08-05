import { and, eq } from "drizzle-orm";
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
}

const COLUMNS = {
  id: driver.id,
  name: driver.name,
  mobile: driver.mobile,
  driverDayFeeMinor: driver.driverDayFeeMinor,
  driverTripFeeMinor: driver.driverTripFeeMinor,
  licenceExpiry: driver.licenceExpiry,
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
