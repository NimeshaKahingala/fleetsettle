import { and, desc, eq } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import { odometerReading } from "../db/schema.js";

type WriteDb = Writer | Tx;
type ReadDb = Reader | Writer | Tx;

export interface NewOdometerReading {
  id: string;
  businessId: string;
  vehicleId: string;
  readingKm: number;
  readOn: string;
  source: "photo" | "in_person" | "reported" | "at_return";
  leaseId?: string;
  tripId?: string;
  attachmentId?: string;
  note?: string;
}

/** INV-19/W-18: how a reading was obtained is part of the reading. */
export async function insertOdometerReading(
  db: WriteDb,
  values: NewOdometerReading,
): Promise<void> {
  await db.insert(odometerReading).values(values);
}

export interface OdometerReadingRow {
  id: string;
  readingKm: number;
  readOn: string;
}

/** The most recent reading taken against this lease — where the next mileage assessment starts from. `undefined` means the handover reading (F-2.1) is the only one so far, or none exists yet. */
export async function findLatestOdometerReadingForLease(
  db: ReadDb,
  leaseId: string,
): Promise<OdometerReadingRow | undefined> {
  const rows = await db
    .select({
      id: odometerReading.id,
      readingKm: odometerReading.readingKm,
      readOn: odometerReading.readOn,
    })
    .from(odometerReading)
    .where(eq(odometerReading.leaseId, leaseId))
    .orderBy(desc(odometerReading.readOn), desc(odometerReading.createdAt))
    .limit(1);
  return rows[0];
}

/** The idempotency read for `odometer_reading_lease_id_read_on_key` — a second submission for the same lease and date is a no-op, read back rather than re-inserted. */
export async function findOdometerReadingByLeaseAndDate(
  db: ReadDb,
  leaseId: string,
  readOn: string,
): Promise<OdometerReadingRow | undefined> {
  const rows = await db
    .select({
      id: odometerReading.id,
      readingKm: odometerReading.readingKm,
      readOn: odometerReading.readOn,
    })
    .from(odometerReading)
    .where(and(eq(odometerReading.leaseId, leaseId), eq(odometerReading.readOn, readOn)))
    .limit(1);
  return rows[0];
}

export async function findOdometerReadingForBusiness(
  db: ReadDb,
  businessId: string,
  id: string,
): Promise<OdometerReadingRow | undefined> {
  const rows = await db
    .select({
      id: odometerReading.id,
      readingKm: odometerReading.readingKm,
      readOn: odometerReading.readOn,
    })
    .from(odometerReading)
    .where(and(eq(odometerReading.id, id), eq(odometerReading.businessId, businessId)))
    .limit(1);
  return rows[0];
}
