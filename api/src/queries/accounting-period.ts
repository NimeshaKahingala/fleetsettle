import { and, asc, eq, gte, lte, ne, sql } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import { accountingPeriod, advance, incident, obligation, trip } from "../db/schema.js";

type ReadDb = Reader | Writer | Tx;
type WriteDb = Writer | Tx;

export interface PeriodLinkage {
  postedPeriodId: string;
  belongsToPeriodId: string | null;
}

/** The currently open period — every money write posts here (`assert_period_open()` is the truth; this is only how the app learns which id to try). */
export async function findOpenPeriodForBusiness(
  db: ReadDb,
  businessId: string,
): Promise<{ id: string } | undefined> {
  const rows = await db
    .select({ id: accountingPeriod.id })
    .from(accountingPeriod)
    .where(and(eq(accountingPeriod.businessId, businessId), eq(accountingPeriod.status, "open")))
    .limit(1);
  return rows[0];
}

/** The period whose range actually contains `businessDate`, open or closed — used to tell a late fact (W-35) from an on-time one. */
export async function findPeriodForDate(
  db: ReadDb,
  businessId: string,
  businessDate: string,
): Promise<{ id: string } | undefined> {
  const rows = await db
    .select({ id: accountingPeriod.id })
    .from(accountingPeriod)
    .where(
      and(
        eq(accountingPeriod.businessId, businessId),
        lte(accountingPeriod.periodStart, businessDate),
        gte(accountingPeriod.periodEnd, businessDate),
      ),
    )
    .limit(1);
  return rows[0];
}

/**
 * W-35: `postedPeriodId` is always the currently open period — a closed
 * period can never receive a direct insert (`assert_period_open()`).
 * `belongsToPeriodId` is set only when `businessDate` actually falls in a
 * *different*, earlier period than the one it posts to — a late fact.
 *
 * No open period, and no period covering the date either — a business with
 * no active month at all (P9 hasn't opened one, or P13 hasn't rolled one
 * over yet). Neither exists in this phase, so the caller gets an honest
 * `undefined` rather than a linkage this function invented.
 */
export async function resolvePeriodLinkage(
  db: ReadDb,
  businessId: string,
  businessDate: string,
): Promise<PeriodLinkage | undefined> {
  const open = await findOpenPeriodForBusiness(db, businessId);
  if (!open) return undefined;

  const forDate = await findPeriodForDate(db, businessId, businessDate);
  const belongsToPeriodId = forDate && forDate.id !== open.id ? forDate.id : null;
  return { postedPeriodId: open.id, belongsToPeriodId };
}

/** F-0.2's own Alternates clause/UC-09: "an opening figure stays editable until the first accounting period is closed." The earliest period by `period_start` is always the business's first — periods are only ever created forward (F-0.1 at creation, F-9.1 on every close), never backdated. */
export async function findFirstPeriodStatus(
  db: ReadDb,
  businessId: string,
): Promise<{ status: string } | undefined> {
  const rows = await db
    .select({ status: accountingPeriod.status })
    .from(accountingPeriod)
    .where(eq(accountingPeriod.businessId, businessId))
    .orderBy(asc(accountingPeriod.periodStart))
    .limit(1);
  return rows[0];
}

export interface OpenPeriodRow {
  id: string;
  periodStart: string;
  periodEnd: string;
}

/** F-9.1/UC-98: the full row for the period this business is currently operating in — what `closeAccountingPeriod` needs beyond just the id. */
export async function findOpenPeriodRow(
  db: ReadDb,
  businessId: string,
): Promise<OpenPeriodRow | undefined> {
  const rows = await db
    .select({
      id: accountingPeriod.id,
      periodStart: accountingPeriod.periodStart,
      periodEnd: accountingPeriod.periodEnd,
    })
    .from(accountingPeriod)
    .where(and(eq(accountingPeriod.businessId, businessId), eq(accountingPeriod.status, "open")))
    .limit(1);
  return rows[0];
}

/**
 * DM §3.1's close step, the UPDATE half. `WHERE status='open'` doubles as the
 * idempotency guard: a concurrent double-close's second caller matches zero
 * rows rather than closing an already-closed period a second time.
 */
