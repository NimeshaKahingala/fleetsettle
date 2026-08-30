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
        const unallocated = await allocateAgainstOldest(
          tx,
          offsetId,
          input.businessId,
          input.driverId,
          direction,
          input.amountMinor,
        );
        // GAP-178/B11: the outstanding sums were read without a lock, so a
        // concurrent payment can have settled them since. Roll back rather
        // than move one of the driver's two balances by less than the other.
        if (unallocated !== 0n) {
          throw new ValidationError(
            "This offset could not be fully allocated — the driver's balances changed while it " +
              "was being recorded. Check the figures and try again",
          );
        }
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
  // "written_off" is unreachable here — an offset deduction never touches a
  // write-off — but computeObligationStatus's return type is unconditional,
  // not value-dependent, so this stays honest to it rather than narrowed by
  // a cast.
  obligationStatus: "pending" | "part_paid" | "paid" | "waived" | "written_off";
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
  await updateObligationSettled(tx, input.businessId, input.obligationId, {
    settledMinor: obligationSettledMinor,
    status: obligationStatus,
  });
  await insertOffsetAllocation(tx, {
    id: newId(),
    offsetId,
    obligationId: input.obligationId,
    amountMinor: input.amountMinor,
  });

  const unallocated = await allocateAgainstOldest(
    tx,
    offsetId,
    input.businessId,
    input.driverId,
    "owed_by_us",
    input.amountMinor,
  );
  // GAP-178/B11: same reason as `createOffset` — this deduction settles a
  // specific charge on one side and sweeps oldest-first on the other, and
  // both sides must move by the same amount or INV-3 is broken silently.
  if (unallocated !== 0n) {
    throw new ValidationError(
      "This deduction could not be fully allocated — the driver's balances changed while it " +
        "was being recorded. Check the figures and try again",
    );
  }

  return { offsetId, obligationSettledMinor, obligationStatus };
}

/**
 * GAP-178/B11: returns what it could **not** allocate, and every caller
 * asserts that is zero.
 *
 * The amount is validated against `sumOutstandingByDirectionForDriver`, which
 * takes no lock, and only then does the read below take `FOR UPDATE` — so the
 * check happens *before* the lock. A concurrent payment settling those same
 * obligations in between leaves less outstanding than was validated, the loop
 * allocates what it can, and the remainder was silently dropped on the floor.
 *
 * That is not cosmetic. INV-3/W-2: an offset is the one action allowed to
 * move both of a driver's balances, and it moves the same amount on each
 * side. A short allocation moves one side by less than the other,
 * permanently, with nothing recording that it happened — the `offset_record`
 * says 5,000 and the sum of its allocations says 3,000.
 *
 * `payment.ts`'s own copy of this function deliberately does **not** assert:
 * its remainder is `unallocatedMinor`, a documented outcome of overpaying,
 * surfaced through the handler and the wire schema.
 */
async function allocateAgainstOldest(
  tx: Tx,
  offsetId: string,
  businessId: string,
  driverId: string,
  direction: "owed_to_us" | "owed_by_us",
  amountMinor: Minor,
): Promise<Minor> {
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
    // GAP-203/H-1/D2: a written-off portion is never collectible.
    const outstanding = ob.amountMinor - ob.settledMinor - ob.waivedMinor - ob.writtenOffMinor;
    if (outstanding <= 0n) continue;

    const take = remaining < outstanding ? remaining : outstanding;
    const newSettled = ob.settledMinor + take;
    const status = computeObligationStatus(
      ob.amountMinor,
      newSettled,
      ob.waivedMinor,
      ob.writtenOffMinor,
    );

    await updateObligationSettled(tx, businessId, ob.id, { settledMinor: newSettled, status });
    await insertOffsetAllocation(tx, {
      id: newId(),
      offsetId,
      obligationId: ob.id,
      amountMinor: take,
    });

    remaining -= take;
  }

  return remaining as Minor;
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
        const ob = await findObligationForBusiness(tx, input.businessId, alloc.obligationId, true);
        if (ob && ob.voidedAt === null) {
          const newSettled = ob.settledMinor - alloc.amountMinor;
          const status = computeObligationStatus(
            ob.amountMinor,
            newSettled,
            ob.waivedMinor,
            ob.writtenOffMinor,
          );
          await updateObligationSettled(tx, input.businessId, ob.id, {
            settledMinor: newSettled,
            status,
          });
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
