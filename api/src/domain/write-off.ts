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
import { findObligationForBusiness, updateObligationSettled } from "../queries/obligation.js";
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
 * flipping the obligation straight to `written_off` (ST-7's own state,
 * already in the enum since P3) — never touching `settled_minor`/
 * `waived_minor`, which is what keeps this bucket entirely separate from a
 * waiver (INV-14). `obligationId` is optional — see the shared schema's own
 * comment — but when given it must belong to this business and still be
 * outstanding; a voided obligation has nothing left to write off.
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
        const obligation = await findObligationForBusiness(
          tx,
          input.businessId,
          input.obligationId,
          true,
        );
        if (!obligation || obligation.voidedAt !== null) {
          throw new NotFoundError("No such obligation in this business");
        }
        await updateObligationSettled(tx, input.businessId, input.obligationId, {
          settledMinor: obligation.settledMinor,
          status: "written_off",
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
      const writeOffRow = await findWriteOffForBusiness(tx, input.businessId, input.writeOffId);
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
 * restores the linked obligation's prior status exactly: `recordWriteOff`
 * never touched `settled_minor`/`waived_minor`, only flipped `status` to
 * `written_off`, so `computeObligationStatus` on the unchanged figures
 * re-derives precisely what it was before, no stored history needed.
 */
export async function voidWriteOff(
  writer: Writer,
  input: VoidWriteOffInput,
): Promise<VoidedWriteOff> {
  const wo = await findWriteOffForBusiness(writer, input.businessId, input.writeOffId);
  if (!wo) throw new NotFoundError("No such write-off in this business");
  if (wo.voidedAt !== null) throw new WriteOffAlreadyVoidedError();

  const live = await findLiveRecoveriesForWriteOff(writer, input.writeOffId);
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

  try {
    return await writer.transaction(async (tx) => {
      if (wo.obligationId !== null) {
        const ob = await findObligationForBusiness(tx, input.businessId, wo.obligationId, true);
        if (ob && ob.voidedAt === null) {
          const status = computeObligationStatus(ob.amountMinor, ob.settledMinor, ob.waivedMinor);
          await updateObligationSettled(tx, input.businessId, wo.obligationId, {
            settledMinor: ob.settledMinor,
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
