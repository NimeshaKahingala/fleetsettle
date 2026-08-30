import { newId, type BusinessDate } from "@fleetsettle/shared";
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import type { Tx } from "../db/client.js";
import { payment, paymentAllocation } from "../db/schema.js";
import { insertPaymentAllocation } from "../queries/payment.js";
import { updateObligationSettled } from "../queries/obligation.js";
import { computeObligationStatus } from "./obligation-status.js";

/**
 * GAP-5b: on-write forward allocation. F-2.2/F-4.5 already describe an
 * unallocated payment surplus as "credit against the next due" — DM §10.2's
 * own convention, checked at Wave 1 and found already correct in shape,
 * only never actually applied by anything. This is that application,
 * called once, synchronously, from every `insertObligation` call site
 * (CLAUDE.md's "no cron is a prerequisite for a user action" — the same
 * reasoning D-9 already applies to the daily-lease horizon and D-13 to a
 * trip's hold expiry): the moment a new obligation exists for a party who
 * already has unapplied credit in the matching direction, it is settled
 * from that credit before anyone has to notice the credit was sitting
 * there and re-enter a payment for what was already collected.
 *
 * Locks every candidate payment row `FOR UPDATE` before reading its own
 * remaining credit (`amount_minor - SUM(live payment_allocation)`) — the
 * same GAP-5a shape, aimed the other way: two obligations racing to draw
 * on the same party's credit must serialise on the payment rows, not the
 * obligation rows this time, since a payment is the shared resource here.
 * `UNIQUE (payment_id, obligation_id)` (partial, `voided_at IS NULL`) is
 * the idempotency backstop, not the concurrency control — the lock is.
 *
 * Never a table it cannot draw on: `direction` must match exactly
 * (`received` credit only settles an `owed_to_us` obligation, `paid`
 * credit only an `owed_by_us` one) — the same pairing `recordPayment`
 * itself already enforces at the point a payment is taken.
 *
 * `outstandingMinor` is what is left to draw credit against — not always
 * the obligation's own `amount_minor`. `confirmDay`'s own daily-amount
 * obligation is the one call site that already settles part of itself at
 * creation (a driver's cash handed over on the spot, `settledMinor` set
 * directly, never 0); `alreadySettledMinor` carries that figure through so
 * the final `settledMinor` this function writes adds to it rather than
 * overwriting it, and `computeObligationStatus` sees the obligation's real
 * total (`outstandingMinor + alreadySettledMinor`, waivedMinor always 0 at
 * every call site this function is used from), not just the remainder.
 */
export interface CreditForwardResult {
  settledMinor: bigint;
  // "written_off" is unreachable here in practice — every call site passes
  // a brand-new obligation, never one carrying prior write-off history —
  // but computeObligationStatus's return type is unconditional, not
  // value-dependent, so this stays honest to it rather than narrowed by a cast.
  status: "pending" | "part_paid" | "paid" | "waived" | "written_off";
}

export async function applyCreditForward(
  tx: Tx,
  businessId: string,
  partyType: "customer" | "driver" | "partner",
  partyId: string,
  obligationDirection: "owed_to_us" | "owed_by_us",
  obligationId: string,
  outstandingMinor: bigint,
  allocatedOn: BusinessDate,
  alreadySettledMinor = 0n,
): Promise<CreditForwardResult> {
  const noCredit = {
    settledMinor: alreadySettledMinor,
    status: computeObligationStatus(
      outstandingMinor + alreadySettledMinor,
      alreadySettledMinor,
      0n,
    ),
  } as const;
  if (outstandingMinor <= 0n) return noCredit;

  const paymentDirection = obligationDirection === "owed_to_us" ? "received" : "paid";
  const partyColumn =
    partyType === "customer"
      ? payment.partyCustomerId
      : partyType === "driver"
        ? payment.partyDriverId
        : payment.partyUserId;

  const candidates = await tx
    .select({ id: payment.id, amountMinor: payment.amountMinor })
    .from(payment)
    .where(
      and(
        eq(payment.businessId, businessId),
        eq(payment.partyType, partyType),
        eq(partyColumn, partyId),
        eq(payment.direction, paymentDirection),
        // M-7: 'corrected' still carries real, drawable surplus — amount_minor
        // already holds the true remaining figure (DM §10.2/§14). Only
        // 'reversed' means none of this payment counts any more.
        ne(payment.status, "reversed"),
      ),
    )
    .orderBy(asc(payment.occurredOn), asc(payment.id))
    .for("update");

  let remaining = outstandingMinor;
  for (const p of candidates) {
    if (remaining <= 0n) break;

    const [allocatedRow] = await tx
      .select({ allocated: sql<string>`COALESCE(SUM(${paymentAllocation.amountMinor}), 0)` })
      .from(paymentAllocation)
      .where(and(eq(paymentAllocation.paymentId, p.id), isNull(paymentAllocation.voidedAt)));
    // eslint-disable-next-line no-restricted-syntax -- the SQL COALESCE already guarantees a row with '0', never missing data standing in for zero
    const creditMinor = p.amountMinor - BigInt(allocatedRow?.allocated ?? "0");
    if (creditMinor <= 0n) continue;

    const take = remaining < creditMinor ? remaining : creditMinor;
    await insertPaymentAllocation(tx, {
      id: newId(),
      paymentId: p.id,
      obligationId,
      amountMinor: take,
      allocatedOn,
    });
    remaining -= take;
  }

  if (remaining >= outstandingMinor) return noCredit;

  const drawnFromCredit = outstandingMinor - remaining;
  const settledMinor = alreadySettledMinor + drawnFromCredit;
  const amountMinor = outstandingMinor + alreadySettledMinor;
  const status = computeObligationStatus(amountMinor, settledMinor, 0n);
  await updateObligationSettled(tx, businessId, obligationId, { settledMinor, status });
  return { settledMinor, status };
}
