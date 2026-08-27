import { and, eq, isNull, sql } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import { customer } from "../db/schema.js";

type WriteDb = Writer | Tx;
type ReadDb = Reader | Writer | Tx;

export interface NewCustomer {
  id: string;
  businessId: string;
  customerType: "person" | "organisation";
  name: string;
  nic?: string;
  registrationNo?: string;
  contactPerson?: string;
  mobile?: string;
  address?: string;
}

export async function insertCustomer(db: WriteDb, values: NewCustomer): Promise<void> {
  await db.insert(customer).values(values);
}

export interface CustomerRow {
  id: string;
  customerType: "person" | "organisation";
  name: string;
  nic: string | null;
  registrationNo: string | null;
  contactPerson: string | null;
  mobile: string | null;
  address: string | null;
  voidedAt: string | null;
}

const COLUMNS = {
  id: customer.id,
  customerType: customer.customerType,
  name: customer.name,
  nic: customer.nic,
  registrationNo: customer.registrationNo,
  contactPerson: customer.contactPerson,
  mobile: customer.mobile,
  address: customer.address,
  voidedAt: customer.voidedAt,
};

/**
 * Scoped by `businessId` — the same shape every P2+ read gets (CLAUDE.md → Tenancy).
 *
 * GAP-190/B13 (Gitar review): `forUpdate` locks this row for the caller's
 * own transaction — see `findDriverForBusiness`'s own comment, the same
 * reasoning applied to `customer`.
 */
export async function findCustomerForBusiness(
  db: ReadDb,
  businessId: string,
  customerId: string,
  forUpdate = false,
): Promise<CustomerRow | undefined> {
  const query = db
    .select(COLUMNS)
    .from(customer)
    .where(and(eq(customer.id, customerId), eq(customer.businessId, businessId)))
    .limit(1);
  const rows = await (forUpdate ? query.for("update") : query);
  return rows[0] as CustomerRow | undefined;
}

/**
 * F-1.11/GAP-36: archive, never delete (W-58) — the same `voided_*` trio
 * migration 0023 gave this table, so a closed month that names this customer
 * keeps rendering exactly as before. INV-35's open-money check runs before
 * this is ever called. `WHERE … voided_at IS NULL` (found by review, same
 * shape `voidAdvanceById` already uses): the already-archived check upstream
 * is a separate read, not atomic with this write, so two concurrent archives
 * could otherwise both pass the check and the second silently overwrite the
 * first's own reason and actor — this guard makes a losing race 0 rows
 * (mapped to `PartyAlreadyArchivedError` by the caller) rather than a
 * clobber.
 */
export async function archiveCustomerRow(
  db: WriteDb,
  customerId: string,
  values: { voidedReason: string; voidedBy: string },
): Promise<{ voidedAt: string } | undefined> {
  const rows = await db
    .update(customer)
    .set({ voidedAt: sql`now()`, voidedReason: values.voidedReason, voidedBy: values.voidedBy })
    .where(and(eq(customer.id, customerId), isNull(customer.voidedAt)))
    .returning({ voidedAt: customer.voidedAt });
  return rows[0] as { voidedAt: string } | undefined;
}

/** F-1.11's "Unarchive" alternate: nothing about his history changed while he was gone, so there is nothing else to touch. */
export async function unarchiveCustomerRow(db: WriteDb, customerId: string): Promise<void> {
  await db
    .update(customer)
    .set({ voidedAt: null, voidedReason: null, voidedBy: null })
    .where(eq(customer.id, customerId));
}

export async function listCustomersForBusiness(
  db: ReadDb,
  businessId: string,
): Promise<CustomerRow[]> {
  const rows = await db
    .select(COLUMNS)
    .from(customer)
    .where(eq(customer.businessId, businessId))
    .orderBy(customer.createdAt);
  return rows as CustomerRow[];
}
