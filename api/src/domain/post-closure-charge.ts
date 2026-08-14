import { newId, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { Writer } from "../db/client.js";
import { applyCreditForward } from "./credit-forward.js";
import { isPeriodClosedViolation, isUniqueViolation } from "../db/pg-error.js";
import {
  NotFoundError,
  PeriodClosedError,
  ReplacesTargetAlreadyReplacedError,
  ReplacesTargetNotVoidedError,
} from "../errors/app-error.js";
import { resolvePeriodLinkage } from "../queries/accounting-period.js";
import { findObligationForBusiness, insertObligation } from "../queries/obligation.js";

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
  replacesId?: string;
}

export interface RecordedPostClosureCharge {
  obligationId: string;
  status: "pending" | "part_paid" | "paid" | "waived";
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
        const target = await findObligationForBusiness(tx, input.businessId, input.replacesId);
        if (!target) throw new NotFoundError("No such obligation in this business");
        if (target.voidedAt === null) throw new ReplacesTargetNotVoidedError();
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

      return { obligationId, status: credit.status };
    });
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    if (isUniqueViolation(err, "obligation_replaces_id_key")) {
      throw new ReplacesTargetAlreadyReplacedError();
    }
    throw err;
  }
}
