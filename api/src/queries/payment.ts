import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import { payment, paymentAllocation } from "../db/schema.js";

type WriteDb = Writer | Tx;
type ReadDb = Reader | Writer | Tx;

export interface NewPayment {
  id: string;
  businessId: string;
  direction: "received" | "paid";
  partyType: "customer" | "driver" | "partner";
  partyDriverId?: string;
  partyCustomerId?: string;
  partyUserId?: string;
  amountMinor: bigint;
  occurredOn: string;
  handledByUserId?: string;
  reference?: string;
  postedPeriodId: string;
  belongsToPeriodId?: string;
  createdBy?: string;
}

/** DM §10.2. `amountMinor` has a `CHECK (> 0)` — the caller only reaches this when something was actually received. */
export async function insertPayment(db: WriteDb, values: NewPayment): Promise<void> {
  await db.insert(payment).values(values);
}

/** GAP-103: one `INSERT` for a whole opening-balance batch's `cash_held` entries (IG §3.1). */
export async function insertPayments(db: WriteDb, values: NewPayment[]): Promise<void> {
  if (values.length === 0) return;
  await db.insert(payment).values(values);
}

/** GAP-103: an opening-balance correction reverses a prior commit's synthetic `cash_held` payment by flipping `status` — `listPartnerCashPositions` (queries/reports.ts) already filters `status = 'active'`, so this alone removes it from every partner's cash figure. `WHERE … status = 'active'` keeps a second call a no-op, the same idempotency shape every other void in this file carries. Never routed through `payment_correction` — that machinery unwinds real allocations, and this row, by construction, never has any. */
export async function markPaymentReversed(db: WriteDb, paymentId: string): Promise<void> {
  await db
    .update(payment)
    .set({ status: "reversed" })
    .where(and(eq(payment.id, paymentId), eq(payment.status, "active")));
}

export interface NewPaymentAllocation {
  id: string;
  paymentId: string;
  obligationId: string;
  amountMinor: bigint;
  allocatedOn: string;
}

/** DM §10.2: the oldest-first allocation record — one obligation for a single day confirm, never a loop over many (that's F-4.5/F-4.6's own allocation preview). */
export async function insertPaymentAllocation(
  db: WriteDb,
  values: NewPaymentAllocation,
): Promise<void> {
  await db.insert(paymentAllocation).values(values);
}

export interface PaymentListRow {
  id: string;
  direction: "received" | "paid";
  partyType: "customer" | "driver" | "partner";
  partyCustomerId: string | null;
  partyDriverId: string | null;
  partyUserId: string | null;
  amountMinor: bigint;
  occurredOn: string;
  method: string | null;
  reference: string | null;
  status: "active" | "corrected" | "reversed";
}

export interface PaymentListFilters {
  partyType?: "customer" | "driver" | "partner";
  partyCustomerId?: string;
  partyDriverId?: string;
  direction?: "received" | "paid";
  from?: string;
  to?: string;
}

/**
 * A3/GAP-38: `POST /api/payment/{id}/correct` has had no caller since P9 —
 * F-8.2's own first step is "open the receipt", so this is what hands a
 * screen a payment id. Every filter optional, newest first. Carries the
 * linked-driver test class (W-49) — a payment names the driver it was paid
 * to or received from, so a linked-driver token must never reach this list
 * (it is not a STAFF capability, so `requireCapability` already refuses it).
 */
export async function listPaymentsForBusiness(
  db: ReadDb,
  businessId: string,
  filters: PaymentListFilters,
): Promise<PaymentListRow[]> {
  const rows = await db
    .select({
      id: payment.id,
      direction: payment.direction,
      partyType: payment.partyType,
      partyCustomerId: payment.partyCustomerId,
      partyDriverId: payment.partyDriverId,
      partyUserId: payment.partyUserId,
      amountMinor: payment.amountMinor,
      occurredOn: payment.occurredOn,
      method: payment.method,
      reference: payment.reference,
      status: payment.status,
    })
    .from(payment)
    .where(
      and(
        eq(payment.businessId, businessId),
        filters.partyType !== undefined ? eq(payment.partyType, filters.partyType) : undefined,
        filters.partyCustomerId !== undefined
          ? eq(payment.partyCustomerId, filters.partyCustomerId)
          : undefined,
        filters.partyDriverId !== undefined
          ? eq(payment.partyDriverId, filters.partyDriverId)
          : undefined,
        filters.direction !== undefined ? eq(payment.direction, filters.direction) : undefined,
        filters.from !== undefined ? gte(payment.occurredOn, filters.from) : undefined,
        filters.to !== undefined ? lte(payment.occurredOn, filters.to) : undefined,
      ),
    )
    .orderBy(desc(payment.occurredOn), desc(payment.id));
  return rows as PaymentListRow[];
}

