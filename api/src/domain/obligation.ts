import type { Writer } from "../db/client.js";
import { isPeriodClosedViolation } from "../db/pg-error.js";
import {
  NotFoundError,
  ObligationAlreadyVoidedError,
  PeriodClosedError,
  ValidationError,
  VoidBlockedError,
  type VoidBlockingItem,
} from "../errors/app-error.js";
import {
  findLiveBlockersForObligation,
  findObligationForVoid,
  voidObligationById,
} from "../queries/obligation.js";

/**
 * GAP-12/W-61/INV-36 §3.10: every obligation is derived from a source —
 * billing period, day record, trip, incident — except a post-closure
 * charge, raised directly from user input with no other row to correct
 * instead (F-8.4/UC-91). A derived one is corrected at its source (close
 * the lease, void the day, cancel the trip) so a figure never detaches
 * from the event that caused it. `opening_balance` is the one other
 * user-entered kind but stays out of this allowlist deliberately —
 * GAP-103's batch reversal is its own correction path, not this one.
 */
const DIRECTLY_VOIDABLE_KINDS: ReadonlySet<string> = new Set(["post_closure_charge"]);

export interface VoidObligationInput {
  businessId: string;
  obligationId: string;
  reason: string;
  userId: string;
}

export interface VoidedObligation {
  id: string;
  voidedAt: string;
}

export async function voidObligation(
  writer: Writer,
  input: VoidObligationInput,
): Promise<VoidedObligation> {
  try {
    // withActor (db/client.ts) only attributes writes inside a real
    // transaction — wrapped here for that reason, the same as every other
    // void in this codebase.
    //
    // GAP-178/B12: the blocker check reads inside that transaction too.
    // Read before it, a payment can be allocated against this obligation
    // between "nothing is blocking" and the void — and the void succeeds,
    // leaving an allocation pointing at a voided obligation. That is the
    // double-count VoidBlockedError exists to prevent.
    const voided = await writer.transaction(async (tx) => {
      const ob = await findObligationForVoid(tx, input.businessId, input.obligationId);
      if (!ob) throw new NotFoundError("No such obligation in this business");
      if (ob.voidedAt !== null) throw new ObligationAlreadyVoidedError();

      if (!DIRECTLY_VOIDABLE_KINDS.has(ob.kind)) {
        throw new ValidationError(
          `An obligation of kind '${ob.kind}' cannot be voided directly — correct it at its ` +
            "source (close the lease, void the day, cancel the trip) instead",
        );
      }

      const blockers = await findLiveBlockersForObligation(tx, input.obligationId);
      if (blockers.length > 0) {
        const items: VoidBlockingItem[] = blockers.map((b) => ({
          kind: b.kind,
          id: b.id,
          amountMinor: b.amountMinor.toString(),
        }));
        throw new VoidBlockedError(
          "Cannot void — money is already allocated or adjusted against this obligation. Void " +
            "those first, each with its own reason",
          items,
        );
      }

      await voidObligationById(tx, input.businessId, input.obligationId, {
        voidedReason: input.reason,
        voidedBy: input.userId,
      });
      return findObligationForVoid(tx, input.businessId, input.obligationId);
    });
    if (!voided?.voidedAt) throw new ObligationAlreadyVoidedError();
    return { id: input.obligationId, voidedAt: voided.voidedAt };
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    throw err;
  }
}
