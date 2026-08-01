import type { Tx, Writer } from "../db/client.js";
import { expense } from "../db/schema.js";

type WriteDb = Writer | Tx;

export interface NewExpense {
  id: string;
  businessId: string;
  vehicleId?: string;
  category: string;
  amountMinor: bigint;
  spentOn: string;
  borneBy: "us" | "driver" | "customer";
  borneByDriverId?: string;
  borneByCustomerId?: string;
  paidByUserId?: string;
  litres?: number;
  note?: string;
  postedPeriodId: string;
  belongsToPeriodId?: string;
  createdBy?: string;
}

/** DM §9. `spent_on` is a real date, not the write's timestamp — an expense entered days late is still dated when it happened. */
export async function insertExpense(db: WriteDb, values: NewExpense): Promise<void> {
  await db.insert(expense).values(values);
}
