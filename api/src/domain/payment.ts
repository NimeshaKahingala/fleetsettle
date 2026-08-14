import { newId, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { Tx, Writer } from "../db/client.js";
import { isPeriodClosedViolation } from "../db/pg-error.js";
import { PeriodClosedError } from "../errors/app-error.js";
import { resolvePeriodLinkage } from "../queries/accounting-period.js";
import {
  findOutstandingObligationsForParty,
  updateObligationSettled,
} from "../queries/obligation.js";
import { insertPayment, insertPaymentAllocation } from "../queries/payment.js";
import { computeObligationStatus } from "./obligation-status.js";

export interface RecordPaymentInput {
  businessId: string;
  /**
   * F-2.2 (`received`, the original and still-default shape) or F-6.1
   * (`paid` — GAP-63: "pay the driver" has no trip-fee-specific path,
   * only this generic one, "categorised for what it is"). Both share one
   * table, one allocation routine and one `direction` CHECK (DM §10.2) —
   * only which obligation direction it settles differs.
   */
  direction: "received" | "paid";
  partyType: "customer" | "driver" | "partner";
  partyId: string;
  amountMinor: Minor;
  occurredOn: BusinessDate;
  userId: string;
}

export interface PaymentAllocationResult {
  obligationId: string;
  amountMinor: Minor;
}

export interface RecordedPayment {
  paymentId: string;
  allocations: PaymentAllocationResult[];
  unallocatedMinor: Minor;
}

/**
 * F-2.2/UC-11 and F-6.1/UC-50, one transaction: a `payment` plus its
 * `payment_allocation` rows, oldest-`due_on`-first (§6.5) — "two months
 * together, oldest first with a preview" is exactly this allocation, run
 * for real rather than only previewed. `direction` decides which of a
 * party's two obligation directions this settles — never both in one call,
 * which is what `createOffset` (F-6.4/W-2/INV-3) exists for instead.
 *
 * A surplus beyond every outstanding due is F-2.2's "overpayment held as
 * customer credit" (or, on the `paid` side, F-6.1's "goodwill/retainer with
 * no trip attached") — returned as `unallocatedMinor` rather than silently
 * dropped, though applying it forward against a future due is not wired yet
 * (recorded here rather than silently skipped, matching P4's convention).
 */
export async function recordPayment(
  writer: Writer,
  input: RecordPaymentInput,
): Promise<RecordedPayment> {
  try {
    return await writer.transaction(async (tx) => {
      const linkage = await resolvePeriodLinkage(tx, input.businessId, input.occurredOn);
      if (!linkage)
        throw new PeriodClosedError("No accounting period covers this business date yet");

      const paymentId = newId();
      await insertPayment(tx, {
        id: paymentId,
        businessId: input.businessId,
        direction: input.direction,
        partyType: input.partyType,
        ...(input.partyType === "customer" ? { partyCustomerId: input.partyId } : {}),
        ...(input.partyType === "driver" ? { partyDriverId: input.partyId } : {}),
        ...(input.partyType === "partner" ? { partyUserId: input.partyId } : {}),
        amountMinor: input.amountMinor,
        occurredOn: input.occurredOn,
        handledByUserId: input.userId,
        createdBy: input.userId,
        postedPeriodId: linkage.postedPeriodId,
        ...(linkage.belongsToPeriodId !== null
          ? { belongsToPeriodId: linkage.belongsToPeriodId }
          : {}),
      });

      const { allocations, remaining } = await allocateAgainstOldest(
        tx,
        paymentId,
        input.businessId,
        input.partyType,
        input.partyId,
        input.direction === "received" ? "owed_to_us" : "owed_by_us",
        input.occurredOn,
        input.amountMinor,
      );

      return { paymentId, allocations, unallocatedMinor: remaining };
    });
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    throw err;
  }
}

async function allocateAgainstOldest(
  tx: Tx,
  paymentId: string,
  businessId: string,
  partyType: "customer" | "driver" | "partner",
  partyId: string,
  obligationDirection: "owed_to_us" | "owed_by_us",
  occurredOn: BusinessDate,
  amountMinor: Minor,
): Promise<{ allocations: PaymentAllocationResult[]; remaining: Minor }> {
  // GAP-5a: locked for the rest of this transaction — two concurrent
  // payments settling the same party's obligations must not both read the
  // same pre-write settledMinor and lose one of their updates.
  const obligations = await findOutstandingObligationsForParty(
    tx,
    businessId,
    partyType,
    partyId,
    obligationDirection,
    true,
  );

  const allocations: PaymentAllocationResult[] = [];
  let remaining: bigint = amountMinor;
  for (const ob of obligations) {
    if (remaining <= 0n) break;
    const outstanding = ob.amountMinor - ob.settledMinor - ob.waivedMinor;
    if (outstanding <= 0n) continue;

    const take = remaining < outstanding ? remaining : outstanding;
    const newSettled = ob.settledMinor + take;
    const status = computeObligationStatus(ob.amountMinor, newSettled, ob.waivedMinor);

    await updateObligationSettled(tx, ob.id, { settledMinor: newSettled, status });
    await insertPaymentAllocation(tx, {
      id: newId(),
      paymentId,
      obligationId: ob.id,
      amountMinor: take,
      allocatedOn: occurredOn,
    });

    allocations.push({ obligationId: ob.id, amountMinor: take as Minor });
    remaining -= take;
  }

  return { allocations, remaining: remaining as Minor };
}
