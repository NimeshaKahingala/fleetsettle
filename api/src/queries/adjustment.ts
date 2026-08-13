import type { Tx, Writer } from "../db/client.js";
import { adjustment } from "../db/schema.js";

type WriteDb = Writer | Tx;

export interface NewAdjustment {
  id: string;
  businessId: string;
  obligationId: string;
  adjustmentType: string;
  amountMinor: bigint;
  sign: -1 | 1;
  reason?: string;
  occurredOn: string; // GAP-73, migration 0017
  postedPeriodId: string;
  belongsToPeriodId?: string;
  createdBy?: string;
}

/** DM §10.3. Never a deletion — a waiver is a recorded adjustment (UC-15). */
export async function insertAdjustment(db: WriteDb, values: NewAdjustment): Promise<void> {
  await db.insert(adjustment).values(values);
}
