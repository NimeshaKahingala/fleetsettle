import { and, asc, desc, eq, gt, gte, lte } from "drizzle-orm";
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

/** F-3.4/UC-12/W-9 'credit_days': the one billing period whose range actually contains `onDate` — the pro-rata rent credit is computed against this period's own rent and day count. */
export async function findBillingPeriodCoveringDate(
  db: ReadDb,
  leaseId: string,
  onDate: string,
): Promise<BillingPeriodRow | undefined> {
  const rows = await db
    .select(COLUMNS)
    .from(billingPeriod)
    .where(
      and(
        eq(billingPeriod.leaseId, leaseId),
        lte(billingPeriod.periodStart, onDate),
        gte(billingPeriod.periodEnd, onDate),
      ),
    )
    .limit(1);
  return rows[0] as BillingPeriodRow | undefined;
}

/**
 * F-2.6/UC-16 step 3: shortens the covering billing period's own `period_end`
 * (and its allowance, recomputed for the days actually covered) to the
 * closing date. `days_count` is a generated column (DM §6) and updates
 * itself; `rent_amount_minor` is deliberately untouched here (W-25: "fixed,
 * regardless of days") — the final period's own charge is a separate
 * adjustment against the obligation, never a change to this stored figure.
 */
export async function truncateBillingPeriodForClosure(
  db: WriteDb,
  billingPeriodId: string,
  periodEnd: string,
  allowanceKm?: number,
): Promise<void> {
  await db
    .update(billingPeriod)
    .set({ periodEnd, ...(allowanceKm !== undefined ? { allowanceKm } : {}) })
    .where(eq(billingPeriod.id, billingPeriodId));
}

/**
 * F-2.3/GAP-205/H-3: every period this mileage reading closes out — the
 * periods whose **end** falls in `(fromDate, toDate]`. Both bounds are on
 * `period_end`, deliberately, because "closes out" is a statement about a
 * period having *ended*, never about when it began.
 *
 * `fromDate` is the previous reading's own date, so a period is only
 * genuinely still open if it ends *after* that date (`gt`, strict) — a
 * period ending exactly on it was the one that previous reading itself
 * already closed, and including it again would double-count it against a
 * second assessment.
 *
 * `toDate` is this reading's date, and bounds `period_end` inclusively
 * (`lte`) — **corrected 31 Aug 2026**, it used to bound `period_start`, and
 * that was a real under-billing bug rather than a stylistic choice.
 * `rollDueBillingPeriods` (queries/scheduled.ts) generates the next period
 * as soon as `latestPeriodEnd < today`, so on the morning a period ends the
 * *following* period already exists with `period_start = toDate`. An
 * ordinary, perfectly on-time reading that afternoon therefore swept in a
 * period that had barely started, and `combinedAllowanceKm`
 * (domain/mileage.ts) adds each period's full `allowanceKm` with no
 * proration — granting a whole period's allowance early, understating
 * `excessKm`, and under-billing the customer. The next reading then matched
 * the same period again for its real close-out, counting one allowance
 * twice. CLAUDE.md's "mileage is one-directional" rule is exactly this:
 * driving under an allowance produces no credit and no carry-forward, and a
 * not-yet-elapsed period is the purest form of "under the allowance."
 *
 * The original GAP-205 case still works, which is the point of moving the
 * bound rather than reverting it. The old predicate (`periodStart >=
 * fromDate AND periodEnd <= toDate`, full containment) refused a reading
 * whenever the *previous* one landed even a day late: a late reading's date
 * sits inside the period it closed, so the next period's `periodStart` —
 * which precedes that late date — failed `periodStart >= fromDate`, and
 * `periods.length === 0` read as "no billing period covers this range yet."
 * Dropping the `period_start` bound entirely, rather than loosening it,
 * fixes that without ever admitting a period that has not ended.
 *
 * No separate exclusion against `mileage_assessment`/`_split` is needed:
 * billing periods are strictly adjacent with no gaps (this file's own
 * generator sets `period_end` to the day before the next `period_start`),
 * and `previous.readOn` is always either the handover reading or exactly the
 * `toReadingId` date of the assessment that closed everything up to it — so
 * the strict `gt` on `periodEnd` alone is what the exclusion needs.
 */
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
        gt(billingPeriod.periodEnd, fromDate),
        lte(billingPeriod.periodEnd, toDate),
      ),
    )
    .orderBy(asc(billingPeriod.seq));
  return rows as BillingPeriodRow[];
}
