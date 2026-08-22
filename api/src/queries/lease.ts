import { and, desc, eq, gt, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import { customer, lease, vehicleDayAllocation } from "../db/schema.js";

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

/**
 * F-2.6/UC-16 step 1: "stop the clock" — no further billing periods generate
 * once status leaves `active` (`generateNextBillingPeriodTx`'s own guard),
 * so this single update is the entire step.
 *
 * `finalPeriodTreatment` (step 1's own choice — full/days-used/agreed) and
 * `closedAt` (GAP-141, 19 Aug 2026 live QA pass, F-4) — neither was ever
 * written before: the wizard asked the user for the first and computed the
 * second implicitly, then discarded both. `closedAt` is set automatically
 * whenever `status` is `"closed"`, the same `closedAt: sql\`now()\`` pattern
 * `accounting-period.ts`'s own `closePeriodRow` already uses, rather than a
 * separate parameter a future caller could pass the wrong status alongside.
 */
export async function updateLeaseStatus(
  db: WriteDb,
  leaseId: string,
  status: LeaseRow["status"],
  endDate?: string,
  finalPeriodTreatment?: string,
): Promise<void> {
  await db
    .update(lease)
    .set({
      status,
      ...(endDate !== undefined ? { endDate } : {}),
      ...(finalPeriodTreatment !== undefined ? { finalPeriodTreatment } : {}),
      ...(status === "closed" ? { closedAt: sql`now()` } : {}),
    })
    .where(eq(lease.id, leaseId));
}

/** F-2.6/UC-16 step 7: "car marked available" — this lease's own future occupancy, beyond the day it actually closed on, freed the same way F-5.5 frees a cancelled trip's (`deleteAllocationDaysForTrip`). Days up to and including the closing date stay — they happened. D-11/W-58: voided, never deleted (DM §4.1). */
export async function deleteLeaseAllocationAfter(
  db: WriteDb,
  leaseId: string,
  afterDate: string,
  voidedBy: string,
): Promise<void> {
  await db
    .update(vehicleDayAllocation)
    .set({ voidedAt: sql`now()`, voidedReason: "Lease closed", voidedBy })
    .where(
      and(
        eq(vehicleDayAllocation.sourceType, "lease"),
        eq(vehicleDayAllocation.sourceId, leaseId),
        gt(vehicleDayAllocation.businessDate, afterDate),
        isNull(vehicleDayAllocation.voidedAt),
      ),
    );
}

export interface VehicleLeaseHistoryRow {
  id: string;
  status: "draft" | "active" | "closing" | "closed";
  startDate: string;
  endDate: string | null;
  rentAmountMinor: bigint;
  customerId: string;
  customerName: string;
}

/** Vehicle overview's history tab (Web-P5): every arrangement-A period this vehicle has had, customer already joined (IG §2), most recent first. */
export async function listLeasesForVehicle(
  db: ReadDb,
  businessId: string,
  vehicleId: string,
): Promise<VehicleLeaseHistoryRow[]> {
  const rows = await db
    .select({
      id: lease.id,
      status: lease.status,
      startDate: lease.startDate,
      endDate: lease.endDate,
      rentAmountMinor: lease.rentAmountMinor,
      customerId: lease.customerId,
      customerName: customer.name,
    })
    .from(lease)
    .innerJoin(customer, eq(customer.id, lease.customerId))
    .where(and(eq(lease.businessId, businessId), eq(lease.vehicleId, vehicleId)))
    .orderBy(desc(lease.startDate));
  return rows as VehicleLeaseHistoryRow[];
}

/**
 * §6.7's borne-by default for arrangement A — "the customer" is whoever
 * held the vehicle on `asOf` (GAP-56), by `startDate`/`endDate`, never by
 * `status`: a lease that has since moved to `closing`/`closed` still had a
 * customer on the date being asked about, and `endDate` is set to the real
 * closing date at that transition (`updateLeaseStatus`), so it stays
 * accurate for history. `status = 'draft'` is unreachable in practice —
 * `startLease` always inserts `'active'` directly — so no status filter is
 * needed to exclude it. None found means between rentals as of that date,
 * and the caller falls back to `us`.
 */
export async function findActiveLeaseForVehicle(
  db: ReadDb,
  vehicleId: string,
  asOf: string,
): Promise<{ customerId: string } | undefined> {
  const rows = await db
    .select({ customerId: lease.customerId })
    .from(lease)
    .where(
      and(
        eq(lease.vehicleId, vehicleId),
        lte(lease.startDate, asOf),
        or(isNull(lease.endDate), gte(lease.endDate, asOf)),
      ),
    )
    .limit(1);
  return rows[0];
}

/**
 * F-1.2/UC-94/GAP-54: the arrangement-change precondition — "no open
 * lease… conflicting with the effective date." Unlike `findActiveLeaseForVehicle`
 * above (a borne-by default, any date range), this filters `status`: a
 * lease not yet `closed` carries a deposit/mileage/billing commitment
 * F-2.6's own multi-step flow exists to unwind, so it blocks the change
 * regardless of its own date range.
 */
export async function findOpenLeaseForVehicle(
  db: ReadDb,
  vehicleId: string,
): Promise<{ id: string } | undefined> {
  const rows = await db
    .select({ id: lease.id })
    .from(lease)
    .where(and(eq(lease.vehicleId, vehicleId), inArray(lease.status, ["active", "closing"])))
    .limit(1);
  return rows[0];
}

/**
 * GAP-160 (review of GAP-158): a lease's own `vehicle_day_allocation` rows
 * only ever reach `generate-day-cards`'s 90-day rolling horizon
 * (`day-card-generation.ts`'s `rangeEnd`) — an open-ended lease, or a
 * fixed-term one whose own `end_date` is further out than that, has no
 * materialised row for a date past it, so `one_arrangement_per_vehicle_day`
 * has nothing to collide against there and a trip booked for it would
 * insert cleanly. `bookTrip` calls this *after* that insert already
 * succeeded, checking the lease's own `start_date`/`end_date` directly
 * rather than its calendar shadow, for exactly the dates the horizon
 * hasn't reached yet.
 *
 * `status IN ('active', 'closing')`, the identical filter
 * `findOpenLeaseForVehicle` above already uses — belt-and-braces, not load-
 * bearing on its own: `closeLease` already rewrites `endDate` to the real
 * closing date at the same `updateLeaseStatus` call that moves status to
 * `closing` (`lease-closure.ts`), so a `closed` lease's own date range is,
 * in the ordinary case, already accurate without needing `status` at all.
 * Kept anyway as the same defence-in-depth `findOpenLeaseForVehicle` reads
 * on, in case that invariant is ever broken by a future change to the
 * closure path — cheap to keep, expensive to be wrong about twice.
 */
export async function findLeaseOverlappingRange(
  db: ReadDb,
  vehicleId: string,
  startDate: string,
  endDate: string,
): Promise<
  { id: string; customerId: string; startDate: string; endDate: string | null } | undefined
> {
  const rows = await db
    .select({
      id: lease.id,
      customerId: lease.customerId,
      startDate: lease.startDate,
      endDate: lease.endDate,
    })
    .from(lease)
    .where(
      and(
        eq(lease.vehicleId, vehicleId),
        inArray(lease.status, ["active", "closing"]),
        lte(lease.startDate, endDate),
        or(isNull(lease.endDate), gte(lease.endDate, startDate)),
      ),
    )
    .limit(1);
  return rows[0];
}
