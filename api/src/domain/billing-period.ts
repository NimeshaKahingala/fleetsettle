import {
  addCalendarMonths,
  addDays,
  inclusiveDays,
  newId,
  type BusinessDate,
} from "@fleetsettle/shared";
import type { Tx, Writer } from "../db/client.js";
import { applyCreditForward } from "./credit-forward.js";
import { isPeriodClosedViolation, isUniqueViolation } from "../db/pg-error.js";
import { NotFoundError, PeriodClosedError, ValidationError } from "../errors/app-error.js";
import { resolvePeriodLinkage } from "../queries/accounting-period.js";
import {
  findBillingPeriodByLeaseAndSeq,
  findLatestBillingPeriodForLease,
  insertBillingPeriod,
  type BillingPeriodRow,
} from "../queries/billing-period.js";
import { findLeaseForBusiness } from "../queries/lease.js";
import { findObligationBySource, insertObligation } from "../queries/obligation.js";
import { listLeasesDueForNextBillingPeriod } from "../queries/scheduled.js";

export interface GenerateNextBillingPeriodInput {
  businessId: string;
  leaseId: string;
}

export interface GeneratedBillingPeriod {
  billingPeriod: BillingPeriodRow;
  obligationId: string | null;
  created: boolean;
}

/**
 * The transactional core, callable either standalone (wrapped below) or
 * composed into a larger transaction (`startLease`'s first period, at lease
 * creation). Never catches — the caller decides what a unique violation on
 * `(lease_id, seq)` means for its own transaction boundary.
 *
 * The period boundaries are computed from the lease's own anchor date, not
 * chained off the previous period's end — `addCalendarMonths` is what makes
 * §7.3's 31 / 28 / 31 / 30 reproducible arithmetic rather than accumulated
 * drift (W-40).
 */
export async function generateNextBillingPeriodTx(
  tx: Tx,
  input: GenerateNextBillingPeriodInput,
): Promise<GeneratedBillingPeriod> {
  const lease = await findLeaseForBusiness(tx, input.businessId, input.leaseId);
  if (!lease) throw new NotFoundError("No such lease in this business");
  if (lease.status !== "active") {
    throw new ValidationError("This lease is not active — no further billing periods generate");
  }

  const latest = await findLatestBillingPeriodForLease(tx, input.leaseId);
  const seq = latest ? latest.seq + 1 : 1;

  const anchor = lease.startDate as BusinessDate;
  const periodStart = addCalendarMonths(anchor, seq - 1);
  const periodEnd = addDays(addCalendarMonths(anchor, seq), -1);
  const daysCount = inclusiveDays(periodStart, periodEnd);

  const allowanceKm =
    lease.mileageDailyLimitKm !== null ? lease.mileageDailyLimitKm * daysCount : undefined;

  const linkage = await resolvePeriodLinkage(tx, input.businessId, periodStart);
  if (!linkage) throw new PeriodClosedError("No accounting period covers this business date yet");

  const billingPeriodId = newId();
  await insertBillingPeriod(tx, {
    id: billingPeriodId,
    leaseId: input.leaseId,
    seq,
    periodStart,
    periodEnd,
    rentAmountMinor: lease.rentAmountMinor,
    ...(allowanceKm !== undefined ? { allowanceKm } : {}),
  });

  const obligationId = newId();
  await insertObligation(tx, {
    id: obligationId,
    businessId: input.businessId,
    direction: "owed_to_us",
    partyType: "customer",
    partyCustomerId: lease.customerId,
    kind: "rent",
    sourceType: "billing_period",
    sourceId: billingPeriodId,
    vehicleId: lease.vehicleId,
    amountMinor: lease.rentAmountMinor,
    settledMinor: 0n,
    waivedMinor: 0n,
    dueOn: periodStart,
    effectiveDueOn: periodStart,
    status: "pending",
    postedPeriodId: linkage.postedPeriodId,
    ...(linkage.belongsToPeriodId !== null ? { belongsToPeriodId: linkage.belongsToPeriodId } : {}),
  });

  // GAP-5b: this customer's own unapplied payment credit (F-2.2's "held as
  // credit against the next due") settles the new month's rent on the spot.
  await applyCreditForward(
    tx,
    input.businessId,
    "customer",
    lease.customerId,
    "owed_to_us",
    obligationId,
    lease.rentAmountMinor,
    periodStart,
  );

  return {
    billingPeriod: {
      id: billingPeriodId,
      leaseId: input.leaseId,
      seq,
      periodStart,
      periodEnd,
      daysCount,
      rentAmountMinor: lease.rentAmountMinor,
      allowanceKm: allowanceKm ?? null,
    },
    obligationId,
    created: true,
  };
}

/**
 * F-2.1/UC-10/W-24/W-40: the next `billing_period` for this lease, plus the
 * rent due it raises — "a billing period on its own owes nobody anything"
 * (F-2.1's own note on the invisible step). Idempotent on `(lease_id, seq)`
 * (DM §6); P13's cron calls this exact function on a schedule, and either
 * path re-firing is a no-op, not a duplicate due.
 */
export async function generateNextBillingPeriod(
  writer: Writer,
  input: GenerateNextBillingPeriodInput,
): Promise<GeneratedBillingPeriod> {
  try {
    return await writer.transaction((tx) => generateNextBillingPeriodTx(tx, input));
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    if (isUniqueViolation(err, "billing_period_lease_id_seq_key")) {
      const latest = await findLatestBillingPeriodForLease(writer, input.leaseId);
      const seq = latest ? latest.seq + 1 : 1;
      const existing = await findBillingPeriodByLeaseAndSeq(writer, input.leaseId, seq);
      if (existing) {
        const obligationRow = await findObligationBySource(
          writer,
          "billing_period",
          existing.id,
          "rent",
          "owed_to_us",
        );
        return { billingPeriod: existing, obligationId: obligationRow?.id ?? null, created: false };
      }
    }
    throw err;
  }
}

export interface RolledBillingPeriod {
  leaseId: string;
  billingPeriodId: string;
  seq: number;
}

/**
 * `generate-billing-periods` (TS §4): every active lease whose latest period
 * has already ended, caught up via the same `generateNextBillingPeriod` a
 * manual `POST .../billing-period` call already uses — one function, two
 * callers, never a second implementation of the period-boundary arithmetic.
 * A lease more than one period behind (the cron missed several days) rolls
 * forward repeatedly here, bounded at 24 periods (two years) so a genuine
 * data problem on one lease loops finitely rather than forever; one lease
 * failing is collected rather than aborting every other lease's own catch-up.
 */
export async function rollDueBillingPeriods(
  writer: Writer,
  today: string,
): Promise<{ rolled: RolledBillingPeriod[]; errors: { leaseId: string; message: string }[] }> {
  const due = await listLeasesDueForNextBillingPeriod(writer, today);
  const rolled: RolledBillingPeriod[] = [];
  const errors: { leaseId: string; message: string }[] = [];

  for (const l of due) {
    try {
      let periodEnd = "";
      let guard = 0;
      while (periodEnd < today && guard < 24) {
        const result = await generateNextBillingPeriod(writer, {
          businessId: l.businessId,
          leaseId: l.id,
        });
        rolled.push({
          leaseId: l.id,
          billingPeriodId: result.billingPeriod.id,
          seq: result.billingPeriod.seq,
        });
        periodEnd = result.billingPeriod.periodEnd;
        guard += 1;
      }
    } catch (err) {
      errors.push({ leaseId: l.id, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return { rolled, errors };
}
