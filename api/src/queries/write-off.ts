import { and, eq } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import { writeOff, writeOffRecovery } from "../db/schema.js";

type WriteDb = Writer | Tx;
type ReadDb = Reader | Writer | Tx;

export interface NewWriteOff {
  id: string;
  businessId: string;
  obligationId?: string;
  partyType: "customer" | "driver";
  partyCustomerId?: string;
  partyDriverId?: string;
  vehicleId?: string;
  amountMinor: bigint;
  reason: string;
  writtenOffOn: string;
  postedPeriodId: string;
  belongsToPeriodId?: string;
  createdBy?: string;
}

/** F-8.3/UC-90/W-28. */
export async function insertWriteOff(db: WriteDb, values: NewWriteOff): Promise<void> {
  await db.insert(writeOff).values(values);
}

export interface WriteOffRow {
  id: string;
  obligationId: string | null;
  partyType: "customer" | "driver";
  partyCustomerId: string | null;
  partyDriverId: string | null;
  vehicleId: string | null;
  amountMinor: bigint;
  reason: string;
  writtenOffOn: string;
  voidedAt: string | null;
}

/** Scoped by `businessId` — the same tenancy shape every P2+ read gets. */
export async function findWriteOffForBusiness(
  db: ReadDb,
  businessId: string,
  writeOffId: string,
): Promise<WriteOffRow | undefined> {
  const rows = await db
    .select({
      id: writeOff.id,
      obligationId: writeOff.obligationId,
      partyType: writeOff.partyType,
      partyCustomerId: writeOff.partyCustomerId,
      partyDriverId: writeOff.partyDriverId,
      vehicleId: writeOff.vehicleId,
      amountMinor: writeOff.amountMinor,
      reason: writeOff.reason,
      writtenOffOn: writeOff.writtenOffOn,
      voidedAt: writeOff.voidedAt,
    })
    .from(writeOff)
    .where(and(eq(writeOff.id, writeOffId), eq(writeOff.businessId, businessId)))
    .limit(1);
  return rows[0] as WriteOffRow | undefined;
}

export interface NewWriteOffRecovery {
  id: string;
  businessId: string;
  writeOffId: string;
  paymentId: string;
  amountMinor: bigint;
  postedPeriodId: string;
  belongsToPeriodId?: string;
}

/** INV-15: nets against the write-off it recovers — never fresh income. */
export async function insertWriteOffRecovery(
  db: WriteDb,
  values: NewWriteOffRecovery,
): Promise<void> {
  await db.insert(writeOffRecovery).values(values);
}
