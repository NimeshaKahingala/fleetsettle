import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import {
  adjustment,
  billingPeriod,
  mileageAssessment,
  obligation,
  offsetAllocation,
  paymentAllocation,
} from "../db/schema.js";

type WriteDb = Writer | Tx;
type ReadDb = Reader | Writer | Tx;

export interface NewObligation {
  id: string;
  businessId: string;
  direction: "owed_to_us" | "owed_by_us";
  partyType: "customer" | "driver" | "partner";
  partyDriverId?: string;
  partyCustomerId?: string;
  partyUserId?: string;
  kind:
    | "rent"
    | "mileage_excess"
    | "daily_amount"
    | "driver_fee"
    | "post_closure_charge"
    | "customer_contribution"
    | "management_fee"
    | "trip_fare"
    | "opening_balance"
    | "other";
  sourceType: string;
  sourceId?: string;
  vehicleId?: string;
  amountMinor: bigint;
  settledMinor: bigint;
  waivedMinor: bigint;
  dueOn: string;
  effectiveDueOn: string;
  status: "pending" | "part_paid" | "paid" | "waived" | "written_off";
  postedPeriodId: string;
  belongsToPeriodId?: string;
  replacesId?: string;
}

/** DM §10.1: everything anyone owes anyone. `settledMinor`/`status` are supplied already-correct by the caller — this endpoint's writes never need a follow-up UPDATE (CLAUDE.md → Writes: one transaction). */
export async function insertObligation(db: WriteDb, values: NewObligation): Promise<void> {
  await db.insert(obligation).values(values);
}

/** GAP-103: one `INSERT` for a whole opening-balance batch's obligation-backed entries (IG §3.1 — never a query per row), unconditional unlike `insertObligationsIdempotent`, since every id here is freshly generated. */
export async function insertObligations(db: WriteDb, values: NewObligation[]): Promise<void> {
  if (values.length === 0) return;
  await db.insert(obligation).values(values);
}

/**
 * A10a/GAP-39: `generate-management-fee`'s own idempotent insert path,
 * backed by `obligation_management_fee_once` (migration 0011) — a second
 * run for the same period is a no-op, the same shape P13's
 * `insertAllocationDaysIdempotent` already uses for its own conflict.
 * `.returning()` after `onConflictDoNothing()` yields only the rows that
 * actually landed, so the caller can report a real count rather than
 * `values.length`.
 */
export async function insertObligationsIdempotent(
  db: WriteDb,
  values: NewObligation[],
): Promise<number> {
  if (values.length === 0) return 0;
  const inserted = await db
    .insert(obligation)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: obligation.id });
  return inserted.length;
}

export interface ObligationRow {
  id: string;
  kind: string;
  dueOn: string;
  amountMinor: bigint;
  settledMinor: bigint;
  waivedMinor: bigint;
  status: string;
}

/**
 * A source row's obligation, if it raised one — `source_type = 'day_record'`
 * for confirmDay's own idempotent no-op response, `source_type = 'trip'`
 * for GAP-57's receivable read. `voidedAt IS NULL`, the same convention
 * `findOutstandingObligationsForParty` already uses: a voided obligation
 * (A6's `cancelTrip`, GAP-23) reads as "none", not as its last live state.
 * Every existing caller only ever calls this immediately after creating the
 * row it's reading back, so the filter changes nothing for them — it only
 * matters for a caller reading one back later, once it might have been
 * voided since.
 */
export async function findObligationBySource(
  db: ReadDb,
  sourceType: string,
  sourceId: string,
): Promise<ObligationRow | undefined> {
  const rows = await db
    .select({
      id: obligation.id,
      kind: obligation.kind,
      dueOn: obligation.dueOn,
      amountMinor: obligation.amountMinor,
      settledMinor: obligation.settledMinor,
      waivedMinor: obligation.waivedMinor,
      status: obligation.status,
    })
    .from(obligation)
    .where(
      and(
        eq(obligation.sourceType, sourceType),
        eq(obligation.sourceId, sourceId),
        isNull(obligation.voidedAt),
      ),
    )
    .limit(1);
  return rows[0];
}

export interface ObligationForAdjustment {
  id: string;
  amountMinor: bigint;
  settledMinor: bigint;
  waivedMinor: bigint;
  status: "pending" | "part_paid" | "paid" | "waived" | "written_off";
  voidedAt: string | null;
}

/** Scoped by `businessId` — the same shape every P2+ read gets (CLAUDE.md → Tenancy). */
export async function findObligationForBusiness(
  db: ReadDb,
  businessId: string,
  obligationId: string,
): Promise<ObligationForAdjustment | undefined> {
  const rows = await db
    .select({
      id: obligation.id,
      amountMinor: obligation.amountMinor,
      settledMinor: obligation.settledMinor,
      waivedMinor: obligation.waivedMinor,
      status: obligation.status,
      voidedAt: obligation.voidedAt,
    })
    .from(obligation)
    .where(and(eq(obligation.id, obligationId), eq(obligation.businessId, businessId)))
    .limit(1);
  return rows[0] as ObligationForAdjustment | undefined;
}