export async function closePeriodRow(
  db: WriteDb,
  periodId: string,
  closedBy: string,
): Promise<{ id: string; periodEnd: string } | undefined> {
  const rows = await db
    .update(accountingPeriod)
    .set({ status: "closed", closedAt: sql`now()`, closedBy })
    .where(and(eq(accountingPeriod.id, periodId), eq(accountingPeriod.status, "open")))
    .returning({ id: accountingPeriod.id, periodEnd: accountingPeriod.periodEnd });
  return rows[0];
}

/** DM §3.1's close step, the successor-INSERT half — in the same transaction as `closePeriodRow` (F-9.1: "a close that leaves nowhere to post is a close that breaks the rule it exists to serve"). */
export async function openSuccessorPeriod(
  db: WriteDb,
  values: { id: string; businessId: string; periodStart: string; periodEnd: string },
): Promise<void> {
  await db.insert(accountingPeriod).values({ ...values, status: "open" });
}

export interface CloseChecklist {
  openTrips: number;
  unreconciledAdvances: number;
  pendingObligations: number;
  openIncidents: number;
}

/**
 * F-9.1 step 1/UC-98: "unconfirmed days, trips still open, unreconciled
 * advances, dues awaiting a decision, incidents with no bill yet." Warns and
 * lists; it never blocks (U-7) — there is nothing here a close could violate
 * that the schema does not already refuse structurally (`one_open_period`
 * makes "an earlier period is open" impossible to reach in the first place).
 *
 * Trips are scoped to "already started by this period's end" (a trip booked
 * for next month is not this close's business yet) and obligations to
 * `postedPeriodId = periodId` (a due raised last month is an ageing
 * receivable, not a decision this close is waiting on). Advances
 * and incidents are scoped only by `businessId`: an advance issued in March
 * still open in July, or an incident still open from last month, is exactly
 * as much this close's business as one from this period.
 *
 * "Unconfirmed days" is deliberately not counted: a day with no `day_record`
 * row is indistinguishable from a day the driver's pattern never scheduled
 * without replaying that pattern, and the logic to do that belongs to P13's
 * `generate-day-cards`, which does not exist yet. Recorded rather than
 * guessed at, the same deferral this tracker has already made for every
 * other P13-shaped gap.
 */
export async function buildCloseChecklist(
  db: ReadDb,
  businessId: string,
  periodId: string,
  periodEnd: string,
): Promise<CloseChecklist> {
  const [openTripsRows, unreconciledAdvancesRows, pendingObligationsRows, openIncidentsRows] =
    await Promise.all([
      db
        .select({ count: sql<string>`COUNT(*)` })
        .from(trip)
        .where(
          and(
            eq(trip.businessId, businessId),
            sql`${trip.status} IN ('hold', 'booked', 'in_progress')`,
            lte(trip.startDate, periodEnd),
          ),
        ),
      db
        .select({ count: sql<string>`COUNT(*)` })
        .from(advance)
        .where(
          and(
            eq(advance.businessId, businessId),
            ne(advance.status, "settled"),
            sql`${advance.voidedAt} IS NULL`,
          ),
        ),
      db
        .select({ count: sql<string>`COUNT(*)` })
        .from(obligation)
        .where(
          and(
            eq(obligation.businessId, businessId),
            eq(obligation.postedPeriodId, periodId),
            sql`${obligation.status} IN ('pending', 'part_paid')`,
            sql`${obligation.voidedAt} IS NULL`,
          ),
        ),
      db
        .select({ count: sql<string>`COUNT(*)` })
        .from(incident)
        .where(and(eq(incident.businessId, businessId), eq(incident.status, "open"))),
    ]);

  // eslint-disable-next-line no-restricted-syntax -- a row count for a warn-only checklist, not money
  const toCount = (rows: { count: string }[]) => Number(rows[0]?.count ?? "0");
  return {
    openTrips: toCount(openTripsRows),
    unreconciledAdvances: toCount(unreconciledAdvancesRows),
    pendingObligations: toCount(pendingObligationsRows),
    openIncidents: toCount(openIncidentsRows),
  };
}
