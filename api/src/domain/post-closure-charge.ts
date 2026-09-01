import { newId, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { Writer } from "../db/client.js";
import { applyCreditForward } from "./credit-forward.js";
import { deductFromDriverFeeTx } from "./offset.js";
import { isPeriodClosedViolation, isUniqueViolation } from "../db/pg-error.js";
import {
  NotFoundError,
  PeriodClosedError,
  ReplacesTargetAlreadyReplacedError,
  ReplacesTargetNotVoidedError,
  ValidationError,
} from "../errors/app-error.js";
import { resolvePeriodLinkage } from "../queries/accounting-period.js";
import { findObligationPartyForReplacesCheck, insertObligation } from "../queries/obligation.js";

export interface RecordPostClosureChargeInput {
  businessId: string;
  partyType: "customer" | "driver";
  partyCustomerId?: string;
  partyDriverId?: string;
  vehicleId?: string;
  sourceType: "lease" | "trip";
  sourceId: string;
  amountMinor: Minor;
  dueOn: BusinessDate;
  note?: string;
  /** GAP-15/§6.7: settle what's left of this charge against the driver's own fee balance, in this same transaction. `partyType` must be `'driver'`. */
  deductFromFee?: boolean;
  userId: string;
  replacesId?: string;
}

export interface RecordedPostClosureCharge {
  obligationId: string;
  // "written_off" is unreachable here — a brand-new obligation, settled only
  // through applyCreditForward/deductFromDriverFee — but
  // computeObligationStatus's return type is unconditional, not
  // value-dependent, so this stays honest to it rather than narrowed by a cast.
  status: "pending" | "part_paid" | "paid" | "waived" | "written_off";
  deductedFromFeeOffsetId: string | null;
}

/**
 * F-8.4/UC-91/W-29: a camera fine or a toll arriving weeks after the lease
 * or trip has already closed. `obligation.kind = 'post_closure_charge'` has
 * existed in the DB enum since P3/P4's own schema; this is the first write
 * path to actually use it. Deliberately never checks whether `sourceId`
 * (the referenced lease or trip) is itself closed — the handler has already
 * confirmed it belongs to this business, and being closed is exactly the
 * point of the flow, not a reason to refuse it. Posts to the *currently
 * open* period, per F-8.1's general late-fact rule, since the lease or
 * trip's own period is routinely long settled by the time this arrives.
 */
export async function recordPostClosureCharge(
  writer: Writer,
  input: RecordPostClosureChargeInput,
): Promise<RecordedPostClosureCharge> {
  try {
    return await writer.transaction(async (tx) => {
      const linkage = await resolvePeriodLinkage(tx, input.businessId, input.dueOn);
      if (!linkage)
        throw new PeriodClosedError("No accounting period covers this business date yet");

      if (input.replacesId !== undefined) {
        const target = await findObligationPartyForReplacesCheck(
          tx,
          input.businessId,
          input.replacesId,
        );
        if (!target) throw new NotFoundError("No such obligation in this business");
        if (target.voidedAt === null) throw new ReplacesTargetNotVoidedError();
        // Same class as Gitar's finding on PR #45 (adjustment/incident_recovery):
        // without this, replacesId could name a voided obligation against a
        // *different* party.
        const sameParty =
          target.partyType === input.partyType &&
          (target.partyCustomerId ?? undefined) === input.partyCustomerId &&
          (target.partyDriverId ?? undefined) === input.partyDriverId;
        if (!sameParty) {
          throw new ValidationError("replacesId names an obligation against a different party");
        }
      }

      const obligationId = newId();
      await insertObligation(tx, {
        id: obligationId,
        businessId: input.businessId,
        direction: "owed_to_us",
        partyType: input.partyType,
        ...(input.partyDriverId !== undefined ? { partyDriverId: input.partyDriverId } : {}),
        ...(input.partyCustomerId !== undefined ? { partyCustomerId: input.partyCustomerId } : {}),
        kind: "post_closure_charge",
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        ...(input.vehicleId !== undefined ? { vehicleId: input.vehicleId } : {}),
        amountMinor: input.amountMinor,
        settledMinor: 0n,
        waivedMinor: 0n,
        dueOn: input.dueOn,
        effectiveDueOn: input.dueOn,
        status: "pending",
        postedPeriodId: linkage.postedPeriodId,
        ...(linkage.belongsToPeriodId !== null
          ? { belongsToPeriodId: linkage.belongsToPeriodId }
          : {}),
        ...(input.replacesId !== undefined ? { replacesId: input.replacesId } : {}),
      });

      // GAP-5b: a fine or toll landing on a party who already carries
      // unapplied credit settles from it immediately, same as every other
      // obligation this business raises.
      const credit = await applyCreditForward(
        tx,
        input.businessId,
        input.partyType,
        (input.partyType === "customer" ? input.partyCustomerId : input.partyDriverId) as string,
        "owed_to_us",
        obligationId,
        input.amountMinor,
        input.dueOn,
      );

      // GAP-15/§6.7: the charter fine's one-tap "deduct from his fee" —
      // whatever existing credit didn't already cover is settled directly
      // against *this* obligation (never an oldest-first sweep on this
      // side — the manager chose which charge to deduct) while the
      // business's own owed-by-us side sweeps oldest-first, composed into
      // this same transaction rather than a separate POST /api/offset
      // call. `deductFromDriverFeeTx` throws (refusing the whole request,
      // not just the deduction) when the driver's fee balance can't cover
      // it — a one-tap action either does what it says or fails, it does
      // not silently degrade into an ordinary receivable.
      let status = credit.status;
      let deductedFromFeeOffsetId: string | null = null;
      const remaining = input.amountMinor - credit.settledMinor;
      if (input.deductFromFee === true && remaining > 0n) {
        const deduction = await deductFromDriverFeeTx(tx, {
          businessId: input.businessId,
          driverId: input.partyDriverId as string,
          obligationId,
          obligationAmountMinor: input.amountMinor,
          obligationSettledMinor: credit.settledMinor,
          obligationWaivedMinor: 0n,
          amountMinor: remaining as Minor,
          occurredOn: input.dueOn,
          note: "Deducted from driver fee (post-closure charge)",
          userId: input.userId,
        });
        status = deduction.obligationStatus;
        deductedFromFeeOffsetId = deduction.offsetId;
      }

      return { obligationId, status, deductedFromFeeOffsetId };
    });
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    if (isUniqueViolation(err, "obligation_replaces_id_key")) {
      throw new ReplacesTargetAlreadyReplacedError();
    }
    throw err;
  }
}
