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
 * F-2.2/UC-11, one transaction: a `payment` plus its `payment_allocation`
 * rows, oldest-`due_on`-first (§6.5) — "two months together, oldest first
 * with a preview" is exactly this allocation, run for real rather than only
 * previewed. Never touches `owed_by_us` — a driver's shortfall is settled
 * through F-4's confirm-day path, not this generic one.
 *
 * A surplus beyond every outstanding due is F-2.2's "overpayment held as
 * customer credit" — returned as `unallocatedMinor` rather than silently
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
        direction: "received",
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
  occurredOn: BusinessDate,
  amountMinor: Minor,
): Promise<{ allocations: PaymentAllocationResult[]; remaining: Minor }> {
  const obligations = await findOutstandingObligationsForParty(
    tx,
    businessId,
    partyType,
    partyId,
    "owed_to_us",
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