/**
 * F-2.4/UC-15: a waiver raises `waived_minor` only — `amount_minor` stays
 * "the 340 charged" (DM §10.3's own example). Every other adjustment type
 * changes `amount_minor` itself by `sign * amountMinor`, since it is a real
 * change to what is owed, not money forgiven and still shown as billed.
 */
export async function applyAdjustmentToObligation(
  db: WriteDb,
  obligationId: string,
  values: { amountMinor: bigint; waivedMinor: bigint; status: string },
): Promise<void> {
  await db
    .update(obligation)
    .set({
      amountMinor: values.amountMinor,
      waivedMinor: values.waivedMinor,
      status: values.status,
    })
    .where(eq(obligation.id, obligationId));
}

export interface OutstandingObligation {
  id: string;
  kind: string;
  dueOn: string;
  amountMinor: bigint;
  settledMinor: bigint;
  waivedMinor: bigint;
}

/**
 * Oldest-`due_on`-first (§6.5's allocation discipline) — the obligations an
 * offset (or a future generic settle) draws down against, one direction at
 * a time.
 *
 * GAP-5a: `forUpdate` locks the rows for the duration of the caller's own
 * transaction, closing the race two concurrent settlements against the
 * same party could otherwise create — the identical shape D-15/GAP-5 (DM
 * §10.2) already closed for a payment's own forward-allocation credit.
 * Defaults `false`: this function's other callers (a read-only summary, a
 * read-only screen) never write, and locking rows they only display would
 * be pure contention with no correctness benefit — only `offset.ts`'s own
 * write path, inside its transaction, passes `true`.
 */
export async function findOutstandingObligationsForDriver(
  db: ReadDb,
  businessId: string,
  driverId: string,
  direction: "owed_to_us" | "owed_by_us",
  forUpdate = false,
): Promise<OutstandingObligation[]> {
  const query = db
    .select({
      id: obligation.id,
      kind: obligation.kind,
      dueOn: obligation.dueOn,
      amountMinor: obligation.amountMinor,
      settledMinor: obligation.settledMinor,
      waivedMinor: obligation.waivedMinor,
    })
    .from(obligation)
    .where(
      and(
        eq(obligation.businessId, businessId),
        eq(obligation.partyType, "driver"),
        eq(obligation.partyDriverId, driverId),
        eq(obligation.direction, direction),
        sql`${obligation.status} IN ('pending', 'part_paid')`,
        isNull(obligation.voidedAt),
      ),
    )
    .orderBy(asc(obligation.dueOn));
  const rows = await (forUpdate ? query.for("update") : query);
  return rows;
}

/**
 * §6.5's allocation discipline, generalised to any party — F-2.2's generic
 * payment collection draws down a customer's `owed_to_us` obligations the
 * same oldest-first way the driver-scoped query above already does.
 *
 * GAP-5a: same `forUpdate` shape and the same reason — only `payment.ts`'s
 * write path passes `true`; `lease-closure.ts`'s closure summary and
 * `customer.ts`'s obligations screen are both display-only reads via
 * `reader` and stay unlocked.
 */
export async function findOutstandingObligationsForParty(
  db: ReadDb,
  businessId: string,
  partyType: "customer" | "driver" | "partner",
  partyId: string,
  direction: "owed_to_us" | "owed_by_us",
  forUpdate = false,
): Promise<OutstandingObligation[]> {
  const partyColumn =
    partyType === "customer"
      ? obligation.partyCustomerId
      : partyType === "driver"
        ? obligation.partyDriverId
        : obligation.partyUserId;

  const query = db
    .select({
      id: obligation.id,
      kind: obligation.kind,
      dueOn: obligation.dueOn,
      amountMinor: obligation.amountMinor,
      settledMinor: obligation.settledMinor,
      waivedMinor: obligation.waivedMinor,
    })
    .from(obligation)
    .where(
      and(
        eq(obligation.businessId, businessId),
        eq(obligation.partyType, partyType),
        eq(partyColumn, partyId),
        eq(obligation.direction, direction),
        sql`${obligation.status} IN ('pending', 'part_paid')`,
        isNull(obligation.voidedAt),
      ),
    )
    .orderBy(asc(obligation.dueOn));
  const rows = await (forUpdate ? query.for("update") : query);
  return rows;
}

/**
 * GAP-12/W-61/INV-36 §3.1: `voidAdjustment`'s own write — a waiver reversal
 * touches only `waivedMinor`/`status`, a `+1`-type reversal can touch
 * `amountMinor`/`settledMinor`/`status` together (the unwound excess moves
 * both), so this takes all four rather than composing two separate updates
 * that would otherwise both land on the same row.
 */
