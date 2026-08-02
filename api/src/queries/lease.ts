import { and, eq } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import { lease } from "../db/schema.js";

type WriteDb = Writer | Tx;
type ReadDb = Reader | Writer | Tx;

export interface NewLease {
  id: string;
  businessId: string;
  vehicleId: string;
  customerId: string;
  status: "active";
  startDate: string;
  endDate?: string;
  billingDay: number;
  rentAmountMinor: bigint;
  mileageDailyLimitKm?: number;
  mileageExcessRateMinor?: bigint;
  reminderDaysBefore?: number;
}

export async function insertLease(db: WriteDb, values: NewLease): Promise<void> {
  await db.insert(lease).values(values);
}

export interface LeaseRow {
  id: string;
  vehicleId: string;
  customerId: string;
  status: "draft" | "active" | "closing" | "closed";
  startDate: string;
  endDate: string | null;
  billingDay: number;
  rentAmountMinor: bigint;
  mileageDailyLimitKm: number | null;
  mileageExcessRateMinor: bigint | null;
  reminderDaysBefore: number;
}

const COLUMNS = {
  id: lease.id,
  vehicleId: lease.vehicleId,
  customerId: lease.customerId,
  status: lease.status,
  startDate: lease.startDate,
  endDate: lease.endDate,
  billingDay: lease.billingDay,
  rentAmountMinor: lease.rentAmountMinor,
  mileageDailyLimitKm: lease.mileageDailyLimitKm,
  mileageExcessRateMinor: lease.mileageExcessRateMinor,
  reminderDaysBefore: lease.reminderDaysBefore,
};

/** Scoped by `businessId` — the same shape every P2+ read gets (CLAUDE.md → Tenancy). */
export async function findLeaseForBusiness(
  db: ReadDb,
  businessId: string,
  leaseId: string,
): Promise<LeaseRow | undefined> {
  const rows = await db
    .select(COLUMNS)
    .from(lease)
    .where(and(eq(lease.id, leaseId), eq(lease.businessId, businessId)))
    .limit(1);
  return rows[0] as LeaseRow | undefined;
}

/** F-2.5/UC-17: old periods keep their old figure (already frozen onto `billing_period` at generation time) — this only changes what the *next* generated period picks up. */
export async function updateLeaseTerms(
  db: WriteDb,
  leaseId: string,
  values: {
    rentAmountMinor: bigint;
    mileageDailyLimitKm?: number;
    mileageExcessRateMinor?: bigint;
  },
): Promise<void> {
  await db
    .update(lease)
    .set({
      rentAmountMinor: values.rentAmountMinor,
      ...(values.mileageDailyLimitKm !== undefined
        ? { mileageDailyLimitKm: values.mileageDailyLimitKm }
        : {}),
      ...(values.mileageExcessRateMinor !== undefined
        ? { mileageExcessRateMinor: values.mileageExcessRateMinor }
        : {}),
    })
    .where(eq(lease.id, leaseId));
}

/** F-3.4/UC-12/D-7: rent_treatment='extend' pushes the term out — the `lease_extension` row is the audit trail for why; this is the plain field update it accompanies. */
export async function updateLeaseEndDate(
  db: WriteDb,
  leaseId: string,
  endDate: string,
): Promise<void> {
  await db.update(lease).set({ endDate }).where(eq(lease.id, leaseId));
}

/** §6.7's borne-by default for arrangement A — "the customer" is whoever currently has the vehicle on an active lease; none found means between rentals, and the caller falls back to `us`. */
export async function findActiveLeaseForVehicle(
  db: ReadDb,
  vehicleId: string,
): Promise<{ customerId: string } | undefined> {
  const rows = await db
    .select({ customerId: lease.customerId })
    .from(lease)
    .where(and(eq(lease.vehicleId, vehicleId), eq(lease.status, "active")))
    .limit(1);
  return rows[0];
}
