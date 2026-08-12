import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import {
  businessMember,
  customer,
  driver,
  openingBalanceBatch,
  openingBalanceEntry,
  openingBalancePosting,
  vehicle,
} from "../db/schema.js";

type WriteDb = Writer | Tx;
type ReadDb = Reader | Writer | Tx;

export interface OpeningBalanceBatchRow {
  id: string;
  goLiveDate: string;
  status: "draft" | "committed";
  committedAt: string | null;
}

const BATCH_COLUMNS = {
  id: openingBalanceBatch.id,
  goLiveDate: openingBalanceBatch.goLiveDate,
  status: openingBalanceBatch.status,
  committedAt: openingBalanceBatch.committedAt,
};

/** DM §10.6: `business_id UNIQUE` — exactly one batch ever, per business. */
export async function findBatchForBusiness(
  db: ReadDb,
  businessId: string,
): Promise<OpeningBalanceBatchRow | undefined> {
  const rows = await db
    .select(BATCH_COLUMNS)
    .from(openingBalanceBatch)
    .where(eq(openingBalanceBatch.businessId, businessId))
    .limit(1);
  return rows[0] as OpeningBalanceBatchRow | undefined;
}

export async function insertBatch(
  db: WriteDb,
  values: { id: string; businessId: string; goLiveDate: string },
): Promise<void> {
  await db.insert(openingBalanceBatch).values({ ...values, status: "draft" });
}

export async function updateBatchGoLiveDate(
  db: WriteDb,
  batchId: string,
  goLiveDate: string,
): Promise<void> {
  await db
    .update(openingBalanceBatch)
    .set({ goLiveDate })
    .where(eq(openingBalanceBatch.id, batchId));
}

export async function markBatchCommitted(db: WriteDb, batchId: string): Promise<void> {
  await db
    .update(openingBalanceBatch)
    // `now()` is Postgres's clock, not the device's (IG §4.5) — the same
    // pattern queries/vehicle.ts uses for `updatedAt`.
    .set({ status: "committed", committedAt: sql`now()` })
    .where(eq(openingBalanceBatch.id, batchId));
}

export interface OpeningBalanceEntryRow {
  id: string;
  kind:
    | "customer_due"
    | "driver_arrears"
    | "owed_to_driver"
    | "deposit_held"
    | "advance_outstanding"
    | "cash_held";
  partyCustomerId: string | null;
  partyDriverId: string | null;
  partyUserId: string | null;
  vehicleId: string | null;
  amountMinor: bigint;
  originalDueDate: string | null;
}

const ENTRY_COLUMNS = {
  id: openingBalanceEntry.id,
  kind: openingBalanceEntry.kind,
  partyCustomerId: openingBalanceEntry.partyCustomerId,
  partyDriverId: openingBalanceEntry.partyDriverId,
  partyUserId: openingBalanceEntry.partyUserId,
  vehicleId: openingBalanceEntry.vehicleId,
  amountMinor: openingBalanceEntry.amountMinor,
  originalDueDate: openingBalanceEntry.originalDueDate,
};

export async function findEntriesForBatch(
  db: ReadDb,
  batchId: string,
): Promise<OpeningBalanceEntryRow[]> {
  const rows = await db
    .select(ENTRY_COLUMNS)
    .from(openingBalanceEntry)
    .where(eq(openingBalanceEntry.batchId, batchId));
  return rows as OpeningBalanceEntryRow[];
}

// opening_balance_entry (DM §10.6) deliberately carries no voided_at/voided_by/posted_period_id:
// it is a pre-close starting position, replaced wholesale on every save (F-0.2's draft-then-correct
// flow), not a posted transaction under W-50.
export async function deleteEntriesForBatch(db: WriteDb, batchId: string): Promise<void> {
  // eslint-disable-next-line no-restricted-syntax -- see comment above: not a W-50 posted transaction
  await db.delete(openingBalanceEntry).where(eq(openingBalanceEntry.batchId, batchId));
}

export interface NewOpeningBalanceEntry {
  id: string;
  batchId: string;
  kind: OpeningBalanceEntryRow["kind"];
  partyCustomerId?: string;
  partyDriverId?: string;
  partyUserId?: string;
  vehicleId?: string;
  amountMinor: bigint;
  originalDueDate?: string;
}

