import { newId, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { Tx, Writer } from "../db/client.js";
import { isPeriodClosedViolation } from "../db/pg-error.js";
import {
  DepositMovementAlreadyVoidedError,
  NotFoundError,
  PeriodClosedError,
  ValidationError,
} from "../errors/app-error.js";
import { resolvePeriodLinkage } from "../queries/accounting-period.js";
import {
  findDepositForBusiness,
  findDepositMovementForBusiness,
  findNewestLiveTerminalMovement,
  insertDeposit,
  insertDepositMovement,
  sumDepositMovements,
  updateDepositStatus,
  voidDepositMovementRow,
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
  movementId: string;
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
    const movementId = newId();
    try {
      await insertDeposit(tx, {
        id: depositId,
        businessId: input.businessId,
        partyType: "driver",
        partyDriverId: input.driverId,
      });
      await insertDepositMovement(tx, {
        id: movementId,
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

    return { depositId, movementId };
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
  movementId: string;
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

    const movementId = newId();
    try {
      await insertDepositMovement(tx, {
        id: movementId,
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
      movementId,
      deposit: { ...dep, status: newStatus },
      heldMinor: newHeld as Minor,
    };
  });
}

export interface VoidDepositMovementInput {
  businessId: string;
  movementId: string;
  reason: string;
  userId: string;
}

export interface VoidedDepositMovement {
  id: string;
  voidedAt: string;
  deposit: DepositRow;
  heldMinor: Minor;
}

/**
 * GAP-12/W-61/INV-36 §3.3/§3.4: void the movement, then recompute
 * `deposit.status` from what's left live — the newest surviving terminal
 * (`refunded`/`retained`) movement wins; with none left, `hold_window` if
 * `hold_release_date` is set (F-2.7/W-29 sets that outside the movement
 * history) else `held`. Fully derivable, no new stored state — and this
 * runs on every void regardless of which movement was voided, since
 * re-deriving is always correct (a non-terminal movement's void changes
 * nothing about it; the newest live terminal one, if unaffected, wins
 * again unchanged).
 */
export async function voidDepositMovement(
  writer: Writer,
  input: VoidDepositMovementInput,
): Promise<VoidedDepositMovement> {
  try {
    return await writer.transaction(async (tx) => {
      const movement = await findDepositMovementForBusiness(tx, input.businessId, input.movementId);
      if (!movement) throw new NotFoundError("No such deposit movement in this business");
      if (movement.voidedAt !== null) throw new DepositMovementAlreadyVoidedError();

      const dep = await findDepositForBusiness(tx, input.businessId, movement.depositId);
      if (!dep) throw new NotFoundError("No such deposit in this business");

      const voided = await voidDepositMovementRow(tx, input.movementId, {
        voidedReason: input.reason,
        voidedBy: input.userId,
      });
      if (!voided) throw new DepositMovementAlreadyVoidedError();

      const newestTerminal = await findNewestLiveTerminalMovement(tx, movement.depositId);
      const newStatus = newestTerminal
        ? // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- TERMINAL is total over the two members findNewestLiveTerminalMovement can return
          TERMINAL[newestTerminal.movementType]!
        : dep.holdReleaseDate !== null
          ? "hold_window"
          : "held";
      if (newStatus !== dep.status) {
        await updateDepositStatus(tx, movement.depositId, newStatus);
      }

      const heldMinor = await sumDepositMovements(tx, movement.depositId);

      return {
        id: input.movementId,
        voidedAt: voided.voidedAt,
        deposit: { ...dep, status: newStatus },
        heldMinor: heldMinor as Minor,
      };
    });
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    throw err;
  }
}

export interface TakeCustomerDepositInput {
  businessId: string;
  leaseId: string;
  customerId: string;
  amountMinor: Minor;
  occurredOn: BusinessDate;
  userId: string;
}

/**
 * F-2.1/UC-16: the lease-side counterpart to `takeDriverDeposit` above — a
 * `deposit` row plus its first `taken` movement, INV-4 never income. Split
 * into a `tx`-taking core and a `writer`-wrapping caller (the same shape
 * `generateNextBillingPeriodTx`/`generateNextBillingPeriod` already uses) so
 * `startLease` can take the handover deposit inside its own single
 * transaction rather than opening a second one.
 */
export async function takeCustomerDepositTx(
  tx: Tx,
  input: TakeCustomerDepositInput,
): Promise<TakenDeposit> {
  const linkage = await resolvePeriodLinkage(tx, input.businessId, input.occurredOn);
  if (!linkage) throw new PeriodClosedError("No accounting period covers this business date yet");

  const depositId = newId();
  const movementId = newId();
  try {
    await insertDeposit(tx, {
      id: depositId,
      businessId: input.businessId,
      partyType: "customer",
      partyCustomerId: input.customerId,
      leaseId: input.leaseId,
    });
    await insertDepositMovement(tx, {
      id: movementId,
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

  return { depositId, movementId };
}

export async function takeCustomerDeposit(
  writer: Writer,
  input: TakeCustomerDepositInput,
): Promise<TakenDeposit> {
  return writer.transaction((tx) => takeCustomerDepositTx(tx, input));
}
