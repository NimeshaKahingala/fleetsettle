import { newId, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { Tx, Writer } from "../db/client.js";
import { isPeriodClosedViolation, isUniqueViolation } from "../db/pg-error.js";
import {
  DepositMovementAlreadyVoidedError,
  DriverAlreadyHoldingDepositError,
  NotFoundError,
  PeriodClosedError,
  ReplacesTargetAlreadyReplacedError,
  ReplacesTargetNotVoidedError,
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
import {
  findObligationForDepositApply,
  findOutstandingObligationsForParty,
  updateObligationSettled,
} from "../queries/obligation.js";
import { computeObligationStatus } from "./obligation-status.js";

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
      // M-10, 31 Aug 2026: migration 0038's own partial unique index —
      // idempotency lives in the constraint, this only gives the violation
      // a friendly name (CLAUDE.md → Writes).
      if (isUniqueViolation(err, "deposit_one_held_per_driver")) {
        throw new DriverAlreadyHoldingDepositError();
      }
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
  replacesId?: string;
  /** GAP-6/F-2.7: which obligation this `applied` movement settles — required exactly when `movementType` is `'applied'`, refused otherwise. */
  obligationId?: string;
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
 *
 * GAP-6/F-2.7: `movementType: 'applied'` requires `obligationId` — the
 * column `deposit_movement.obligation_id` has carried since `0001` ("when
 * applied against what is owed") with nothing ever reading or writing it.
 * Deliberately **not** `recordPayment`'s `allocateAgainstOldest`: this is
 * money already held, not money arriving now, so applying it must never
 * mint a `payment` row — it moves `obligation.settled_minor` directly, in
 * the same transaction as the movement, the same "settle from money held
 * elsewhere" shape `credit-forward.ts` already uses for a payment surplus.
 * The named obligation must belong to this business, must not be voided,
 * must be `owed_to_us` (a deposit can only offset what its own party owes
 * *us*, never the reverse), must belong to the *same party* as the deposit,
 * and the application must not exceed what remains outstanding on it —
 * over-applying would manufacture settled money nobody actually owed.
 */
/**
 * The transactional core of `recordDepositMovement`, taking an already-open
 * `tx` rather than opening its own — so a caller settling several movements
 * in one sweep (`lease-closure.ts`'s `settleLeaseDeposit` "apply" action)
 * can compose them into a single all-or-nothing transaction instead of one
 * commit per movement.
 *
 * GAP-230: `allowedStatuses` defaults to `["held"]`, the only status the
 * public `/movement` endpoint may ever write against — never part of
 * `RecordDepositMovementInput` itself, since it is not a caller's choice to
 * make on the wire. `releaseHeldDeposit` below is the one caller that passes
 * `["hold_window"]` instead: the same insert/obligation/period logic, aimed
 * at the one other status a deposit is ever settled from.
 */
export async function recordDepositMovementTx(
  tx: Tx,
  input: RecordDepositMovementInput,
  allowedStatuses: DepositRow["status"][] = ["held"],
): Promise<RecordedDepositMovement> {
  // GAP-178/B10: the parent row is locked before the held balance is summed.
  // Without it, two concurrent draws both read the same `held`, both pass the
  // check below, and both insert — a deposit of 20,000 pays out 30,000 and
  // the sum of its movements exceeds it permanently, with every individual
  // row valid.
  //
  // The lock must be on the parent, not on `deposit_movement`: under READ
  // COMMITTED a row lock on the existing movements does not block a
  // concurrent INSERT of a new one, so summing them proves nothing about what
  // another transaction is about to add.
  const dep = await findDepositForBusiness(tx, input.businessId, input.depositId, true);
  if (!dep) throw new NotFoundError("No such deposit in this business");
  if (!allowedStatuses.includes(dep.status)) {
    throw new ValidationError(`This deposit is already ${dep.status}`);
  }

  const held = await sumDepositMovements(tx, input.depositId);
  const isDraw = !ADDS.has(input.movementType);
  if (isDraw && input.amountMinor > held) {
    throw new ValidationError("This movement would draw the deposit below zero");
  }

  if (input.movementType === "applied" && input.obligationId === undefined) {
    throw new ValidationError("obligationId is required when movementType is 'applied'");
  }
  if (input.movementType !== "applied" && input.obligationId !== undefined) {
    throw new ValidationError("obligationId is only valid when movementType is 'applied'");
  }

  let obligationSettlement: { id: string; settledMinor: bigint; status: string } | undefined;
  if (input.obligationId !== undefined) {
    const ob = await findObligationForDepositApply(tx, input.businessId, input.obligationId, true);
    if (!ob) throw new NotFoundError("No such obligation in this business");
    if (ob.voidedAt !== null) throw new ValidationError("This obligation has been voided");
    if (ob.direction !== "owed_to_us") {
      throw new ValidationError("A deposit can only be applied against money owed to the business");
    }
    const sameParty =
      dep.partyType === ob.partyType &&
      (dep.partyType === "customer"
        ? dep.partyCustomerId === ob.partyCustomerId
        : dep.partyDriverId === ob.partyDriverId);
    if (!sameParty) {
      throw new ValidationError("This obligation belongs to a different party than the deposit");
    }
    // GAP-203/H-1/D2: a written-off portion is never collectible, so it is
    // never "outstanding" for a deposit to apply against.
    const outstanding = ob.amountMinor - ob.settledMinor - ob.waivedMinor - ob.writtenOffMinor;
    if (input.amountMinor > outstanding) {
      throw new ValidationError("This application exceeds what is outstanding on this obligation");
    }
    const settledMinor = ob.settledMinor + input.amountMinor;
    const status = computeObligationStatus(
      ob.amountMinor,
      settledMinor,
      ob.waivedMinor,
      ob.writtenOffMinor,
    );
    obligationSettlement = { id: input.obligationId, settledMinor, status };
  }

  const linkage = await resolvePeriodLinkage(tx, input.businessId, input.occurredOn);
  if (!linkage) throw new PeriodClosedError("No accounting period covers this business date yet");

  if (input.replacesId !== undefined) {
    const target = await findDepositMovementForBusiness(tx, input.businessId, input.replacesId);
    if (!target) throw new NotFoundError("No such deposit movement in this business");
    if (target.voidedAt === null) throw new ReplacesTargetNotVoidedError();
    // Found by Gitar's review of PR #45: without this, replacesId could
    // name a voided movement against a *different* deposit.
    if (target.depositId !== input.depositId) {
      throw new ValidationError("replacesId names a movement against a different deposit");
    }
  }

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
      ...(input.obligationId !== undefined ? { obligationId: input.obligationId } : {}),
      postedPeriodId: linkage.postedPeriodId,
      ...(linkage.belongsToPeriodId !== null
        ? { belongsToPeriodId: linkage.belongsToPeriodId }
        : {}),
      createdBy: input.userId,
      ...(input.replacesId !== undefined ? { replacesId: input.replacesId } : {}),
    });
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    if (isUniqueViolation(err, "deposit_movement_replaces_id_key")) {
      throw new ReplacesTargetAlreadyReplacedError();
    }
    throw err;
  }

  if (obligationSettlement !== undefined) {
    await updateObligationSettled(tx, input.businessId, obligationSettlement.id, {
      settledMinor: obligationSettlement.settledMinor,
      status: obligationSettlement.status,
    });
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
}

export async function recordDepositMovement(
  writer: Writer,
  input: RecordDepositMovementInput,
  allowedStatuses: DepositRow["status"][] = ["held"],
): Promise<RecordedDepositMovement> {
  return writer.transaction((tx) => recordDepositMovementTx(tx, input, allowedStatuses));
}

export interface VoidDepositMovementInput {
  businessId: string;
  depositId: string;
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
 *
 * GAP-6 follow-up: an `applied` movement also settled an obligation
 * directly (`recordDepositMovementTx`'s own `obligationSettlement`, never
 * a `payment` row) — voiding it must undo that too, or the held balance
 * comes back *and* the obligation still reads settled, the same double
 * count `voidOffset`/`voidWriteOff` already guard against for their own
 * obligation touches. Obligation locked FOR UPDATE before the movement
 * itself is voided, same lock order `recordDepositMovementTx` takes.
 */
export async function voidDepositMovement(
  writer: Writer,
  input: VoidDepositMovementInput,
): Promise<VoidedDepositMovement> {
  try {
    return await writer.transaction(async (tx) => {
      const movement = await findDepositMovementForBusiness(tx, input.businessId, input.movementId);
      if (!movement) throw new NotFoundError("No such deposit movement in this business");

      // NL-5: the URL's own parent segment (`/{id}/movement/{movementId}/void`)
      // is otherwise decorative — `findDepositMovementForBusiness` only
      // scopes by business, so a movement belonging to a different deposit
      // would still be voided if this check were skipped. Before the
      // already-voided branch, so a parent mismatch always looks like
      // absence rather than leaking the row's existence and state as a 409.
      if (movement.depositId !== input.depositId) {
        throw new NotFoundError("No such deposit movement in this business");
      }
      if (movement.voidedAt !== null) throw new DepositMovementAlreadyVoidedError();

      // GAP-178/B10: same parent lock, same order as `recordDepositMovementTx`
      // — voiding a movement changes the held balance a concurrent draw is
      // checking against, so the two must serialize on the same row.
      const dep = await findDepositForBusiness(tx, input.businessId, movement.depositId, true);
      if (!dep) throw new NotFoundError("No such deposit in this business");

      if (movement.obligationId !== null) {
        const ob = await findObligationForDepositApply(
          tx,
          input.businessId,
          movement.obligationId,
          true,
        );
        if (ob && ob.voidedAt === null) {
          const settledMinor = ob.settledMinor - movement.amountMinor;
          const status = computeObligationStatus(
            ob.amountMinor,
            settledMinor,
            ob.waivedMinor,
            ob.writtenOffMinor,
          );
          await updateObligationSettled(tx, input.businessId, ob.id, { settledMinor, status });
        }
      }

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

export interface ReleaseHeldDepositInput {
  businessId: string;
  depositId: string;
  action: "refund" | "retain" | "apply";
  /** Required for "retain" — a portion, never assumed to be everything held. */
  amountMinor?: Minor;
  /** Required for "retain" (a reason for keeping someone's money, W-26). Owner, 13 Sept 2026: a reason is enough — this never needs a linked charge. */
  reason?: string;
  occurredOn: BusinessDate;
  userId: string;
}

export interface ReleasedDeposit {
  depositId: string;
  status: DepositRow["status"];
  heldMinor: Minor;
}

/**
 * GAP-230/F-2.7: `settleLeaseDeposit`'s own three disposal actions —
 * refund in full, retain a portion (a reason, never a linked charge — the
 * owner's own answer, 13 Sept 2026), or apply against what is owed — aimed
 * at the one other status a deposit is ever settled from. F-2.6 step 6
 * already puts a deposit into `hold_window` on purpose (a manager choosing
 * to hold it for the configured window); until this function, nothing
 * accepted anything but `held`, so a held-then-`hold_window` deposit could
 * never actually be paid back (`GET /api/home/deposit-releases` listed it
 * forever).
 *
 * Deliberately not lease-scoped, unlike `settleLeaseDeposit`: that function
 * looks the deposit up through its lease and requires the lease past step 1,
 * both meaningless here — a deposit only ever reaches `hold_window` via that
 * same function's own "hold" action, which already required exactly that.
 * This one is reached by deposit id alone, from `DepositReleasesScreen`
 * (the owner's own answer on where the action lives).
 *
 * Early release is allowed (the owner's third answer) — `hold_release_date`
 * is a default the "hold" action sets, never a gate this function checks.
 *
 * `recordDepositMovementTx`'s own `allowedStatuses` guard is what refuses a
 * second settlement: once a `refund` or a `retain` lands, the deposit's
 * status moves off `hold_window` (`released`/`retained` — the same
 * `TERMINAL` map `recordDepositMovementTx` already carries), and a retry
 * finds a status no longer in `["hold_window"]` and 400s rather than moving
 * money twice. A partial `apply` that does not exhaust every outstanding due
 * leaves the status unchanged, by the identical design `settleLeaseDeposit`
 * already has — a follow-up call finishes what remains, which is a
 * continuation, not a retry.
 */
export async function releaseHeldDeposit(
  writer: Writer,
  input: ReleaseHeldDepositInput,
): Promise<ReleasedDeposit> {
  if (input.action === "retain") {
    if (input.amountMinor === undefined) {
      throw new ValidationError("amountMinor is required to retain part of a deposit");
    }
    const result = await recordDepositMovement(
      writer,
      {
        businessId: input.businessId,
        depositId: input.depositId,
        movementType: "retained",
        amountMinor: input.amountMinor,
        occurredOn: input.occurredOn,
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        userId: input.userId,
      },
      ["hold_window"],
    );
    return {
      depositId: input.depositId,
      status: result.deposit.status,
      heldMinor: result.heldMinor,
    };
  }

  if (input.action === "refund") {
    const heldBefore = await sumDepositMovements(writer, input.depositId);
    const result = await recordDepositMovement(
      writer,
      {
        businessId: input.businessId,
        depositId: input.depositId,
        movementType: "refunded",
        amountMinor: heldBefore as Minor,
        occurredOn: input.occurredOn,
        userId: input.userId,
      },
      ["hold_window"],
    );
    return {
      depositId: input.depositId,
      status: result.deposit.status,
      heldMinor: result.heldMinor,
    };
  }

  // "apply" — the whole sweep is one transaction, obligations locked for its
  // duration (GAP-5a discipline), the identical shape `settleLeaseDeposit`'s
  // own "apply" already uses.
  const dep = await findDepositForBusiness(writer, input.businessId, input.depositId);
  if (!dep) throw new NotFoundError("No such deposit in this business");
  const partyId = dep.partyType === "customer" ? dep.partyCustomerId : dep.partyDriverId;
  if (partyId === null) throw new NotFoundError("No such deposit in this business");

  const lastResult = await writer.transaction(async (tx) => {
    const heldBefore = await sumDepositMovements(tx, input.depositId);
    if (heldBefore <= 0n) {
      throw new ValidationError("Nothing is held on this deposit to apply");
    }

    const unpaidObligations = await findOutstandingObligationsForParty(
      tx,
      input.businessId,
      dep.partyType,
      partyId,
      "owed_to_us",
      true,
    );

    let remaining = heldBefore;
    let last: Awaited<ReturnType<typeof recordDepositMovementTx>> | undefined;
    for (const ob of unpaidObligations) {
      if (remaining <= 0n) break;
      // GAP-203/H-1/D2: a written-off portion is never collectible.
      const outstanding = ob.amountMinor - ob.settledMinor - ob.waivedMinor - ob.writtenOffMinor;
      if (outstanding <= 0n) continue;

      const take = (remaining < outstanding ? remaining : outstanding) as Minor;
      last = await recordDepositMovementTx(
        tx,
        {
          businessId: input.businessId,
          depositId: input.depositId,
          movementType: "applied",
          amountMinor: take,
          occurredOn: input.occurredOn,
          obligationId: ob.id,
          userId: input.userId,
        },
        ["hold_window"],
      );
      remaining -= take;
    }
    return last;
  });

  if (lastResult === undefined) {
    throw new ValidationError("Nothing is currently owed for this deposit to apply against");
  }
  return {
    depositId: input.depositId,
    status: lastResult.deposit.status,
    heldMinor: lastResult.heldMinor,
  };
}
