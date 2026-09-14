import { newId, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { Tx, Writer } from "../db/client.js";
import { isPeriodClosedViolation } from "../db/pg-error.js";
import {
  NotFoundError,
  PaymentAlreadyReversedError,
  PeriodClosedError,
  ValidationError,
} from "../errors/app-error.js";
import { resolvePeriodLinkage } from "../queries/accounting-period.js";
import { findObligationForBusiness, updateObligationSettled } from "../queries/obligation.js";
import {
  findPaymentAllocationsForPayment,
  findPaymentForBusiness,
  reducePaymentAllocation,
  updatePaymentAfterCorrection,
  voidPaymentAllocation,
} from "../queries/payment.js";
import { insertPaymentCorrection } from "../queries/payment-correction.js";
import { computeObligationStatus } from "./obligation-status.js";

export interface CorrectPaymentInput {
  businessId: string;
  paymentId: string;
  differenceMinor: Minor;
  bearer: "back_to_arrears" | "absorbed_loss";
  reason: string;
  correctedOn: BusinessDate;
  userId: string;
}

export interface CorrectedPayment {
  correctionId: string;
  paymentId: string;
  differenceMinor: Minor;
  bearer: "back_to_arrears" | "absorbed_loss";
  payment: { id: string; amountMinor: bigint; status: "active" | "corrected" | "reversed" };
}

/**
 * F-8.2/UC-93, one transaction. "The amount is editable rather than the
 * receipt being cancelled, only the difference moves" — `payment.status`
 * carries this table's own append-only story (DM §14), so reducing
 * `amount_minor` here is the sanctioned edit, not a violation of INV-21; the
 * inserted `payment_correction` row is the recorded reason and decision that
 * makes the change traceable, and `write_audit_log()` (migration 0002)
 * captures the before/after mechanically on top of that.
 *
 * The two `bearer` choices (W-37) diverge only in whether the obligation(s)
 * this payment settled get touched:
 * - `back_to_arrears` unwinds `differenceMinor` worth of this payment's own
 *   allocations, newest-first, putting the party back into arrears for
 *   exactly what came undone (INV-22's "restores the due, restores the
 *   arrears, restores the party balance").
 * - `absorbed_loss` touches no obligation at all — the party's due stays
 *   settled exactly as it was; the business absorbs the gap instead, visible
 *   only through this row's own `bearer` field (the same "record the
 *   decision as a field, not a new table" convention P7's banking-event
 *   discrepancy already established).
 *
 * INV-22's "and re-arms the reminder" has nothing to re-arm yet — no
 * messaging exists before P14 — recorded here rather than half-built.
 */
export async function correctPayment(
  writer: Writer,
  input: CorrectPaymentInput,
): Promise<CorrectedPayment> {
  try {
    return await writer.transaction(async (tx) => {
      const paymentRow = await findPaymentForBusiness(tx, input.businessId, input.paymentId);
      if (!paymentRow) throw new NotFoundError("No such payment in this business");
      if (paymentRow.status === "reversed") throw new PaymentAlreadyReversedError();
      if (input.differenceMinor > paymentRow.amountMinor) {
        throw new ValidationError(
          "differenceMinor cannot exceed the payment's current recorded amount",
        );
      }

      if (input.bearer === "back_to_arrears") {
        await unwindAllocations(
          tx,
          input.businessId,
          input.paymentId,
          paymentRow.amountMinor,
          input.differenceMinor,
          input.userId,
        );
      }

      // `payment.amount_minor` carries a `CHECK (> 0)` (DM §10.2) — the same
      // constraint that makes this column meaningful for a partial
      // correction forbids ever writing it down to zero for a full one.
      // `status` alone carries "nothing here counts anymore" (DM §14: this
      // table's own equivalent of every other money table's `voided_at`);
      // the stored amount stays at whatever it last was, and the wire
      // response reports the true remaining figure (0) separately.
      // GAP-178/B15: resolved before the payment is touched, not after. One
      // transaction either way, so nothing half-writes — but written first, a
      // PERIOD_CLOSED rolls back an update whose audit trigger has already
      // fired, leaving the trail describing a change to a settled month that
      // no row reflects.
      const linkage = await resolvePeriodLinkage(tx, input.businessId, input.correctedOn);
      if (!linkage)
        throw new PeriodClosedError("No accounting period covers this business date yet");

      const remainingMinor = paymentRow.amountMinor - input.differenceMinor;
      const isFullReversal = remainingMinor === 0n;
      const newStatus = isFullReversal ? "reversed" : "corrected";
      await updatePaymentAfterCorrection(tx, input.paymentId, {
        amountMinor: isFullReversal ? paymentRow.amountMinor : remainingMinor,
        status: newStatus,
      });

      const correctionId = newId();
      await insertPaymentCorrection(tx, {
        id: correctionId,
        businessId: input.businessId,
        paymentId: input.paymentId,
        differenceMinor: input.differenceMinor,
        bearer: input.bearer,
        reason: input.reason,
        correctedOn: input.correctedOn,
        postedPeriodId: linkage.postedPeriodId,
        ...(linkage.belongsToPeriodId !== null
          ? { belongsToPeriodId: linkage.belongsToPeriodId }
          : {}),
        createdBy: input.userId,
      });

      return {
        correctionId,
        paymentId: input.paymentId,
        differenceMinor: input.differenceMinor,
        bearer: input.bearer,
        payment: { id: input.paymentId, amountMinor: remainingMinor, status: newStatus },
      };
    });
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    throw err;
  }
}

/**
 * F-8.2's credit-first bullet, GAP-229: a correction draws on this payment's
 * own unallocated credit (`amount_minor − SUM(live payment_allocation)`,
 * `credit-forward.ts`'s own formula) before it reopens anything. Only the
 * excess above that credit puts the party back into arrears — the same
 * allocations array both the credit sum and the unwind order come from, so
 * this never queries the payment's children twice.
 *
 * `unallocatedMinor` is clamped at zero: an `absorbed_loss` correction never
 * touches allocations (`correctPayment` only calls this function under
 * `back_to_arrears`), so it can reduce `amount_minor` below what is already
 * allocated and leave the raw subtraction negative. Left unclamped, a later
 * `back_to_arrears` correction on the same payment would read that negative
 * figure as *more* credit to draw excess from, unwinding more allocation
 * than its own `differenceMinor` claims — a real reopened-arrears bug review
 * found (code-review, 14 Sept 2026), not merely defensive rounding.
 */
async function unwindAllocations(
  tx: Tx,
  businessId: string,
  paymentId: string,
  paymentAmountMinor: bigint,
  differenceMinor: bigint,
  userId: string,
): Promise<void> {
  const allocations = await findPaymentAllocationsForPayment(tx, paymentId);
  const allocatedMinor = allocations.reduce((sum, alloc) => sum + alloc.amountMinor, 0n);
  const unallocatedMinor =
    paymentAmountMinor > allocatedMinor ? paymentAmountMinor - allocatedMinor : 0n;
  let remaining = differenceMinor > unallocatedMinor ? differenceMinor - unallocatedMinor : 0n;

  for (const alloc of allocations) {
    if (remaining <= 0n) break;
    const take = remaining < alloc.amountMinor ? remaining : alloc.amountMinor;

    const obligationRow = await findObligationForBusiness(tx, businessId, alloc.obligationId, true);
    if (obligationRow) {
      const newSettled = obligationRow.settledMinor - take;
      const status = computeObligationStatus(
        obligationRow.amountMinor,
        newSettled,
        obligationRow.waivedMinor,
        obligationRow.writtenOffMinor,
      );
      await updateObligationSettled(tx, businessId, obligationRow.id, {
        settledMinor: newSettled,
        status,
      });
    }

    if (take === alloc.amountMinor) {
      await voidPaymentAllocation(tx, alloc.id, {
        voidedReason: "Undone during a payment correction",
        voidedBy: userId,
      });
    } else {
      await reducePaymentAllocation(tx, alloc.id, alloc.amountMinor - take);
    }
    remaining -= take;
  }
}
