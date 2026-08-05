import { and, asc, eq, sql } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import { mileagePackage } from "../db/schema.js";

type WriteDb = Writer | Tx;
type ReadDb = Reader | Writer | Tx;

export interface NewMileagePackage {
  id: string;
  businessId: string;
  name: string;
  dailyLimitKm: number;
  excessRateMinorPerKm: bigint;
}

export async function insertMileagePackage(db: WriteDb, values: NewMileagePackage): Promise<void> {
  await db.insert(mileagePackage).values(values);
}

export interface MileagePackageRow {
  id: string;
  name: string;
  dailyLimitKm: number;
  excessRateMinorPerKm: bigint;
  archivedAt: string | null;
}

const MILEAGE_PACKAGE_COLUMNS = {
  id: mileagePackage.id,
  name: mileagePackage.name,
  dailyLimitKm: mileagePackage.dailyLimitKm,
  excessRateMinorPerKm: mileagePackage.excessRateMinorPerKm,
  archivedAt: mileagePackage.archivedAt,
};

/** F-1.9's chip list (F-2.1 step 4) — scoped by `businessId` (CLAUDE.md → Tenancy), every package regardless of archived state; a lease already using an archived one keeps its own independent copy either way, and the client decides whether to still offer it as a chip. */
export async function listMileagePackagesForBusiness(
  db: ReadDb,
  businessId: string,
): Promise<MileagePackageRow[]> {
  const rows = await db
    .select(MILEAGE_PACKAGE_COLUMNS)
    .from(mileagePackage)
    .where(eq(mileagePackage.businessId, businessId))
    .orderBy(asc(mileagePackage.name));
  return rows;
}

export async function findMileagePackageForBusiness(
  db: ReadDb,
  businessId: string,
  id: string,
): Promise<MileagePackageRow | undefined> {
  const rows = await db
    .select(MILEAGE_PACKAGE_COLUMNS)
    .from(mileagePackage)
    .where(and(eq(mileagePackage.businessId, businessId), eq(mileagePackage.id, id)))
    .limit(1);
  return rows[0];
}

/** F-1.9's Accept: archiving never deletes — a lease already using this package keeps its own copy untouched, and the row stays here for that lease's own history to resolve a name from. */
export async function archiveMileagePackageRow(
  db: WriteDb,
  id: string,
): Promise<{ archivedAt: string }> {
  const rows = await db
    .update(mileagePackage)
    .set({ archivedAt: sql`now()` })
    .where(eq(mileagePackage.id, id))
    .returning({ archivedAt: mileagePackage.archivedAt });
  // Written by the SET above, in the same statement — never null on the row this WHERE just matched.
  return rows[0] as { archivedAt: string };
}
