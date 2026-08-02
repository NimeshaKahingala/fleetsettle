import { newId, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { Writer } from "../db/client.js";
import { isPeriodClosedViolation } from "../db/pg-error.js";
import { NotFoundError, PeriodClosedError } from "../errors/app-error.js";
import { resolvePeriodLinkage } from "../queries/accounting-period.js";
import { findObligationForBusiness, updateObligationSettled } from "../queries/obligation.js";
import { insertPayment } from "../queries/payment.js";
import {
  findWriteOffForBusiness,
  insertWriteOff,
  insertWriteOffRecovery,
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
      if (input.obligationId !== undefined) {
        const obligation = await findObligationForBusiness(
          tx,
          input.businessId,
          input.obligationId,
        );
        if (!obligation || obligation.voidedAt !== null) {
          throw new NotFoundError("No such obligation in this business");
        }
        await updateObligationSettled(tx, input.obligationId, {
          settledMinor: obligation.settledMinor,
          status: "written_off",
        });
      }

      const linkage = await resolvePeriodLinkage(tx, input.businessId, input.writtenOffOn);
      if (!linkage)
        throw new PeriodClosedError("No accounting period covers this business date yet");

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
      });

      return { writeOffId };
    });
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    throw err;
  }
}

export interface RecordWriteOffRecoveryInput {
  businessId: string;
  writeOffId: string;
  amountMinor: Minor;
  occurredOn: BusinessDate;
  userId: string;
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
      });

      return { recoveryId, paymentId };
    });
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    throw err;
  }
}