export async function reverseAdjustmentOnObligation(
  db: WriteDb,
  obligationId: string,
  values: { amountMinor: bigint; settledMinor: bigint; waivedMinor: bigint; status: string },
): Promise<void> {
  await db
    .update(obligation)
    .set({
      amountMinor: values.amountMinor,
      settledMinor: values.settledMinor,
      waivedMinor: values.waivedMinor,
      status: values.status,
    })
    .where(eq(obligation.id, obligationId));
}

/** Settling further against an obligation an offset (or a payment) already touched — never a fresh row. */
export async function updateObligationSettled(
  db: WriteDb,
  obligationId: string,
  values: { settledMinor: bigint; status: string },
): Promise<void> {
  await db
    .update(obligation)
    .set({ settledMinor: values.settledMinor, status: values.status })
    .where(eq(obligation.id, obligationId));
}

export interface ObligationForVoid {
  id: string;
  kind: string;
  amountMinor: bigint;
  settledMinor: bigint;
  waivedMinor: bigint;
  status: "pending" | "part_paid" | "paid" | "waived" | "written_off";
  voidedAt: string | null;
}

/** GAP-12/W-61/INV-36 §3.10: the direct-void endpoint's own read — needs `kind` on top of what `findObligationForBusiness` already returns, to gate which obligations may be voided directly. */
export async function findObligationForVoid(
  db: ReadDb,
  businessId: string,
  obligationId: string,
): Promise<ObligationForVoid | undefined> {
  const rows = await db
    .select({
      id: obligation.id,
      kind: obligation.kind,
      amountMinor: obligation.amountMinor,
      settledMinor: obligation.settledMinor,
      waivedMinor: obligation.waivedMinor,
      status: obligation.status,
      voidedAt: obligation.voidedAt,
    })
    .from(obligation)
    .where(and(eq(obligation.id, obligationId), eq(obligation.businessId, businessId)))
    .limit(1);
  return rows[0] as ObligationForVoid | undefined;
}

export interface ObligationBlocker {
  kind: "payment_allocation" | "offset_allocation" | "adjustment";
  id: string;
  amountMinor: bigint;
}

/**
 * GAP-12/W-61/INV-36 §3.10: the direct-void guard — "refuse when live
 * allocations or adjustments sit against it." Every one of these is a
 * separately-entered fact (§2's governing principle): a payment someone
 * collected, an offset someone recorded, an adjustment someone applied.
 * Voiding the obligation underneath any of them would leave that row
 * pointing at a receivable that no longer exists.
 */
export async function findLiveBlockersForObligation(
  db: ReadDb,
  obligationId: string,
): Promise<ObligationBlocker[]> {
  const [payments, offsets, adjustments] = await Promise.all([
    db
      .select({ id: paymentAllocation.id, amountMinor: paymentAllocation.amountMinor })
      .from(paymentAllocation)
      .where(
        and(eq(paymentAllocation.obligationId, obligationId), isNull(paymentAllocation.voidedAt)),
      ),
    db
      .select({ id: offsetAllocation.id, amountMinor: offsetAllocation.amountMinor })
      .from(offsetAllocation)
      .where(
        and(eq(offsetAllocation.obligationId, obligationId), isNull(offsetAllocation.voidedAt)),
      ),
    db
      .select({ id: adjustment.id, amountMinor: adjustment.amountMinor })
      .from(adjustment)
      .where(and(eq(adjustment.obligationId, obligationId), isNull(adjustment.voidedAt))),
  ]);

  return [
    ...payments.map((r) => ({
      kind: "payment_allocation" as const,
      id: r.id,
      amountMinor: r.amountMinor,
    })),
    ...offsets.map((r) => ({
      kind: "offset_allocation" as const,
      id: r.id,
      amountMinor: r.amountMinor,
    })),
    ...adjustments.map((r) => ({
      kind: "adjustment" as const,
      id: r.id,
      amountMinor: r.amountMinor,
    })),
  ];
}

/**
 * A9's void, applied to whichever obligation (if any) a source row raised —
 * A6's own use is `cancelTrip` voiding a `trip_fare` obligation. `WHERE …
 * voided_at IS NULL` makes 0 rows affected legitimate in two separate
 * cases, neither an error: nothing was ever raised for this source (a
 * charter with no customer never posts one), or it was already voided
 * (the caller's own idempotent-on-status guard already prevents a second
 * call in the ordinary path, but the guard here costs nothing and matches
 * every other void in this codebase). A void into a closed period is still
 * refused by the trigger (migration 0008/GAP-35) — the caller maps that the
 * same way every other write does.
 */
