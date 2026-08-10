import { addDays, monthEnd, newId, type BusinessDate } from "@fleetsettle/shared";
import type { Reader, Tx, Writer } from "../db/client.js";
import { NotFoundError } from "../errors/app-error.js";
import {
  buildCloseChecklist,
  closePeriodRow,
  findOpenPeriodRow,
  openSuccessorPeriod,
  type CloseChecklist,
} from "../queries/accounting-period.js";
import { generateManagementFeeObligationsTx } from "./management-fee.js";

type ReadDb = Reader | Writer | Tx;

export interface AccountingPeriodSummary {
  id: string;
  periodStart: string;
  periodEnd: string;
}

/** F-9.1 step 1's own preview — the same checklist the close response returns, available beforehand (via `c.get("reader")`, no pool connection needed) so a business can review before committing to close. */
export async function getCloseChecklist(
  db: ReadDb,
  businessId: string,
): Promise<{ period: AccountingPeriodSummary; checklist: CloseChecklist }> {
  const open = await findOpenPeriodRow(db, businessId);
  if (!open) throw new NotFoundError("No open accounting period for this business");

  const checklist = await buildCloseChecklist(db, businessId, open.id, open.periodEnd);
  return { period: open, checklist };
}

export interface CloseAccountingPeriodInput {
  businessId: string;
  userId: string;
}

export interface ClosedAccountingPeriod {
  closedPeriod: AccountingPeriodSummary;
  newPeriod: AccountingPeriodSummary;
  checklist: CloseChecklist;
}

/**
 * F-9.1/UC-98, one transaction: closes the currently open period and opens
 * its successor in the same breath (DM §3.1) — a close with no successor
 * stops every later money write dead (`posted_period_id NOT NULL`
 * everywhere), and it is also where a late fact (W-35) has somewhere to post.
 *
 * The checklist is read inside the same transaction and returned alongside
 * the close, but never blocks it (U-7) — there is no invariant here a close
 * could violate that the schema does not already refuse structurally:
 * "cannot close while an earlier period is open" falls out of
 * `one_open_period`'s unique index, since there is only ever one open period
 * to begin with.
 */
export async function closeAccountingPeriod(
  writer: Writer,
  input: CloseAccountingPeriodInput,
): Promise<ClosedAccountingPeriod> {
  return await writer.transaction(async (tx) => {
    const open = await findOpenPeriodRow(tx, input.businessId);
    if (!open) throw new NotFoundError("No open accounting period for this business");

    const checklist = await buildCloseChecklist(tx, input.businessId, open.id, open.periodEnd);

    const closed = await closePeriodRow(tx, open.id, input.userId);
    if (!closed) throw new NotFoundError("No open accounting period for this business");

    const newPeriodId = newId();
    const newPeriodStart = addDays(closed.periodEnd as BusinessDate, 1);
    const newPeriodEnd = monthEnd(newPeriodStart);
    await openSuccessorPeriod(tx, {
      id: newPeriodId,
      businessId: input.businessId,
      periodStart: newPeriodStart,
      periodEnd: newPeriodEnd,
    });

    // A10a/GAP-39/W-53: the new period's own management-fee obligations,
    // generated here for immediacy rather than waiting for the next cron
    // tick — `generate-management-fee` (scheduled.ts) is what catches up a
    // period that opened some other way (or an agreement granted mid-period).
    await generateManagementFeeObligationsTx(tx, {
      businessId: input.businessId,
      periodId: newPeriodId,
      periodStart: newPeriodStart,
    });

    return {
      closedPeriod: { id: open.id, periodStart: open.periodStart, periodEnd: closed.periodEnd },
      newPeriod: { id: newPeriodId, periodStart: newPeriodStart, periodEnd: newPeriodEnd },
      checklist,
    };
  });
}
