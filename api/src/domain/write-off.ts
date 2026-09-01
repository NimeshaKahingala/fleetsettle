import { newId, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { Writer } from "../db/client.js";
import { isPeriodClosedViolation, isUniqueViolation } from "../db/pg-error.js";
import {
  NotFoundError,
  PeriodClosedError,
  ReplacesTargetAlreadyReplacedError,
  ReplacesTargetNotVoidedError,
  ValidationError,
  VoidBlockedError,
  WriteOffAlreadyVoidedError,
  WriteOffRecoveryAlreadyVoidedError,
  type VoidBlockingItem,
} from "../errors/app-error.js";
import { resolvePeriodLinkage } from "../queries/accounting-period.js";
import { applyWriteOffToObligation, findObligationForDepositApply } from "../queries/obligation.js";
import { insertPayment, markPaymentReversed } from "../queries/payment.js";
import { computeObligationStatus } from "./obligation-status.js";
import {
  findLiveRecoveriesForWriteOff,
  findWriteOffForBusiness,
  findWriteOffRecoveryForBusiness,
  insertWriteOff,
  insertWriteOffRecovery,
  voidWriteOffRecoveryRow,
  voidWriteOffRow,
} from "../queries/write-off.js";

export interface RecordWriteOffInput {
  businessId: string;
  obligationId?: string;
  partyType: "customer" | "driver";
  partyCustomerId?: string;
  partyDriverId?: string;
  vehicleId?: string;
  amountMinor: Minor;
  reason: string;
  writtenOffOn: BusinessDate;
  userId: string;
  replacesId?: string;
}

export interface RecordedWriteOff {
  writeOffId: string;
}

/**
 * F-8.3/UC-90/W-28, one transaction: clears the balance from receivables by
 * raising `written_off_minor` (never touching `settled_minor`/`waived_minor`,
 * which is what keeps this bucket entirely separate from a waiver, INV-14).
 * `obligationId` is optional — see the shared schema's own comment — but
 * when given it must belong to this business, still be outstanding, and
 * belong to the *same party* this write-off names (GAP-203/H-1: the handler
 * already checked all four ids exist in this business, never that they name
 * the same party — a write-off entered against the wrong customer's
 * obligation by id typo used to succeed silently).
 *
 * GAP-203/H-1/D2 (decided 30 Aug 2026): a write-off can be partial —
 * "he'll never pay the last bit" is a real business act, the same way a
 * partial waiver already is. `written_off_minor` accumulates across
 * multiple write-offs against the same obligation, mirroring `waived_minor`
 * exactly; status flips to `written_off` only once
 * `settled + waived + written_off` reaches the full amount.
 */
export async function recordWriteOff(
  writer: Writer,
  input: RecordWriteOffInput,
): Promise<RecordedWriteOff> {
  try {
    return await writer.transaction(async (tx) => {
      // GAP-178/B15: the period is resolved before anything is written, not
      // after. Atomic either way — this is all one transaction — but written
      // first, a PERIOD_CLOSED rolls back an obligation update that had
      // already fired its audit trigger, so the audit trail records a change
      // to a settled month that no row reflects. Fail before touching
      // anything, the way deposit.ts already does.
      const linkage = await resolvePeriodLinkage(tx, input.businessId, input.writtenOffOn);
      if (!linkage)
        throw new PeriodClosedError("No accounting period covers this business date yet");

      if (input.obligationId !== undefined) {
        const obligation = await findObligationForDepositApply(
          tx,
          input.businessId,
          input.obligationId,
          true,
        );
        if (!obligation || obligation.voidedAt !== null) {
          throw new NotFoundError("No such obligation in this business");
        }

        // GAP-203/H-1: the obligation named must belong to the same party
        // the write-off itself names — checked here, not just "exists in
        // this business", the same class of gap GAP-93 closed for a
        // payment's own party id.
        const sameParty =
          obligation.partyType === input.partyType &&
          (input.partyType === "customer"
            ? obligation.partyCustomerId === (input.partyCustomerId ?? null)
            : obligation.partyDriverId === (input.partyDriverId ?? null));
        if (!sameParty) {
          throw new ValidationError(
            "obligationId names an obligation against a different party than this write-off",
          );
        }

        const newWrittenOffMinor = obligation.writtenOffMinor + input.amountMinor;
        if (
          obligation.settledMinor + obligation.waivedMinor + newWrittenOffMinor >
          obligation.amountMinor
        ) {
          throw new ValidationError(
            "This write-off would exceed what remains outstanding on this obligation",
          );
        }
        const status = computeObligationStatus(
          obligation.amountMinor,
          obligation.settledMinor,
          obligation.waivedMinor,
          newWrittenOffMinor,
        );
        await applyWriteOffToObligation(tx, input.businessId, input.obligationId, {
          writtenOffMinor: newWrittenOffMinor,
          status,
        });
      }

      if (input.replacesId !== undefined) {
        const target = await findWriteOffForBusiness(tx, input.businessId, input.replacesId);
        if (!target) throw new NotFoundError("No such write-off in this business");
        if (target.voidedAt === null) throw new ReplacesTargetNotVoidedError();
        // Same class as Gitar's finding on PR #45 (adjustment/incident_recovery):
        // without this, replacesId could name a voided write-off against a
        // *different* party.
        const sameParty =
          target.partyType === input.partyType &&
          (target.partyCustomerId ?? undefined) === input.partyCustomerId &&
          (target.partyDriverId ?? undefined) === input.partyDriverId;
        if (!sameParty) {
          throw new ValidationError("replacesId names a write-off against a different party");
        }
      }

      const writeOffId = newId();
      await insertWriteOff(tx, {
        id: writeOffId,
        businessId: input.businessId,
        ...(input.obligationId !== undefined ? { obligationId: input.obligationId } : {}),
        partyType: input.partyType,
        ...(input.partyCustomerId !== undefined ? { partyCustomerId: input.partyCustomerId } : {}),
        ...(input.partyDriverId !== undefined ? { partyDriverId: input.partyDriverId } : {}),
        ...(input.vehicleId !== undefined ? { vehicleId: input.vehicleId } : {}),
        amountMinor: input.amountMinor,
        reason: input.reason,
        writtenOffOn: input.writtenOffOn,
        postedPeriodId: linkage.postedPeriodId,
        ...(linkage.belongsToPeriodId !== null
          ? { belongsToPeriodId: linkage.belongsToPeriodId }
          : {}),
        createdBy: input.userId,
        ...(input.replacesId !== undefined ? { replacesId: input.replacesId } : {}),
      });

      return { writeOffId };
    });
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    if (isUniqueViolation(err, "write_off_replaces_id_key")) {
      throw new ReplacesTargetAlreadyReplacedError();
    }
    throw err;
  }
}

export interface RecordWriteOffRecoveryInput {
  businessId: string;
  writeOffId: string;
  amountMinor: Minor;
  occurredOn: BusinessDate;
  userId: string;
  replacesId?: string;
}

export interface RecordedWriteOffRecovery {
  recoveryId: string;
  paymentId: string;
}

/**
 * INV-15, one transaction: the money is recorded as an ordinary `payment`
 * (direction='received', the write-off's own party) but deliberately never
 * allocated against any obligation — the one this recovers is already
 * `written_off` and excluded from every outstanding-obligation query
 * (§6.5's allocation discipline), so there is nothing left for a generic
 * allocator to find, and nothing else should silently absorb this money
 * instead. The `write_off_recovery` row is what marks this specific payment
 * as a recovery rather than fresh income (never `payment.amount_minor`
 * arithmetic, the same "record the fact as a field/row, not a guess"
 * convention P8's incident recoveries and P7's banking discrepancy both use).
 */
export async function recordWriteOffRecovery(
  writer: Writer,
  input: RecordWriteOffRecoveryInput,
): Promise<RecordedWriteOffRecovery> {
  try {
    return await writer.transaction(async (tx) => {
      // GAP-190/B12: locked here, inside the transaction — a recovery and a
      // void racing the same write-off must serialise on this row, the same
      // "lock the parent" shape GAP-178's deposit double-draw fix already
      // established. A plain read proves nothing about what the other side
      // of the race is about to insert or void.
      const writeOffRow = await findWriteOffForBusiness(
        tx,
        input.businessId,
        input.writeOffId,
        true,
      );
      if (!writeOffRow || writeOffRow.voidedAt !== null) {
        throw new NotFoundError("No such write-off in this business");
      }

      const linkage = await resolvePeriodLinkage(tx, input.businessId, input.occurredOn);
      if (!linkage)
        throw new PeriodClosedError("No accounting period covers this business date yet");

      if (input.replacesId !== undefined) {
        const target = await findWriteOffRecoveryForBusiness(
          tx,
          input.businessId,
          input.replacesId,
        );
        if (!target) throw new NotFoundError("No such recovery in this business");
        if (target.voidedAt === null) throw new ReplacesTargetNotVoidedError();
        // Found by Gitar's review of PR #45: without this, replacesId could
        // name a voided recovery against a *different* write-off.
        if (target.writeOffId !== input.writeOffId) {
          throw new ValidationError("replacesId names a recovery against a different write-off");
        }
      }

      const paymentId = newId();
      await insertPayment(tx, {
        id: paymentId,
        businessId: input.businessId,
        direction: "received",
        partyType: writeOffRow.partyType,
        ...(writeOffRow.partyType === "customer" && writeOffRow.partyCustomerId !== null
          ? { partyCustomerId: writeOffRow.partyCustomerId }
          : {}),
        ...(writeOffRow.partyType === "driver" && writeOffRow.partyDriverId !== null
          ? { partyDriverId: writeOffRow.partyDriverId }
          : {}),
        amountMinor: input.amountMinor,
        occurredOn: input.occurredOn,
        handledByUserId: input.userId,
        createdBy: input.userId,
        postedPeriodId: linkage.postedPeriodId,
        ...(linkage.belongsToPeriodId !== null
          ? { belongsToPeriodId: linkage.belongsToPeriodId }
          : {}),
      });

      const recoveryId = newId();
      await insertWriteOffRecovery(tx, {
        id: recoveryId,
        businessId: input.businessId,
        writeOffId: input.writeOffId,
        paymentId,
        amountMinor: input.amountMinor,
        postedPeriodId: linkage.postedPeriodId,
        ...(linkage.belongsToPeriodId !== null
          ? { belongsToPeriodId: linkage.belongsToPeriodId }
          : {}),
        ...(input.replacesId !== undefined ? { replacesId: input.replacesId } : {}),
      });

      return { recoveryId, paymentId };
    });
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    if (isUniqueViolation(err, "write_off_recovery_replaces_id_key")) {
      throw new ReplacesTargetAlreadyReplacedError();
    }
    throw err;
  }
}

export interface VoidWriteOffInput {
  businessId: string;
  writeOffId: string;
  reason: string;
  userId: string;
}

export interface VoidedWriteOff {
  id: string;
  voidedAt: string;
}

/**
 * GAP-12/W-61/INV-36 §3.7: refuses while any recovery against this write-off
 * is still live — a recovery is its own entered act (§2). Clear, this
 * restores the linked obligation's prior state: `recordWriteOff` never
 * touches `settled_minor`/`waived_minor`, only `written_off_minor` (and the
 * `status` derived from it), so subtracting this one write-off's own amount
 * back out and re-deriving status from the remaining figures (GAP-203/H-1/D2)
 * restores exactly what was true before this write-off, no stored history
 * needed — the same reasoning that held before write-offs could be partial.
 */
export async function voidWriteOff(
  writer: Writer,
  input: VoidWriteOffInput,
): Promise<VoidedWriteOff> {
  try {
    return await writer.transaction(async (tx) => {
      // GAP-190/B12: every read this write depends on now happens inside
      // the transaction, against a locked row. Read outside it (the shape
      // this used to have), a recovery recorded in the gap between the
      // check and the void is invisible to the check, and the write-off is
      // voided anyway with a live recovery still against it — exactly what
      // this guard exists to refuse.
      const wo = await findWriteOffForBusiness(tx, input.businessId, input.writeOffId, true);
      if (!wo) throw new NotFoundError("No such write-off in this business");
      if (wo.voidedAt !== null) throw new WriteOffAlreadyVoidedError();

      const live = await findLiveRecoveriesForWriteOff(tx, input.writeOffId);
      if (live.length > 0) {
        const items: VoidBlockingItem[] = live.map((r) => ({
          kind: "recovery",
          id: r.id,
          amountMinor: r.amountMinor.toString(),
        }));
        const totalMinor = live.reduce((sum, r) => sum + r.amountMinor, 0n);
        throw new VoidBlockedError(
          `Cannot void — ${live.length.toString()} recovery/recoveries totalling ` +
            `${totalMinor.toString()} are still against it. Void those first, each with its own reason`,
          items,
        );
      }

      if (wo.obligationId !== null) {
        const ob = await findObligationForDepositApply(tx, input.businessId, wo.obligationId, true);
        if (ob && ob.voidedAt === null) {
          // GAP-203/H-1/D2: this specific write-off's own amount comes back
          // out of the obligation's written_off_minor — a partial write-off
          // means the column is a running total across possibly several
          // write-offs, so restoring it means subtracting only this one's
          // share, never resetting it to zero.
          const newWrittenOffMinor = ob.writtenOffMinor - wo.amountMinor;
          const status = computeObligationStatus(
            ob.amountMinor,
            ob.settledMinor,
            ob.waivedMinor,
            newWrittenOffMinor,
          );
          await applyWriteOffToObligation(tx, input.businessId, wo.obligationId, {
            writtenOffMinor: newWrittenOffMinor,
            status,
          });
        }
      }

      const voided = await voidWriteOffRow(tx, input.writeOffId, {
        voidedReason: input.reason,
        voidedBy: input.userId,
      });
      if (!voided) throw new WriteOffAlreadyVoidedError();
      return { id: input.writeOffId, voidedAt: voided.voidedAt };
    });
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    throw err;
  }
}

export interface VoidWriteOffRecoveryInput {
  businessId: string;
  recoveryId: string;
  reason: string;
  userId: string;
}

export interface VoidedWriteOffRecovery {
  id: string;
  voidedAt: string;
}

/**
 * GAP-12/W-61/INV-36 §3.8: cascades — the `payment` `recordWriteOffRecovery`
 * minted alongside this row was never entered on its own (§2's exception),
 * so it is marked reversed in the same transaction. Left active and
 * unallocated, it would surface as spendable customer credit (DM §10.2's
 * credit query), turning a recovered bad debt into money he can apply to a
 * future due — against INV-15.
 */
export async function voidWriteOffRecovery(
  writer: Writer,
  input: VoidWriteOffRecoveryInput,
): Promise<VoidedWriteOffRecovery> {
  try {
    return await writer.transaction(async (tx) => {
      const recovery = await findWriteOffRecoveryForBusiness(
        tx,
        input.businessId,
        input.recoveryId,
      );
      if (!recovery) throw new NotFoundError("No such recovery in this business");
      if (recovery.voidedAt !== null) throw new WriteOffRecoveryAlreadyVoidedError();

      const voided = await voidWriteOffRecoveryRow(tx, input.recoveryId, {
        voidedReason: input.reason,
        voidedBy: input.userId,
      });
      if (!voided) throw new WriteOffRecoveryAlreadyVoidedError();

      await markPaymentReversed(tx, recovery.paymentId);

      return { id: input.recoveryId, voidedAt: voided.voidedAt };
    });
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    throw err;
  }
}
