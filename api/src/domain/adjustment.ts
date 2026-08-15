import { newId, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { AdjustmentType } from "@fleetsettle/shared/schemas";
import type { Tx, Writer } from "../db/client.js";
import { isPeriodClosedViolation, isUniqueViolation } from "../db/pg-error.js";
import {
  AdjustmentAlreadyVoidedError,
  NotFoundError,
  PeriodClosedError,
  ReplacesTargetAlreadyReplacedError,
  ReplacesTargetNotVoidedError,
  ValidationError,
} from "../errors/app-error.js";
import { resolvePeriodLinkage } from "../queries/accounting-period.js";
import {
  findAdjustmentForBusiness,
  insertAdjustment,
  voidAdjustmentRow,
} from "../queries/adjustment.js";
import {
  findPaymentAllocationsForObligation,
  reducePaymentAllocation,
  voidPaymentAllocation,
} from "../queries/payment.js";
import {
  applyAdjustmentToObligation,
  findObligationForBusiness,
  reverseAdjustmentOnObligation,
  type ObligationForAdjustment,
} from "../queries/obligation.js";
import { computeObligationStatus } from "./obligation-status.js";

const WAIVER_TYPES: readonly AdjustmentType[] = ["waiver", "auto_waiver"];

export interface ApplyAdjustmentInput {
  businessId: string;
  obligationId: string;
  adjustmentType: AdjustmentType;
  amountMinor: Minor;
  sign: -1 | 1;
  reason?: string;
  occurredOn: BusinessDate;
  userId: string;
  replacesId?: string;
}

export interface AppliedAdjustment {
  adjustmentId: string;
  obligation: ObligationForAdjustment;
}

/**
 * The transactional core, callable standalone (wrapped below) or composed
 * into a larger transaction — F-3.4/UC-12's 'credit_days' rent treatment
 * (domain/incident.ts) applies a discount adjustment as part of recording
 * the incident's off-road period, one transaction rather than two.
 *
 * A waiver (or `auto_waiver`) raises `waived_minor` only — the original
 * `amount_minor` stays "the 340 charged" (DM §10.3's own example), so the
 * month can show both the charge and the waiver. Every other type is a real
 * change to what is owed and adjusts `amount_minor` by `sign * amountMinor`
 * directly.
 *
 * GAP-60/D-16: `replacesId` — see `createExpense`'s own comment for the
 * shape. Only the user-facing create route ever sets it; `incident.ts`'s
 * composed call never does, since that adjustment is minted by the same
 * write, not a manager correcting an earlier one.
 */
export async function applyAdjustmentTx(
  tx: Tx,
  input: ApplyAdjustmentInput,
): Promise<AppliedAdjustment> {
  const ob = await findObligationForBusiness(tx, input.businessId, input.obligationId);
  if (!ob || ob.voidedAt !== null) throw new NotFoundError("No such obligation in this business");

  if (input.replacesId !== undefined) {
    const target = await findAdjustmentForBusiness(tx, input.businessId, input.replacesId);
    if (!target) throw new NotFoundError("No such adjustment in this business");
    if (target.voidedAt === null) throw new ReplacesTargetNotVoidedError();
    // Found by Gitar's review of PR #45: without this, replacesId could name
    // a voided adjustment against a *different* obligation, leaving F-8.6's
    // "what corrected this?" pointing at an unrelated fact.
    if (target.obligationId !== input.obligationId) {
      throw new ValidationError("replacesId names an adjustment against a different obligation");
    }
  }

  const isWaiver = WAIVER_TYPES.includes(input.adjustmentType);
  const newAmountMinor = isWaiver
    ? ob.amountMinor
    : ob.amountMinor + BigInt(input.sign) * input.amountMinor;
  const newWaivedMinor = isWaiver ? ob.waivedMinor + input.amountMinor : ob.waivedMinor;

  if (newAmountMinor < 0n) {
    throw new ValidationError("This adjustment would take the amount owed below zero");
  }
  if (ob.settledMinor + newWaivedMinor > newAmountMinor) {
    throw new ValidationError(
      "This adjustment would waive more than remains unsettled on this obligation",
    );
  }

  const status = computeObligationStatus(newAmountMinor, ob.settledMinor, newWaivedMinor);

  const linkage = await resolvePeriodLinkage(tx, input.businessId, input.occurredOn);
  if (!linkage) throw new PeriodClosedError("No accounting period covers this business date yet");

  const adjustmentId = newId();
  try {
    await insertAdjustment(tx, {
      id: adjustmentId,
      businessId: input.businessId,
      obligationId: input.obligationId,
      adjustmentType: input.adjustmentType,
      amountMinor: input.amountMinor,
      sign: input.sign,
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
      occurredOn: input.occurredOn,
      postedPeriodId: linkage.postedPeriodId,
      ...(linkage.belongsToPeriodId !== null
        ? { belongsToPeriodId: linkage.belongsToPeriodId }
        : {}),
      createdBy: input.userId,
      ...(input.replacesId !== undefined ? { replacesId: input.replacesId } : {}),
    });
    await applyAdjustmentToObligation(tx, input.obligationId, {
      amountMinor: newAmountMinor,
      waivedMinor: newWaivedMinor,
      status,
    });
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    if (isUniqueViolation(err, "adjustment_replaces_id_key")) {
      throw new ReplacesTargetAlreadyReplacedError();
    }
    throw err;
  }

  return {
    adjustmentId,
    obligation: {
      id: ob.id,
      amountMinor: newAmountMinor,
      settledMinor: ob.settledMinor,
      waivedMinor: newWaivedMinor,
      status,
      voidedAt: null,
    },
  };
}

/** F-2.4/UC-15/W-17: `adjustment` plus the obligation it touches, one transaction. */
export async function applyAdjustment(
  writer: Writer,
  input: ApplyAdjustmentInput,
): Promise<AppliedAdjustment> {
  return writer.transaction((tx) => applyAdjustmentTx(tx, input));
}

export interface VoidAdjustmentInput {
  businessId: string;
  adjustmentId: string;
  reason: string;
  userId: string;
}

export interface VoidedAdjustment {
  id: string;
  voidedAt: string;
  obligation: ObligationForAdjustment;
}

/**
 * GAP-12/W-61/INV-36 §3.1: reverses exactly what `applyAdjustmentTx` did.
 * Reversing a waiver only ever lowers `waived_minor` — always safe against
 * DM §10.1's `CHECK (settled_minor + waived_minor <= amount_minor)`.
 * Reversing every other type moves `amount_minor` back by `-sign * amount`,
 * which **can** push it below `settled_minor + waived_minor` (rent 1,000 →
 * late fee +500 → paid 1,500 → void the fee and amount falls to 1,000
 * beneath a settled of 1,500). Decided: allow it, unwinding this
 * obligation's own `payment_allocation` rows newest-first until the excess
 * fits — the excess then sits as ordinary unallocated credit (DM §10.2).
 * Refusing (undo the receipt, or record a waiver for the gap) was
 * considered and declined: the cash genuinely arrived, so both misdescribe
 * what happened.
 */
export async function voidAdjustment(
  writer: Writer,
  input: VoidAdjustmentInput,
): Promise<VoidedAdjustment> {
  try {
    return await writer.transaction(async (tx) => {
      const adj = await findAdjustmentForBusiness(tx, input.businessId, input.adjustmentId);
      if (!adj) throw new NotFoundError("No such adjustment in this business");
      if (adj.voidedAt !== null) throw new AdjustmentAlreadyVoidedError();

      const ob = await findObligationForBusiness(tx, input.businessId, adj.obligationId);
      if (!ob) throw new NotFoundError("No such obligation in this business");

      const isWaiver = WAIVER_TYPES.includes(adj.adjustmentType as AdjustmentType);
      const newAmountMinor = isWaiver
        ? ob.amountMinor
        : ob.amountMinor - BigInt(adj.sign) * adj.amountMinor;
      const newWaivedMinor = isWaiver ? ob.waivedMinor - adj.amountMinor : ob.waivedMinor;

      let newSettledMinor = ob.settledMinor;
      const excess = newSettledMinor + newWaivedMinor - newAmountMinor;
      if (excess > 0n) {
        const unwound = await unwindObligationAllocations(
          tx,
          adj.obligationId,
          excess,
          input.adjustmentId,
          input.reason,
          input.userId,
        );
        if (unwound < excess) {
          throw new ValidationError(
            "Voiding this adjustment would take the obligation below what is allocated against " +
              "it, and not all of that is a payment allocation this void can unwind (some may be " +
              "settled through an offset instead)",
          );
        }
        newSettledMinor -= unwound;
      }

      const status = computeObligationStatus(newAmountMinor, newSettledMinor, newWaivedMinor);
      await reverseAdjustmentOnObligation(tx, adj.obligationId, {
        amountMinor: newAmountMinor,
        settledMinor: newSettledMinor,
        waivedMinor: newWaivedMinor,
        status,
      });

      const voided = await voidAdjustmentRow(tx, input.adjustmentId, {
        voidedReason: input.reason,
        voidedBy: input.userId,
      });
      if (!voided) throw new AdjustmentAlreadyVoidedError();

      return {
        id: input.adjustmentId,
        voidedAt: voided.voidedAt,
        obligation: {
          id: ob.id,
          amountMinor: newAmountMinor,
          settledMinor: newSettledMinor,
          waivedMinor: newWaivedMinor,
          status,
          voidedAt: ob.voidedAt,
        },
      };
    });
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    throw err;
  }
}

/**
 * Newest-first (`findPaymentAllocationsForObligation`'s own order), same
 * shape as `payment-correction.ts`'s `unwindAllocations` — voids a live
 * allocation entirely or reduces it, whichever the remaining excess needs.
 * Returns how much it actually managed to unwind, which may be less than
 * `excessMinor` if this obligation's settlement is not fully backed by
 * live payment allocations (some of it settled through an offset instead).
 */
async function unwindObligationAllocations(
  tx: Tx,
  obligationId: string,
  excessMinor: bigint,
  adjustmentId: string,
  managerReason: string,
  userId: string,
): Promise<bigint> {
  let remaining = excessMinor;
  const allocations = await findPaymentAllocationsForObligation(tx, obligationId);

  for (const alloc of allocations) {
    if (remaining <= 0n) break;
    const take = remaining < alloc.amountMinor ? remaining : alloc.amountMinor;

    if (take === alloc.amountMinor) {
      await voidPaymentAllocation(tx, alloc.id, {
        voidedReason: `Adjustment ${adjustmentId} voided: ${managerReason}`,
        voidedBy: userId,
      });
    } else {
      await reducePaymentAllocation(tx, alloc.id, alloc.amountMinor - take);
    }
    remaining -= take;
  }

  return excessMinor - remaining;
}
