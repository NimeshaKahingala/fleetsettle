import { newId, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { Tx, Writer } from "../db/client.js";
import { isPeriodClosedViolation } from "../db/pg-error.js";
import { PeriodClosedError, ValidationError } from "../errors/app-error.js";
import { resolvePeriodLinkage } from "../queries/accounting-period.js";
import { insertOffsetAllocation, insertOffsetRecord } from "../queries/driver-money.js";
import {
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
      throw err;
    }

    return { offsetId };
  });
}

async function allocateAgainstOldest(
  tx: Tx,
  offsetId: string,
  businessId: string,
  driverId: string,
  direction: "owed_to_us" | "owed_by_us",
  amountMinor: Minor,
): Promise<void> {
  const obligations = await findOutstandingObligationsForDriver(
    tx,
    businessId,
    driverId,
    direction,
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
