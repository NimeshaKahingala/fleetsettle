import { newId, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { Tx, Writer } from "../db/client.js";
import { isPeriodClosedViolation, isUniqueViolation } from "../db/pg-error.js";
import {
  NotFoundError,
  OffsetRecordAlreadyVoidedError,
  PeriodClosedError,
  ReplacesTargetAlreadyReplacedError,
  ReplacesTargetNotVoidedError,
  ValidationError,
} from "../errors/app-error.js";
import { resolvePeriodLinkage } from "../queries/accounting-period.js";
import {
  findLiveOffsetAllocations,
  findOffsetRecordForBusiness,
  insertOffsetAllocation,
  insertOffsetRecord,
  voidOffsetAllocationRow,
  voidOffsetRecordRow,
} from "../queries/driver-money.js";
import {
  findObligationForBusiness,
  findOutstandingObligationsForDriver,
  sumOutstandingByDirectionForDriver,
  updateObligationSettled,
} from "../queries/obligation.js";
import { computeObligationStatus } from "./obligation-status.js";

export interface CreateOffsetInput {
  businessId: string;
  driverId: string;
  amountMinor: Minor;
  occurredOn: BusinessDate;
  note?: string;
  userId: string;
  replacesId?: string;
}

export interface CreatedOffset {
  offsetId: string;
}

/**
 * F-6.4/UC-56/W-2, one transaction: `offset_record` plus its allocations on
 * *both* sides. INV-3: the net shown to a manager is only ever information —
 * this is the one explicit action allowed to move both of a driver's
 * balances, and it moves the same `amountMinor` on each side, oldest-`due_on`
 * -first (§6.5's allocation discipline), so a partial offset always clears
 * the longest-standing dues first on either side.
 */
export async function createOffset(
  writer: Writer,
  input: CreateOffsetInput,
): Promise<CreatedOffset> {
  return writer.transaction(async (tx) => {
    const outstanding = await sumOutstandingByDirectionForDriver(
      tx,
      input.businessId,
      input.driverId,
    );
    if (input.amountMinor > outstanding.owedToUsMinor) {
      throw new ValidationError("This offset exceeds what the driver currently owes");
    }
    if (input.amountMinor > outstanding.owedByUsMinor) {
      throw new ValidationError("This offset exceeds what the business currently owes the driver");
    }

    const linkage = await resolvePeriodLinkage(tx, input.businessId, input.occurredOn);
    if (!linkage) throw new PeriodClosedError("No accounting period covers this business date yet");

    if (input.replacesId !== undefined) {
      const target = await findOffsetRecordForBusiness(tx, input.businessId, input.replacesId);
      if (!target) throw new NotFoundError("No such offset in this business");
      if (target.voidedAt === null) throw new ReplacesTargetNotVoidedError();
      // Found by Gitar's review of PR #45: without this, replacesId could
      // name a voided offset against a *different* driver.
      if (target.driverId !== input.driverId) {
        throw new ValidationError("replacesId names an offset against a different driver");
      }
    }

    const offsetId = newId();
    try {
      await insertOffsetRecord(tx, {
        id: offsetId,
        businessId: input.businessId,
        driverId: input.driverId,
        amountMinor: input.amountMinor,
        occurredOn: input.occurredOn,
        ...(input.note !== undefined ? { note: input.note } : {}),
        postedPeriodId: linkage.postedPeriodId,
        ...(linkage.belongsToPeriodId !== null
          ? { belongsToPeriodId: linkage.belongsToPeriodId }
          : {}),
        createdBy: input.userId,
        ...(input.replacesId !== undefined ? { replacesId: input.replacesId } : {}),
      });

      for (const direction of ["owed_to_us", "owed_by_us"] as const) {
        await allocateAgainstOldest(
          tx,
          offsetId,
          input.businessId,
          input.driverId,
          direction,
          input.amountMinor,
        );
      }
    } catch (err) {
      if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
      if (isUniqueViolation(err, "offset_record_replaces_id_key")) {
        throw new ReplacesTargetAlreadyReplacedError();
      }
      throw err;
    }

    return { offsetId };
  });
}

export interface DeductFromDriverFeeInput {
  businessId: string;
  driverId: string;
  /** The specific `owed_to_us` obligation this deduction settles — unlike `createOffset`, never an oldest-first sweep on this side, since the whole point is settling *this* charge, not whichever due happens to be oldest. */
  obligationId: string;
  obligationAmountMinor: bigint;
  obligationSettledMinor: bigint;
  obligationWaivedMinor: bigint;
  amountMinor: Minor;
  occurredOn: BusinessDate;
  note?: string;
  userId: string;
}

export interface DeductedFromDriverFee {
  offsetId: string;
  obligationSettledMinor: bigint;
  obligationStatus: "pending" | "part_paid" | "paid" | "waived";
}

/**
 * GAP-15/§6.7: arrangement C's "one tap to deduct from his fee" — an
 * `offset_record` whose owed_to_us side is *this one* obligation (a
 * targeted settle, not `createOffset`'s oldest-first sweep — the manager
 * chose which charge to deduct, so an unrelated older due must not be the
 * one that ends up cleared) and whose owed_by_us side sweeps oldest-first
 * exactly as an ordinary offset does. `Tx`-only, not `Writer`-wrapped: this
 * is always composed into `recordPostClosureCharge`'s own transaction,
 * immediately after the obligation it settles is created, never called on
 * its own.
 */
export async function deductFromDriverFeeTx(
  tx: Tx,
  input: DeductFromDriverFeeInput,
): Promise<DeductedFromDriverFee> {
  const outstanding = await sumOutstandingByDirectionForDriver(
    tx,
    input.businessId,
    input.driverId,
  );
  if (input.amountMinor > outstanding.owedByUsMinor) {
    throw new ValidationError("This deduction exceeds what the business currently owes the driver");
  }

  const linkage = await resolvePeriodLinkage(tx, input.businessId, input.occurredOn);
  if (!linkage) throw new PeriodClosedError("No accounting period covers this business date yet");

  const offsetId = newId();
  await insertOffsetRecord(tx, {
    id: offsetId,
    businessId: input.businessId,
    driverId: input.driverId,
    amountMinor: input.amountMinor,
    occurredOn: input.occurredOn,
    ...(input.note !== undefined ? { note: input.note } : {}),
    postedPeriodId: linkage.postedPeriodId,
    ...(linkage.belongsToPeriodId !== null ? { belongsToPeriodId: linkage.belongsToPeriodId } : {}),
    createdBy: input.userId,
  });

  const obligationSettledMinor = input.obligationSettledMinor + input.amountMinor;
  const obligationStatus = computeObligationStatus(
    input.obligationAmountMinor,
    obligationSettledMinor,
    input.obligationWaivedMinor,
  );
  await updateObligationSettled(tx, input.obligationId, {
    settledMinor: obligationSettledMinor,
    status: obligationStatus,
  });
  await insertOffsetAllocation(tx, {
    id: newId(),
    offsetId,
    obligationId: input.obligationId,
    amountMinor: input.amountMinor,
  });

  await allocateAgainstOldest(
    tx,
    offsetId,
    input.businessId,
    input.driverId,
    "owed_by_us",
    input.amountMinor,
  );

  return { offsetId, obligationSettledMinor, obligationStatus };
}

async function allocateAgainstOldest(
  tx: Tx,
  offsetId: string,
  businessId: string,
  driverId: string,
  direction: "owed_to_us" | "owed_by_us",
  amountMinor: Minor,
): Promise<void> {
  // GAP-5a: same lock, same reason as payment.ts's own allocateAgainstOldest
  // — an offset settles obligations too, and races the identical way.
  const obligations = await findOutstandingObligationsForDriver(
    tx,
    businessId,
    driverId,
    direction,
    true,
  );

  let remaining: bigint = amountMinor;
  for (const ob of obligations) {
    if (remaining <= 0n) break;
    const outstanding = ob.amountMinor - ob.settledMinor - ob.waivedMinor;
    if (outstanding <= 0n) continue;

    const take = remaining < outstanding ? remaining : outstanding;
    const newSettled = ob.settledMinor + take;
    const status = computeObligationStatus(ob.amountMinor, newSettled, ob.waivedMinor);

    await updateObligationSettled(tx, ob.id, { settledMinor: newSettled, status });
    await insertOffsetAllocation(tx, {
      id: newId(),
      offsetId,
      obligationId: ob.id,
      amountMinor: take,
    });

    remaining -= take;
  }
}

export interface VoidOffsetInput {
  businessId: string;
  offsetId: string;
  reason: string;
  userId: string;
}

export interface VoidedOffset {
  id: string;
  voidedAt: string;
}

/**
 * GAP-12/W-61/INV-36 §3.2: unwinds both sides symmetrically — INV-3's own
 * rule, never one balance without the other. Migration 0024 gave
 * `offset_allocation` the void trio it never had; for each live allocation
 * this offset made, the obligation it touched has `settled_minor` reversed
 * and its status recomputed before the allocation itself is voided, then
 * the `offset_record` goes last.
 */
export async function voidOffset(writer: Writer, input: VoidOffsetInput): Promise<VoidedOffset> {
  try {
    return await writer.transaction(async (tx) => {
      const off = await findOffsetRecordForBusiness(tx, input.businessId, input.offsetId);
      if (!off) throw new NotFoundError("No such offset in this business");
      if (off.voidedAt !== null) throw new OffsetRecordAlreadyVoidedError();

      const allocations = await findLiveOffsetAllocations(tx, input.offsetId);
      for (const alloc of allocations) {
        const ob = await findObligationForBusiness(tx, input.businessId, alloc.obligationId);
        if (ob && ob.voidedAt === null) {
          const newSettled = ob.settledMinor - alloc.amountMinor;
          const status = computeObligationStatus(ob.amountMinor, newSettled, ob.waivedMinor);
          await updateObligationSettled(tx, ob.id, { settledMinor: newSettled, status });
        }
        await voidOffsetAllocationRow(tx, alloc.id, {
          voidedReason: `Offset voided: ${input.reason}`,
          voidedBy: input.userId,
        });
      }

      const voided = await voidOffsetRecordRow(tx, input.offsetId, {
        voidedReason: input.reason,
        voidedBy: input.userId,
      });
      if (!voided) throw new OffsetRecordAlreadyVoidedError();

      return { id: input.offsetId, voidedAt: voided.voidedAt };
    });
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    throw err;
  }
}
