import { and, eq } from "drizzle-orm";
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
};

/** Scoped by `businessId` — the same shape every P2+ read gets (CLAUDE.md → Tenancy). */
export async function findCustomerForBusiness(
  db: ReadDb,
  businessId: string,
  customerId: string,
): Promise<CustomerRow | undefined> {
  const rows = await db
    .select(COLUMNS)
    .from(customer)
    .where(and(eq(customer.id, customerId), eq(customer.businessId, businessId)))
    .limit(1);
  return rows[0] as CustomerRow | undefined;
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
