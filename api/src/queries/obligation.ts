import { and, eq } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import { obligation } from "../db/schema.js";

type WriteDb = Writer | Tx;
type ReadDb = Reader | Writer | Tx;

export interface NewObligation {
  id: string;
  businessId: string;
  direction: "owed_to_us" | "owed_by_us";
  partyType: "customer" | "driver" | "partner";
  partyDriverId?: string;
  partyCustomerId?: string;
  partyUserId?: string;
  kind:
    | "rent"
    | "mileage_excess"
    | "daily_amount"
    | "driver_fee"
    | "post_closure_charge"
    | "customer_contribution"
    | "management_fee"
    | "other";
  sourceType: string;
  sourceId?: string;
  vehicleId?: string;
  amountMinor: bigint;
  settledMinor: bigint;
  waivedMinor: bigint;
  dueOn: string;
  effectiveDueOn: string;
  status: "pending" | "part_paid" | "paid" | "waived" | "written_off";
  postedPeriodId: string;
  belongsToPeriodId?: string;
}

/** DM §10.1: everything anyone owes anyone. `settledMinor`/`status` are supplied already-correct by the caller — this endpoint's writes never need a follow-up UPDATE (CLAUDE.md → Writes: one transaction). */
export async function insertObligation(db: WriteDb, values: NewObligation): Promise<void> {
  await db.insert(obligation).values(values);
}

export interface ObligationRow {
  id: string;
  amountMinor: bigint;
  settledMinor: bigint;
  status: string;
}

/** A day_record's obligation — `source_type = 'day_record'` (DM §10.1) — read back for the idempotent no-op response. */
export async function findObligationBySource(
  db: ReadDb,
  sourceType: string,
  sourceId: string,
): Promise<ObligationRow | undefined> {
  const rows = await db
    .select({
      id: obligation.id,
      amountMinor: obligation.amountMinor,
      settledMinor: obligation.settledMinor,
      status: obligation.status,
    })
    .from(obligation)
    .where(and(eq(obligation.sourceType, sourceType), eq(obligation.sourceId, sourceId)))
    .limit(1);
  return rows[0];
}