/** IG §3.1: one multi-row insert, never a loop issuing one query per entry. */
export async function insertEntries(db: WriteDb, values: NewOpeningBalanceEntry[]): Promise<void> {
  if (values.length === 0) return;
  await db.insert(openingBalanceEntry).values(values);
}

/**
 * Bulk tenant-scoping checks for the parties an entry batch references — one
 * query per party type regardless of how many entries name one (IG §3.1),
 * returning only the ids that really belong to this business so the caller
 * can diff against what was asked for and 404 on the rest (CLAUDE.md →
 * Tenancy: a party from another business is "not found", not "forbidden").
 * `business_member` has no direct `active` flag check here — a revoked
 * member can still be the historical holder of an opening cash figure.
 */
export async function findOwnCustomerIds(
  db: ReadDb,
  businessId: string,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: customer.id })
    .from(customer)
    .where(and(eq(customer.businessId, businessId), inArray(customer.id, ids)));
  return new Set(rows.map((r) => r.id));
}

export async function findOwnDriverIds(
  db: ReadDb,
  businessId: string,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: driver.id })
    .from(driver)
    .where(and(eq(driver.businessId, businessId), inArray(driver.id, ids)));
  return new Set(rows.map((r) => r.id));
}

export async function findOwnVehicleIds(
  db: ReadDb,
  businessId: string,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: vehicle.id })
    .from(vehicle)
    .where(and(eq(vehicle.businessId, businessId), inArray(vehicle.id, ids)));
  return new Set(rows.map((r) => r.id));
}

/** `cash_held`'s party is a business partner — a `business_member`'s `user_id`, not `app_user.id` directly. */
export async function findOwnMemberUserIds(
  db: ReadDb,
  businessId: string,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: businessMember.userId })
    .from(businessMember)
    .where(and(eq(businessMember.businessId, businessId), inArray(businessMember.userId, ids)));
  return new Set(rows.map((r) => r.id));
}

export interface NewOpeningBalancePosting {
  id: string;
  businessId: string;
  batchId: string;
  entryKind: OpeningBalanceEntryRow["kind"];
  targetTable: "obligation" | "deposit_movement" | "advance" | "payment";
  targetId: string;
  depositId?: string;
}

/** GAP-103/migration 0014: one row per materialised fact, IG §3.1's one multi-row insert rather than a loop per entry. */
export async function insertPostings(
  db: WriteDb,
  values: NewOpeningBalancePosting[],
): Promise<void> {
  if (values.length === 0) return;
  await db.insert(openingBalancePosting).values(values);
}

export interface OpeningBalancePostingRow {
  entryKind: OpeningBalanceEntryRow["kind"];
  targetTable: "obligation" | "deposit_movement" | "advance" | "payment";
  targetId: string;
  depositId: string | null;
}

/** F-0.2's own Alternates clause reached from the write side: everything this batch has posted that a later correction hasn't already reversed. */
export async function findActivePostingsForBatch(
  db: ReadDb,
  batchId: string,
): Promise<OpeningBalancePostingRow[]> {
  const rows = await db
    .select({
      entryKind: openingBalancePosting.entryKind,
      targetTable: openingBalancePosting.targetTable,
      targetId: openingBalancePosting.targetId,
      depositId: openingBalancePosting.depositId,
    })
    .from(openingBalancePosting)
    .where(
      and(eq(openingBalancePosting.batchId, batchId), isNull(openingBalancePosting.reversedAt)),
    );
  return rows as OpeningBalancePostingRow[];
}

/** Marks a posting's own bookkeeping row done — the money fact itself is reversed separately (void, for obligation/advance; an offsetting entry, for deposit_movement/payment), this only stops the same posting being reversed twice. */
export async function markPostingsReversed(db: WriteDb, batchId: string): Promise<void> {
  await db
    .update(openingBalancePosting)
    .set({ reversedAt: sql`now()` })
    .where(
      and(eq(openingBalancePosting.batchId, batchId), isNull(openingBalancePosting.reversedAt)),
    );
}
