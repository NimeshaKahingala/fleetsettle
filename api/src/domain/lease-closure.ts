import { addDays, inclusiveDays, split, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { OdometerSource } from "@fleetsettle/shared/schemas";
import type { Reader, Writer } from "../db/client.js";
import { NotFoundError, ValidationError } from "../errors/app-error.js";
import {
  findBillingPeriodCoveringDate,
  truncateBillingPeriodForClosure,
} from "../queries/billing-period.js";
import { findBusinessSettings } from "../queries/business.js";
import {
  findDepositForLease,
  sumDepositMovements,
  updateDepositStatus,
  type DepositRow,
} from "../queries/driver-money.js";
import { listOpenIncidentsForLease } from "../queries/incident.js";
import {
  deleteLeaseAllocationAfter,
  findLeaseForBusiness,
  updateLeaseStatus,
} from "../queries/lease.js";
import {
  findObligationBySource,
  findOutstandingObligationsForParty,
  type OutstandingObligation,
} from "../queries/obligation.js";
import { applyAdjustmentTx } from "./adjustment.js";
import { assessMileage } from "./mileage.js";
import { recordDepositMovement, recordDepositMovementTx } from "./deposit.js";

/**
 * F-2.6/UC-16 "Close the lease" — a wizard with a running order (W-26), so
 * this module is four separate entry points against the lease's own
 * `status` state machine (`active → closing → closed`) rather than one
 * giant call: `closeLease` (steps 1–3), `getLeaseClosureSummary` (step 4,
 * INV-18), `settleLeaseDeposit` (step 6), `closeOutLease` (step 7). Step 5
 * (the return condition set, W-30) is not built here — it needs R2, which
 * this codebase does not have yet (TRACKER.md).
 */

export interface CloseLeaseInput {
  businessId: string;
  leaseId: string;
  closingDate: BusinessDate;
  finalPeriodMode: "full" | "days_used" | "agreed";
  agreedAmountMinor?: Minor;
  note?: string;
  closingOdometerKm?: number;
  odometerSource?: OdometerSource;
  userId: string;
}

export interface ClosedLeaseFinalPeriod {
  billingPeriodId: string;
  obligationId: string | null;
  periodEnd: string;
  daysCount: number;
  allowanceKm: number | null;
  amountMinor: Minor;
}

export interface ClosedLease {
  finalPeriod: ClosedLeaseFinalPeriod;
}

/**
 * Steps 1–3. "Stop the clock" is `lease.status → 'closing'` plus its
 * `end_date` — `generateNextBillingPeriodTx`'s own guard (`status !==
 * 'active'` throws) is what makes that the *entire* mechanism for "no
 * further dues generate," never a second check here.
 *
 * "Decide the final period" adjusts the *obligation* the covering billing
 * period already raised (`applyAdjustmentTx`, F-2.4's own mechanism) — the
 * billing period's own `rent_amount_minor` is never touched (W-25: fixed,
 * regardless of days). `allowance_km` and the generated `days_count` are
 * shortened to the days actually covered when the closure lands before the
 * period's natural end, so mileage measured against a truncated period
 * cannot draw on days that were never used.
 *
 * "Final mileage" is a *second*, separately-transactional call into the
 * existing `assessMileage` (F-2.3's own engine, unchanged) rather than
 * composed into the transaction above — `assessMileage` is already
 * idempotent and fully atomic on its own, so a failure between the two
 * writes leaves the lease correctly in `closing` with its final-period
 * charge already decided, recoverable by re-submitting the closing reading
 * alone. Composing it into one transaction would mean duplicating
 * `assessMileage`'s own tx-core for no correctness gain.
 */
export async function closeLease(writer: Writer, input: CloseLeaseInput): Promise<ClosedLease> {
  const finalPeriod = await writer.transaction(async (tx) => {
    const l = await findLeaseForBusiness(tx, input.businessId, input.leaseId);
    if (!l) throw new NotFoundError("No such lease in this business");
    if (l.status !== "active") {
      throw new ValidationError("Only an active lease can be closed");
    }

    const period = await findBillingPeriodCoveringDate(tx, input.leaseId, input.closingDate);
    if (!period) {
      throw new ValidationError(
        "No billing period covers this closing date yet — generate it first",
      );
    }

    const originalDaysCount = period.daysCount;
    const daysUsed = inclusiveDays(period.periodStart as BusinessDate, input.closingDate);
    const isEarlyClosure = input.closingDate < period.periodEnd;
    const newDaysCount = isEarlyClosure ? daysUsed : originalDaysCount;
    const newAllowanceKm =
      l.mileageDailyLimitKm !== null ? l.mileageDailyLimitKm * newDaysCount : undefined;

    if (isEarlyClosure) {
      await truncateBillingPeriodForClosure(tx, period.id, input.closingDate, newAllowanceKm);
    }

    const obligationRow = await findObligationBySource(tx, "billing_period", period.id);
    let finalAmountMinor = period.rentAmountMinor as Minor;

    if (obligationRow) {
      finalAmountMinor = obligationRow.amountMinor as Minor;

      if (input.finalPeriodMode === "days_used" && daysUsed < originalDaysCount) {
        const [proratedRentMinor] = split(period.rentAmountMinor as Minor, [
          BigInt(daysUsed),
          BigInt(originalDaysCount - daysUsed),
        ]);
        const reduceBy = period.rentAmountMinor - (proratedRentMinor as bigint);
        if (reduceBy > 0n) {
          const applied = await applyAdjustmentTx(tx, {
            businessId: input.businessId,
            obligationId: obligationRow.id,
            adjustmentType: "goodwill",
            amountMinor: reduceBy as Minor,
            sign: -1,
            reason: input.note ?? "Charged for the days actually used (F-2.6 closure)",
            occurredOn: input.closingDate,
            userId: input.userId,
          });
          finalAmountMinor = applied.obligation.amountMinor as Minor;
        }
      } else if (input.finalPeriodMode === "agreed") {
        if (input.agreedAmountMinor === undefined) {
          throw new ValidationError("agreedAmountMinor is required for the 'agreed' mode");
        }
        const diff = input.agreedAmountMinor - obligationRow.amountMinor;
        if (diff !== 0n) {
          const applied = await applyAdjustmentTx(tx, {
            businessId: input.businessId,
            obligationId: obligationRow.id,
            adjustmentType: diff < 0n ? "agreed_discount" : "extra_charge",
            amountMinor: (diff < 0n ? -diff : diff) as Minor,
            sign: diff < 0n ? -1 : 1,
            reason: input.note ?? "An agreed final-period figure (F-2.6 closure)",
            occurredOn: input.closingDate,
            userId: input.userId,
          });
          finalAmountMinor = applied.obligation.amountMinor as Minor;
        }
      }
      // "full" mode: the obligation stays exactly as originally raised.
    }

    await updateLeaseStatus(tx, input.leaseId, "closing", input.closingDate);

    return {
      billingPeriodId: period.id,
      obligationId: obligationRow?.id ?? null,
      periodEnd: isEarlyClosure ? input.closingDate : period.periodEnd,
      daysCount: newDaysCount,
      allowanceKm: newAllowanceKm ?? null,
      amountMinor: finalAmountMinor,
    };
  });

  if (input.closingOdometerKm !== undefined) {
    await assessMileage(writer, {
      businessId: input.businessId,
      leaseId: input.leaseId,
      readingKm: input.closingOdometerKm,
      readOn: input.closingDate,
      source: input.odometerSource ?? "at_return",
      userId: input.userId,
    });
  }

  return { finalPeriod };
}

export interface LeaseClosureSummary {
  unpaidObligations: OutstandingObligation[];
  totalUnpaidMinor: Minor;
  openIncidents: { id: string; occurredOn: string; status: string }[];
}

/**
 * Step 4/INV-18: "show everything outstanding before releasing anything."
 * Every one of "unpaid dues from earlier billing periods," "this billing
 * period's amount" and "excess mileage" is the same thing from the data's
 * own point of view — an `owed_to_us` obligation against this customer that
 * is not yet settled — so this is one list, oldest-due first, rather than
 * three separately assembled ones. INV-18 itself is enforced by this
 * endpoint simply existing to be called (and being called) before
 * `settleLeaseDeposit`, not by a stored flag — the same "it does not block,
 * it refuses to let you do it blind" reading UC-16 gives it.
 */
export async function getLeaseClosureSummary(
  reader: Reader,
  businessId: string,
  leaseId: string,
): Promise<LeaseClosureSummary> {
  const l = await findLeaseForBusiness(reader, businessId, leaseId);
  if (!l) throw new NotFoundError("No such lease in this business");

  const unpaidObligations = await findOutstandingObligationsForParty(
    reader,
    businessId,
    "customer",
    l.customerId,
    "owed_to_us",
  );
  const totalUnpaidMinor = unpaidObligations.reduce(
    (sum, o) => sum + (o.amountMinor - o.settledMinor - o.waivedMinor),
    0n,
  ) as Minor;

  const openIncidents = await listOpenIncidentsForLease(reader, businessId, leaseId);

  return {
    unpaidObligations,
    totalUnpaidMinor,
    openIncidents: openIncidents.map((i) => ({
      id: i.id,
      occurredOn: i.occurredOn,
      status: i.status,
    })),
  };
}

export interface SettleLeaseDepositInput {
  businessId: string;
  leaseId: string;
  action: "refund" | "retain" | "hold" | "apply";
  /** Required for "retain" — a portion, never assumed to be everything held. */
  amountMinor?: Minor;
  /** Required for "retain" (a reason for keeping someone's money, W-26). */
  reason?: string;
  occurredOn: BusinessDate;
  userId: string;
}

export interface SettledLeaseDeposit {
  depositId: string;
  status: DepositRow["status"];
  heldMinor: Minor;
  holdReleaseDate: string | null;
}

/**
 * Step 6/W-29/W-44: refund in full, retain a portion, apply against what is
 * owed, or hold for the configured window.
 *
 * GAP-6: "apply" sweeps the deposit's held balance against the customer's
 * own outstanding `owed_to_us` obligations, oldest-`due_on`-first (§6.5,
 * the same discipline `getLeaseClosureSummary`'s own INV-18 list already
 * reads), one `recordDepositMovementTx` call per obligation touched — each
 * `deposit_movement` row names exactly one `obligation_id`, so settling N
 * obligations from one deposit is N rows, not one. Deliberately not
 * `recordPayment`'s `allocateAgainstOldest`: that mints a `payment` row for
 * cash arriving now, and this is money already held — reusing it verbatim
 * would manufacture a payment for money that never moved. Any balance left
 * once every outstanding obligation is cleared stays held, available for a
 * follow-up "refund" call; `recordDepositMovementTx` is what actually caps
 * each application at what remains outstanding on its own obligation.
 * **The whole sweep is one transaction, obligations locked `forUpdate`**
 * (GAP-5a discipline) — N separate commits would leave a partial apply
 * behind if a later iteration threw, and an unlocked read could over-settle
 * under a concurrent write.
 *
 * Requires the lease to already be past step 1 (`status !== 'active'`) —
 * the same "stop the clock first" ordering UC-16 itself insists on, read
 * off the lease's own state rather than a second flag.
 */
export async function settleLeaseDeposit(
  writer: Writer,
  input: SettleLeaseDepositInput,
): Promise<SettledLeaseDeposit> {
  const l = await findLeaseForBusiness(writer, input.businessId, input.leaseId);
  if (!l) throw new NotFoundError("No such lease in this business");
  if (l.status === "active") {
    throw new ValidationError("Close the lease (step 1) before settling its deposit");
  }

  const dep = await findDepositForLease(writer, input.businessId, input.leaseId);
  if (!dep) throw new NotFoundError("No deposit was taken on this lease");
  if (dep.status !== "held") {
    throw new ValidationError(`This deposit is already ${dep.status}`);
  }

  if (input.action === "hold") {
    const settings = await findBusinessSettings(writer, input.businessId);
    const holdDays = settings?.depositHoldDays ?? 30;
    const holdReleaseDate = addDays(input.occurredOn, holdDays);
    await updateDepositStatus(writer, dep.id, "hold_window", holdReleaseDate);
    const heldMinor = await sumDepositMovements(writer, dep.id);
    return {
      depositId: dep.id,
      status: "hold_window",
      heldMinor: heldMinor as Minor,
      holdReleaseDate,
    };
  }

  if (input.action === "refund") {
    const heldBefore = await sumDepositMovements(writer, dep.id);
    const result = await recordDepositMovement(writer, {
      businessId: input.businessId,
      depositId: dep.id,
      movementType: "refunded",
      amountMinor: heldBefore as Minor,
      occurredOn: input.occurredOn,
      userId: input.userId,
    });
    return {
      depositId: dep.id,
      status: result.deposit.status,
      heldMinor: result.heldMinor,
      holdReleaseDate: null,
    };
  }

  if (input.action === "apply") {
    // The whole sweep is one transaction, obligations locked for its
    // duration (GAP-5a discipline) — a failure partway (period closed, a
    // concurrent write tripping the outstanding guard) must not leave some
    // obligations settled and others not. `heldBefore` is read inside the
    // transaction too — reading it via `writer` beforehand would let a
    // concurrent deposit movement make `remaining` stale by the time the
    // loop below spends it.
    const lastResult = await writer.transaction(async (tx) => {
      const heldBefore = await sumDepositMovements(tx, dep.id);
      if (heldBefore <= 0n) {
        throw new ValidationError("Nothing is held on this deposit to apply");
      }

      const unpaidObligations = await findOutstandingObligationsForParty(
        tx,
        input.businessId,
        "customer",
        l.customerId,
        "owed_to_us",
        true,
      );

      let remaining = heldBefore;
      let last: Awaited<ReturnType<typeof recordDepositMovementTx>> | undefined;
      for (const ob of unpaidObligations) {
        if (remaining <= 0n) break;
        const outstanding = ob.amountMinor - ob.settledMinor - ob.waivedMinor;
        if (outstanding <= 0n) continue;

        const take = (remaining < outstanding ? remaining : outstanding) as Minor;
        last = await recordDepositMovementTx(tx, {
          businessId: input.businessId,
          depositId: dep.id,
          movementType: "applied",
          amountMinor: take,
          occurredOn: input.occurredOn,
          obligationId: ob.id,
          userId: input.userId,
        });
        remaining -= take;
      }
      return last;
    });

    if (lastResult === undefined) {
      throw new ValidationError("Nothing is currently owed for this deposit to apply against");
    }
    return {
      depositId: dep.id,
      status: lastResult.deposit.status,
      heldMinor: lastResult.heldMinor,
      holdReleaseDate: null,
    };
  }

  // "retain"
  if (input.amountMinor === undefined) {
    throw new ValidationError("amountMinor is required to retain part of a deposit");
  }
  const result = await recordDepositMovement(writer, {
    businessId: input.businessId,
    depositId: dep.id,
    movementType: "retained",
    amountMinor: input.amountMinor,
    occurredOn: input.occurredOn,
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
    userId: input.userId,
  });
  return {
    depositId: dep.id,
    status: result.deposit.status,
    heldMinor: result.heldMinor,
    holdReleaseDate: null,
  };
}

export interface CloseOutLeaseInput {
  businessId: string;
  leaseId: string;
  userId: string;
}

/**
 * Step 7: "car marked available" — this lease's own future occupancy,
 * beyond the day it actually closed on, freed the same way F-5.5 frees a
 * cancelled trip's (`deleteAllocationDaysForTrip`). The final statement is
 * `getLeaseClosureSummary` above, read once more after settlement; the
 * closing WhatsApp message needs P14 and is not sent here.
 */
export async function closeOutLease(writer: Writer, input: CloseOutLeaseInput): Promise<void> {
  const l = await findLeaseForBusiness(writer, input.businessId, input.leaseId);
  if (!l) throw new NotFoundError("No such lease in this business");
  if (l.status !== "closing") {
    throw new ValidationError("Only a lease already stopped (step 1) can be closed out");
  }

  await writer.transaction(async (tx) => {
    await updateLeaseStatus(tx, input.leaseId, "closed");
    await deleteLeaseAllocationAfter(tx, input.leaseId, l.endDate ?? l.startDate, input.userId);
  });
}