export interface PaymentRow {
  id: string;
  amountMinor: bigint;
  status: "active" | "corrected" | "reversed";
  postedPeriodId: string;
}

/** F-8.2/UC-93. Scoped by `businessId` — the same tenancy shape every P2+ read gets. */
export async function findPaymentForBusiness(
  db: ReadDb,
  businessId: string,
  paymentId: string,
): Promise<PaymentRow | undefined> {
  const rows = await db
    .select({
      id: payment.id,
      amountMinor: payment.amountMinor,
      status: payment.status,
      postedPeriodId: payment.postedPeriodId,
    })
    .from(payment)
    .where(and(eq(payment.id, paymentId), eq(payment.businessId, businessId)))
    .limit(1);
  return rows[0] as PaymentRow | undefined;
}

/**
 * F-8.2/UC-93: "the amount is editable rather than the receipt being
 * cancelled" — DM §14's own checklist names `payment.status` as this table's
 * equivalent of the `voided_at` trio every other money table carries, so this
 * is the sanctioned edit path, not a violation of append-only (INV-21).
 * `posted_period_id` is deliberately untouched, which is what lets this
 * update land even after the payment's own period has closed (migration
 * 0006).
 */
export async function updatePaymentAfterCorrection(
  db: WriteDb,
  paymentId: string,
  values: { amountMinor: bigint; status: "corrected" | "reversed" },
): Promise<void> {
  await db
    .update(payment)
    .set({ amountMinor: values.amountMinor, status: values.status })
    .where(eq(payment.id, paymentId));
}

export interface PaymentAllocationRow {
  id: string;
  obligationId: string;
  amountMinor: bigint;
}

/**
 * F-8.2/UC-93's undo order: newest-allocated first. UUIDv7 ids are time-
 * ordered, so `ORDER BY id DESC` is "unwind the most recent allocation
 * first" without a separate `created_at` column on this child row.
 */
export async function findPaymentAllocationsForPayment(
  db: ReadDb,
  paymentId: string,
): Promise<PaymentAllocationRow[]> {
  const rows = await db
    .select({
      id: paymentAllocation.id,
      obligationId: paymentAllocation.obligationId,
      amountMinor: paymentAllocation.amountMinor,
    })
    .from(paymentAllocation)
    .where(and(eq(paymentAllocation.paymentId, paymentId), isNull(paymentAllocation.voidedAt)))
    .orderBy(desc(paymentAllocation.id));
  return rows;
}

/** Partially unwinding an allocation — `amount_minor > 0` is a CHECK constraint, so this is only ever called with `newAmountMinor > 0n`; a full unwind uses `voidPaymentAllocation` instead. */
export async function reducePaymentAllocation(
  db: WriteDb,
  allocationId: string,
  newAmountMinor: bigint,
): Promise<void> {
  await db
    .update(paymentAllocation)
    .set({ amountMinor: newAmountMinor })
    .where(eq(paymentAllocation.id, allocationId));
}

/**
 * F-8.2/UC-93: unwinding an allocation down to zero voids the row rather
 * than setting `amount_minor = 0` (the CHECK forbids it anyway). The credit
 * formula in DM §10.2 (`payment.amount_minor - SUM(payment_allocation)`)
 * already excludes voided rows, so a fully-undone allocation drops out of
 * that sum exactly as a deleted row would have — D-11/W-58: voided, never
 * deleted.
 */
export async function voidPaymentAllocation(
  db: WriteDb,
  allocationId: string,
  voidedBy: string,
): Promise<void> {
  await db
    .update(paymentAllocation)
    .set({ voidedAt: sql`now()`, voidedReason: "Undone during a payment correction", voidedBy })
    .where(eq(paymentAllocation.id, allocationId));
}
