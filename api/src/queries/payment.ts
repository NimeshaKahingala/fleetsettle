import type { Tx, Writer } from "../db/client.js";
import { payment, paymentAllocation } from "../db/schema.js";

type WriteDb = Writer | Tx;

export interface NewPayment {
  id: string;
  businessId: string;
  direction: "received" | "paid";
  partyType: "customer" | "driver" | "partner";
  partyDriverId?: string;
  partyCustomerId?: string;
  partyUserId?: string;
  amountMinor: bigint;
  occurredOn: string;
  handledByUserId?: string;
  postedPeriodId: string;
  belongsToPeriodId?: string;
  createdBy?: string;
}

/** DM §10.2. `amountMinor` has a `CHECK (> 0)` — the caller only reaches this when something was actually received. */
export async function insertPayment(db: WriteDb, values: NewPayment): Promise<void> {
  await db.insert(payment).values(values);
}

export interface NewPaymentAllocation {
  id: string;
  paymentId: string;
  obligationId: string;
  amountMinor: bigint;
  allocatedOn: string;
}

/** DM §10.2: the oldest-first allocation record — one obligation for a single day confirm, never a loop over many (that's F-4.5/F-4.6's own allocation preview). */
export async function insertPaymentAllocation(
  db: WriteDb,
  values: NewPaymentAllocation,
): Promise<void> {
  await db.insert(paymentAllocation).values(values);
}