export async function voidObligationBySource(
  db: WriteDb,
  sourceType: string,
  sourceId: string,
  values: { voidedReason: string; voidedBy: string },
): Promise<void> {
  await db
    .update(obligation)
    .set({ voidedAt: sql`now()`, voidedReason: values.voidedReason, voidedBy: values.voidedBy })
    .where(
      and(
        eq(obligation.sourceType, sourceType),
        eq(obligation.sourceId, sourceId),
        isNull(obligation.voidedAt),
      ),
    );
}

/**
 * GAP-103: a correction voids by id directly, not by source — the caller
 * already knows exactly which row a prior commit posted (via
 * `opening_balance_posting`), so there is no source pair to match against.
 * `WHERE … voided_at IS NULL` is the same idempotency guard
 * `voidObligationBySource` carries, for the same reason.
 */
export async function voidObligationById(
  db: WriteDb,
  obligationId: string,
  values: { voidedReason: string; voidedBy: string },
): Promise<void> {
  await db
    .update(obligation)
    .set({ voidedAt: sql`now()`, voidedReason: values.voidedReason, voidedBy: values.voidedBy })
    .where(and(eq(obligation.id, obligationId), isNull(obligation.voidedAt)));
}

/** W-2: two sums, one per direction, never netted here or anywhere else in the schema — only an `offset_record` moves both. */
export async function sumOutstandingByDirectionForDriver(
  db: ReadDb,
  businessId: string,
  driverId: string,
): Promise<{ owedToUsMinor: bigint; owedByUsMinor: bigint }> {
  const rows = await db
    .select({
      direction: obligation.direction,
      outstanding: sql<string>`SUM(${obligation.amountMinor} - ${obligation.settledMinor} - ${obligation.waivedMinor})`,
    })
    .from(obligation)
    .where(
      and(
        eq(obligation.businessId, businessId),
        eq(obligation.partyType, "driver"),
        eq(obligation.partyDriverId, driverId),
        sql`${obligation.status} IN ('pending', 'part_paid')`,
        isNull(obligation.voidedAt),
      ),
    )
    .groupBy(obligation.direction);

  let owedToUsMinor = 0n;
  let owedByUsMinor = 0n;
  for (const row of rows) {
    const value = BigInt(row.outstanding);
    if (row.direction === "owed_to_us") owedToUsMinor = value;
    else if (row.direction === "owed_by_us") owedByUsMinor = value;
  }
  return { owedToUsMinor, owedByUsMinor };
}

export interface LeaseObligationRow {
  id: string;
  kind: string;
  dueOn: string;
  amountMinor: bigint;
  settledMinor: bigint;
  waivedMinor: bigint;
  status: string;
}

/**
 * Web-P6b's lease hub: every obligation this lease has ever raised, oldest
 * due first. There is no `lease_id` column on `obligation` itself — a rent
 * due points at its `billing_period`, a mileage-excess due at its
 * `mileage_assessment`, and only a post-closure charge (F-8.4) points at the
 * lease directly — so this is three source paths, the same shape
 * `trackCreatedLease` (tests/support/factories.ts) already tears down by.
 * Two round trips to collect the child ids, then one query, rather than a
 * correlated subquery — the convention this codebase already uses
 * (queries/day-record.ts's `listDayRecordsForDriver`).
 */
export async function findObligationsForLease(
  db: ReadDb,
  businessId: string,
  leaseId: string,
): Promise<LeaseObligationRow[]> {
  const periods = await db
    .select({ id: billingPeriod.id })
    .from(billingPeriod)
    .where(eq(billingPeriod.leaseId, leaseId));
  const periodIds = periods.map((p) => p.id);

  const assessments = await db
    .select({ id: mileageAssessment.id })
    .from(mileageAssessment)
    .where(eq(mileageAssessment.leaseId, leaseId));
  const assessmentIds = assessments.map((a) => a.id);

  const sourceClauses = [and(eq(obligation.sourceType, "lease"), eq(obligation.sourceId, leaseId))];
  if (periodIds.length > 0) {
    sourceClauses.push(
      and(eq(obligation.sourceType, "billing_period"), inArray(obligation.sourceId, periodIds)),
    );
  }
  if (assessmentIds.length > 0) {
    sourceClauses.push(
      and(
        eq(obligation.sourceType, "mileage_assessment"),
        inArray(obligation.sourceId, assessmentIds),
      ),
    );
  }

  const rows = await db
    .select({
      id: obligation.id,
      kind: obligation.kind,
      dueOn: obligation.dueOn,
      amountMinor: obligation.amountMinor,
      settledMinor: obligation.settledMinor,
      waivedMinor: obligation.waivedMinor,
      status: obligation.status,
    })
    .from(obligation)
    .where(
      and(eq(obligation.businessId, businessId), isNull(obligation.voidedAt), or(...sourceClauses)),
    )
    .orderBy(asc(obligation.dueOn));
  return rows;
}
