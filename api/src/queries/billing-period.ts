import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import { billingPeriod } from "../db/schema.js";

type WriteDb = Writer | Tx;
type ReadDb = Reader | Writer | Tx;

export interface NewBillingPeriod {
  id: string;
  leaseId: string;
  seq: number;
  periodStart: string;
  periodEnd: string;
  rentAmountMinor: bigint;
  allowanceKm?: number;
}

/** DM §6: `days_count` is a generated column — never supplied, always read back. */
export async function insertBillingPeriod(db: WriteDb, values: NewBillingPeriod): Promise<void> {
  await db.insert(billingPeriod).values(values);
}

export interface BillingPeriodRow {
  id: string;
  leaseId: string;
  seq: number;
  periodStart: string;
  periodEnd: string;
  daysCount: number;
  rentAmountMinor: bigint;
  allowanceKm: number | null;
}

const COLUMNS = {
  id: billingPeriod.id,
  leaseId: billingPeriod.leaseId,
  seq: billingPeriod.seq,
  periodStart: billingPeriod.periodStart,
  periodEnd: billingPeriod.periodEnd,
  daysCount: billingPeriod.daysCount,
  rentAmountMinor: billingPeriod.rentAmountMinor,
  allowanceKm: billingPeriod.allowanceKm,
};

/** The idempotency read for `(lease_id, seq)` — a second "generate the next period" call for the same seq is a no-op, read back rather than re-inserted. */
export async function findBillingPeriodByLeaseAndSeq(
  db: ReadDb,
  leaseId: string,
  seq: number,
): Promise<BillingPeriodRow | undefined> {
  const rows = await db
    .select(COLUMNS)
    .from(billingPeriod)
    .where(and(eq(billingPeriod.leaseId, leaseId), eq(billingPeriod.seq, seq)))
    .limit(1);
  return rows[0] as BillingPeriodRow | undefined;
}

/** The most recently generated period for this lease — where the next one picks up from. */
export async function findLatestBillingPeriodForLease(
  db: ReadDb,
  leaseId: string,
): Promise<BillingPeriodRow | undefined> {
  const rows = await db
    .select(COLUMNS)
    .from(billingPeriod)
    .where(eq(billingPeriod.leaseId, leaseId))
    .orderBy(desc(billingPeriod.seq))
    .limit(1);
  return rows[0] as BillingPeriodRow | undefined;
}

export async function findBillingPeriodsForLease(
  db: ReadDb,
  leaseId: string,
): Promise<BillingPeriodRow[]> {
  const rows = await db
    .select(COLUMNS)
    .from(billingPeriod)
    .where(eq(billingPeriod.leaseId, leaseId))
    .orderBy(asc(billingPeriod.seq));
  return rows as BillingPeriodRow[];
}

/** F-2.3: every period fully contained in `[fromDate, toDate]` — the ones a mileage assessment between two readings can possibly span. */
export async function findBillingPeriodsInRange(
  db: ReadDb,
  leaseId: string,
  fromDate: string,
  toDate: string,
): Promise<BillingPeriodRow[]> {
  const rows = await db
    .select(COLUMNS)
    .from(billingPeriod)
    .where(
      and(
        eq(billingPeriod.leaseId, leaseId),
        gte(billingPeriod.periodStart, fromDate),
        lte(billingPeriod.periodEnd, toDate),
      ),
    )
    .orderBy(asc(billingPeriod.seq));
  return rows as BillingPeriodRow[];
}
