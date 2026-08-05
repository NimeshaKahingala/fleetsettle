import { and, eq, lte, sql } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import { deposit, driver, vehicle, vehicleDocument } from "../db/schema.js";
import { sumDepositMovements } from "./driver-money.js";

type ReadDb = Reader | Writer | Tx;

export interface VehicleDocumentWarningRow {
  vehicleId: string;
  registration: string;
  docType: string;
  expiryDate: string;
}

/** F-10.1/UC-92: every vehicle document expiring on or before `throughDate` — already-expired ones included, since the flow keeps warning until the new date is entered rather than dropping off the list. */
export async function listExpiringVehicleDocuments(
  db: ReadDb,
  businessId: string,
  throughDate: string,
): Promise<VehicleDocumentWarningRow[]> {
  const rows = await db
    .select({
      vehicleId: vehicle.id,
      registration: vehicle.registration,
      docType: vehicleDocument.docType,
      expiryDate: vehicleDocument.expiryDate,
    })
    .from(vehicleDocument)
    .innerJoin(vehicle, eq(vehicle.id, vehicleDocument.vehicleId))
    .where(and(eq(vehicle.businessId, businessId), lte(vehicleDocument.expiryDate, throughDate)));
  return rows;
}

export interface DriverLicenceWarningRow {
  driverId: string;
  name: string;
  expiryDate: string;
}

/** F-10.1/UC-92: "plus the driver's licence already held on his record" — the same warning window, a different table. */
export async function listExpiringDriverLicences(
  db: ReadDb,
  businessId: string,
  throughDate: string,
): Promise<DriverLicenceWarningRow[]> {
  const rows = await db
    .select({ driverId: driver.id, name: driver.name, expiryDate: driver.licenceExpiry })
    .from(driver)
    .where(and(eq(driver.businessId, businessId), lte(driver.licenceExpiry, throughDate)));
  return rows.map((r) => ({
    driverId: r.driverId,
    name: r.name,
    expiryDate: r.expiryDate as string,
  }));
}

export interface DepositReleaseRow {
  depositId: string;
  partyType: "customer" | "driver";
  partyId: string;
  holdReleaseDate: string;
  heldMinor: bigint;
}

/**
 * F-2.7/UC-16 step 6, W-29: every deposit whose hold window has reached its
 * release date and is still sitting in it. The number of these is bounded —
 * one per settled lease/daily-lease awaiting release — so summing each
 * deposit's own movements here is the same small, real read `sumDepositsHeld`
 * (queries/reports.ts) already justifies, not the per-row bulk-write loop
 * IG §2 warns against.
 */
export async function listDepositsDueForRelease(
  db: ReadDb,
  businessId: string,
  today: string,
): Promise<DepositReleaseRow[]> {
  const rows = await db
    .select({
      id: deposit.id,
      partyType: deposit.partyType,
      partyCustomerId: deposit.partyCustomerId,
      partyDriverId: deposit.partyDriverId,
      holdReleaseDate: deposit.holdReleaseDate,
    })
    .from(deposit)
    .where(
      and(
        eq(deposit.businessId, businessId),
        eq(deposit.status, "hold_window"),
        sql`${deposit.holdReleaseDate} IS NOT NULL`,
        lte(deposit.holdReleaseDate, today),
      ),
    );

  const result: DepositReleaseRow[] = [];
  for (const row of rows) {
    const heldMinor = await sumDepositMovements(db, row.id);
    result.push({
      depositId: row.id,
      partyType: row.partyType as "customer" | "driver",
      partyId: (row.partyCustomerId ?? row.partyDriverId) as string,
      holdReleaseDate: row.holdReleaseDate as string,
      heldMinor,
    });
  }
  return result;
}
