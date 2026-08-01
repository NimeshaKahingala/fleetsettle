import { newId, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { Writer } from "../db/client.js";
import { isPeriodClosedViolation } from "../db/pg-error.js";
import { NotFoundError, PeriodClosedError, ValidationError } from "../errors/app-error.js";
import { resolvePeriodLinkage } from "../queries/accounting-period.js";
import {
  findDepositForBusiness,
  insertDeposit,
  insertDepositMovement,
  sumDepositMovements,
  updateDepositStatus,
  type DepositRow,
} from "../queries/driver-money.js";

export interface TakeDriverDepositInput {
  businessId: string;
  driverId: string;
  amountMinor: Minor;
  occurredOn: BusinessDate;
  userId: string;
}

export interface TakenDeposit {
  depositId: string;
}

/** F-6.7/UC-58/W-8, one transaction: `deposit` and its first movement — INV-4, never income, in any month. */
export async function takeDriverDeposit(
  writer: Writer,
  input: TakeDriverDepositInput,
): Promise<TakenDeposit> {
  return writer.transaction(async (tx) => {
    const linkage = await resolvePeriodLinkage(tx, input.businessId, input.occurredOn);
    if (!linkage) throw new PeriodClosedError("No accounting period covers this business date yet");

    const depositId = newId();
    try {
      await insertDeposit(tx, {
        id: depositId,
        businessId: input.businessId,
        partyDriverId: input.driverId,
      });
      await insertDepositMovement(tx, {
        id: newId(),
        businessId: input.businessId,
        depositId,
        movementType: "taken",
        amountMinor: input.amountMinor,
        occurredOn: input.occurredOn,
        postedPeriodId: linkage.postedPeriodId,
        ...(linkage.belongsToPeriodId !== null
          ? { belongsToPeriodId: linkage.belongsToPeriodId }
          : {}),
        createdBy: input.userId,
      });
    } catch (err) {
      if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
      throw err;
    }

    return { depositId };
  });
}

export interface RecordDepositMovementInput {
  businessId: string;
  depositId: string;
  movementType: "topped_up" | "reduced" | "applied" | "refunded" | "retained";
  amountMinor: Minor;
  occurredOn: BusinessDate;
  reason?: string;
  userId: string;
}

export interface RecordedDepositMovement {
  deposit: DepositRow;
  heldMinor: Minor;
}

const ADDS = new Set(["topped_up"]);
const TERMINAL: Partial<Record<RecordDepositMovementInput["movementType"], DepositRow["status"]>> =
  {
    refunded: "released",
    retained: "retained",
  };

/**
 * F-2.7/F-6.7: later movements against the same held deposit — refund in
 * full, apply against arrears (deliberate, recorded, never automatic,
 * UC-58), or top up. §6.13/INV-4: the balance is the SUM of movements
 * (DM §10.4), never a stored figure this write has to keep in sync.
 */
export async function recordDepositMovement(
  writer: Writer,
  input: RecordDepositMovementInput,
): Promise<RecordedDepositMovement> {
  return writer.transaction(async (tx) => {
    const dep = await findDepositForBusiness(tx, input.businessId, input.depositId);
    if (!dep) throw new NotFoundError("No such deposit in this business");
    if (dep.status !== "held") {
      throw new ValidationError(`This deposit is already ${dep.status}`);
    }

    const held = await sumDepositMovements(tx, input.depositId);
    const isDraw = !ADDS.has(input.movementType);
    if (isDraw && input.amountMinor > held) {
      throw new ValidationError("This movement would draw the deposit below zero");
    }

    const linkage = await resolvePeriodLinkage(tx, input.businessId, input.occurredOn);
    if (!linkage) throw new PeriodClosedError("No accounting period covers this business date yet");

    try {
      await insertDepositMovement(tx, {
        id: newId(),
        businessId: input.businessId,
        depositId: input.depositId,
        movementType: input.movementType,
        amountMinor: input.amountMinor,
        occurredOn: input.occurredOn,
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        postedPeriodId: linkage.postedPeriodId,
        ...(linkage.belongsToPeriodId !== null
          ? { belongsToPeriodId: linkage.belongsToPeriodId }
          : {}),
        createdBy: input.userId,
      });
    } catch (err) {
      if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
      throw err;
    }

    const newHeld = ADDS.has(input.movementType)
      ? held + input.amountMinor
      : held - input.amountMinor;
    const newStatus = TERMINAL[input.movementType] ?? dep.status;
    if (newStatus !== dep.status) await updateDepositStatus(tx, input.depositId, newStatus);

    return {
      deposit: { ...dep, status: newStatus },
      heldMinor: newHeld as Minor,
    };
  });
}
