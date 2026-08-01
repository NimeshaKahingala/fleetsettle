import { and, eq, lte, gte } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import { accountingPeriod } from "../db/schema.js";

type ReadDb = Reader | Writer | Tx;

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
