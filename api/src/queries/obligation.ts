import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import {
  adjustment,
  billingPeriod,
  incident,
  incidentRecovery,
  mileageAssessment,
  obligation,
  offsetAllocation,
  paymentAllocation,
} from "../db/schema.js";

type WriteDb = Writer | Tx;
type ReadDb = Reader | Writer | Tx;

export type ObligationDirection = "owed_to_us" | "owed_by_us";

export type ObligationKind =
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

export interface NewObligation {
  id: string;
  businessId: string;
  direction: ObligationDirection;
  partyType: "customer" | "driver" | "partner";
  partyDriverId?: string;
  partyCustomerId?: string;
  partyUserId?: string;
  kind: ObligationKind;
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
  effectiveDueOn: string;
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
 *
 * GAP-196: a source can legitimately raise more than one obligation in
 * opposite directions — a trip is both a customer receivable (`trip_fare`,
 * `owed_to_us`) and a driver payable (`driver_fee`, `owed_by_us`) sharing
 * the identical `(sourceType, sourceId)`. Without `kind`/`direction`
 * narrowing this, `LIMIT 1` with no `ORDER BY` returns whichever row
 * Postgres happens to produce first — not necessarily the one the caller
 * meant — and a caller that assumed "one obligation per source" (every
 * caller before GAP-196) could silently receive the other party's money in
 * the wrong direction. Required, not optional, so every call site names
 * what it actually wants and the compiler enumerates them all.
 */
export async function findObligationBySource(
  db: ReadDb,
  sourceType: string,
  sourceId: string,
  kind: ObligationKind,
  direction: ObligationDirection,
): Promise<ObligationRow | undefined> {
  const rows = await db
    .select({
      id: obligation.id,
      kind: obligation.kind,
      dueOn: obligation.dueOn,
      effectiveDueOn: obligation.effectiveDueOn,
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
        eq(obligation.kind, kind),
        eq(obligation.direction, direction),
        isNull(obligation.voidedAt),
      ),
    )
    .limit(1);
  return rows[0];
}

/**
 * `day_record` raises exactly one obligation, always `daily_amount`/
 * `owed_to_us` (`confirmDay.ts`'s own `insertObligation` call). Named
 * rather than four repeats of `findObligationBySource(db, "day_record",
 * id, "daily_amount", "owed_to_us")` across `confirmDay.ts` (its own
 * idempotent-replay paths) and the day-record handler's own read.
 */
export function findDayRecordObligation(
  db: ReadDb,
  dayRecordId: string,
): Promise<ObligationRow | undefined> {
  return findObligationBySource(db, "day_record", dayRecordId, "daily_amount", "owed_to_us");
}

/**
 * `billing_period` raises exactly one obligation, always `rent`/
 * `owed_to_us` (`billing-period.ts`'s own `insertObligation` call). Named
 * rather than three repeats of `findObligationBySource(db,
 * "billing_period", id, "rent", "owed_to_us")` across `billing-period.ts`
 * (its own idempotent-replay path), `lease-closure.ts` (the final rent
 * figure) and `incident.ts` (off-road rent-treatment).
 */
export function findBillingPeriodRentObligation(
  db: ReadDb,
  billingPeriodId: string,
): Promise<ObligationRow | undefined> {
  return findObligationBySource(db, "billing_period", billingPeriodId, "rent", "owed_to_us");
}

export interface ObligationForAdjustment {
  id: string;
  amountMinor: bigint;
  settledMinor: bigint;
  waivedMinor: bigint;
  status: "pending" | "part_paid" | "paid" | "waived" | "written_off";
  voidedAt: string | null;
}

/**
 * Scoped by `businessId` — the same shape every P2+ read gets (CLAUDE.md → Tenancy).
 *
 * GAP-178/B14b, B17: `forUpdate` locks the row for the caller's own
 * transaction, the same shape `findObligationForDepositApply` and
 * `findOutstandingObligationsForParty` already use. Every domain caller reads
 * `settledMinor`/`waivedMinor`, computes a new figure from them and writes it
 * back — a read-modify-write that loses one of two concurrent updates without
 * the lock. The two handler call sites are read-only and keep the default.
 */
export async function findObligationForBusiness(
  db: ReadDb,
  businessId: string,
  obligationId: string,
  forUpdate = false,
): Promise<ObligationForAdjustment | undefined> {
  const query = db
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
  const rows = await (forUpdate ? query.for("update") : query);
  return rows[0] as ObligationForAdjustment | undefined;
}

export interface ObligationForDepositApply {
  id: string;
  direction: "owed_to_us" | "owed_by_us";
  partyType: "customer" | "driver" | "partner";
  partyCustomerId: string | null;
  partyDriverId: string | null;
  amountMinor: bigint;
  settledMinor: bigint;
  waivedMinor: bigint;
  status: "pending" | "part_paid" | "paid" | "waived" | "written_off";
  voidedAt: string | null;
}

/**
 * GAP-6/F-2.7: `recordDepositMovement`'s own validation for an `applied`
 * movement — needs both the money fields (to cap the application at what's
 * outstanding) and the party fields (to refuse a deposit applying against a
 * different party's obligation) in one read.
 *
 * `forUpdate` locks the row for the caller's own transaction — the same
 * GAP-5a discipline `findOutstandingObligationsForDriver`/`ForParty` already
 * use, closing the read-then-write race two concurrent `applied` movements
 * against the same obligation would otherwise create. Defaults `false`;
 * only `deposit.ts`'s write path passes `true`.
 */
export async function findObligationForDepositApply(
  db: ReadDb,
  businessId: string,
  obligationId: string,
  forUpdate = false,
): Promise<ObligationForDepositApply | undefined> {
  const query = db
    .select({
      id: obligation.id,
      direction: obligation.direction,
      partyType: obligation.partyType,
      partyCustomerId: obligation.partyCustomerId,
      partyDriverId: obligation.partyDriverId,
      amountMinor: obligation.amountMinor,
      settledMinor: obligation.settledMinor,
      waivedMinor: obligation.waivedMinor,
      status: obligation.status,
      voidedAt: obligation.voidedAt,
    })
    .from(obligation)
    .where(and(eq(obligation.id, obligationId), eq(obligation.businessId, businessId)))
    .limit(1);
  const rows = await (forUpdate ? query.for("update") : query);
  return rows[0] as ObligationForDepositApply | undefined;
}

export interface ObligationForReplacesCheck {
  voidedAt: string | null;
  partyType: "customer" | "driver" | "partner";
  partyCustomerId: string | null;
  partyDriverId: string | null;
}

/** GAP-60/D-16: `post-closure-charge.ts`'s own `replacesId` lookup — a direct void only ever applies to `kind = 'post_closure_charge'` (INV-36 §3.10), so this needs nothing beyond party identity to check the target isn't a different party's charge. */
export async function findObligationPartyForReplacesCheck(
  db: ReadDb,
  businessId: string,
  obligationId: string,
): Promise<ObligationForReplacesCheck | undefined> {
  const rows = await db
    .select({
      voidedAt: obligation.voidedAt,
      partyType: obligation.partyType,
      partyCustomerId: obligation.partyCustomerId,
      partyDriverId: obligation.partyDriverId,
    })
    .from(obligation)
    .where(and(eq(obligation.id, obligationId), eq(obligation.businessId, businessId)))
    .limit(1);
  return rows[0] as ObligationForReplacesCheck | undefined;
}

/**
 * F-2.4/UC-15: a waiver raises `waived_minor` only — `amount_minor` stays
 * "the 340 charged" (DM §10.3's own example). Every other adjustment type
 * changes `amount_minor` itself by `sign * amountMinor`, since it is a real
 * change to what is owed, not money forgiven and still shown as billed.
 */
/**
 * GAP-178/B14a. Every `UPDATE` on `obligation` is scoped by `business_id` and
 * asserts it touched exactly one row.
 *
 * The scoping is the tenancy rule (CLAUDE.md → Tenancy) applied where it had
 * been left off: these updates matched on `id` alone, so an `obligationId`
 * from another tenant — however it got there — would have been written.
 *
 * The assert is the part worth arguing about, so: **zero rows throws a 500,
 * never a 4xx.** Every caller has already read the row inside the same
 * transaction, under `FOR UPDATE` after GAP-178/B14b. If the update then
 * matches nothing, the row did not fail to exist for a reason the user can
 * act on — it means a tenancy bug reached past every earlier guard, or a
 * concurrent delete that this schema has no path for. A 404 would tell the
 * caller their input was wrong when it was not, and would make a real defect
 * look like ordinary traffic. The transaction rolls back either way, so
 * nothing is half-written.
 */
function assertOneRow(rows: { id: string }[], operation: string, obligationId: string): void {
  if (rows.length === 1) return;
  throw new Error(
    `${operation} matched ${rows.length.toString()} rows for obligation ${obligationId} — ` +
      "expected exactly 1. The row was read under FOR UPDATE in this same transaction, so " +
      "this is a tenancy or concurrency defect, not user error",
  );
}

export async function applyAdjustmentToObligation(
  db: WriteDb,
  businessId: string,
  obligationId: string,
  values: { amountMinor: bigint; waivedMinor: bigint; status: string },
): Promise<void> {
  const rows = await db
    .update(obligation)
    .set({
      amountMinor: values.amountMinor,
      waivedMinor: values.waivedMinor,
      status: values.status,
    })
    .where(and(eq(obligation.id, obligationId), eq(obligation.businessId, businessId)))
    .returning({ id: obligation.id });
  assertOneRow(rows, "applyAdjustmentToObligation", obligationId);
}

export interface OutstandingObligation {
  id: string;
  kind: string;
  dueOn: string;
  effectiveDueOn: string;
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
      effectiveDueOn: obligation.effectiveDueOn,
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
      effectiveDueOn: obligation.effectiveDueOn,
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
  businessId: string,
  obligationId: string,
  values: { amountMinor: bigint; settledMinor: bigint; waivedMinor: bigint; status: string },
): Promise<void> {
  const rows = await db
    .update(obligation)
    .set({
      amountMinor: values.amountMinor,
      settledMinor: values.settledMinor,
      waivedMinor: values.waivedMinor,
      status: values.status,
    })
    .where(and(eq(obligation.id, obligationId), eq(obligation.businessId, businessId)))
    .returning({ id: obligation.id });
  assertOneRow(rows, "reverseAdjustmentOnObligation", obligationId);
}

/** Settling further against an obligation an offset (or a payment) already touched — never a fresh row. */
export async function updateObligationSettled(
  db: WriteDb,
  businessId: string,
  obligationId: string,
  values: { settledMinor: bigint; status: string },
): Promise<void> {
  const rows = await db
    .update(obligation)
    .set({ settledMinor: values.settledMinor, status: values.status })
    .where(and(eq(obligation.id, obligationId), eq(obligation.businessId, businessId)))
    .returning({ id: obligation.id });
  assertOneRow(rows, "updateObligationSettled", obligationId);
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
/**
 * GAP-178/B12: `forUpdate` locks the obligation row, and this PR needed the
 * reminder — found by Gitar's review of #118.
 *
 * `voidAdvance` got the parent lock because an interleaved test proved that
 * moving its check inside the transaction was not enough. `voidObligation` is
 * the same shape and got only the first half of the same fix: a plain SELECT
 * does not stop a `payment_allocation` or `adjustment` being inserted between
 * "nothing is blocking" and the void, because READ COMMITTED has no predicate
 * locking. The allocation paths already lock the obligation
 * (`findOutstandingObligationsForParty(…, true)`, and `findObligationForBusiness`
 * as of B14b), so locking here is what makes the two serialize.
 */
export async function findObligationForVoid(
  db: ReadDb,
  businessId: string,
  obligationId: string,
  forUpdate = false,
): Promise<ObligationForVoid | undefined> {
  const query = db
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
  const rows = await (forUpdate ? query.for("update") : query);
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
  businessId: string,
  sourceType: string,
  sourceId: string,
  values: { voidedReason: string; voidedBy: string },
): Promise<void> {
  await db
    .update(obligation)
    .set({ voidedAt: sql`now()`, voidedReason: values.voidedReason, voidedBy: values.voidedBy })
    .where(
      and(
        // GAP-178/B14a's rule, applied to the one void path it did not
        // reach. Both callers already resolve their source business-scoped
        // (`findTripForBusiness`, `findIncidentRecoveryForBusiness`), so this
        // is not a live cross-tenant hole today — it is the predicate that
        // keeps it from becoming one when a third caller arrives that does
        // not. `businessId` is required rather than optional for the reason
        // GAP-178 gave: the compiler then enumerates every call site, so
        // there is no staged rollout and nothing to miss.
        eq(obligation.businessId, businessId),
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
  businessId: string,
  obligationId: string,
  values: { voidedReason: string; voidedBy: string },
): Promise<void> {
  // No row-count assert here, deliberately: `voided_at IS NULL` makes a
  // second void a legitimate no-op (the idempotency guard this already
  // carried), so zero rows is an expected outcome rather than a defect. The
  // `business_id` scoping is the part that was missing.
  await db
    .update(obligation)
    .set({ voidedAt: sql`now()`, voidedReason: values.voidedReason, voidedBy: values.voidedBy })
    .where(
      and(
        eq(obligation.id, obligationId),
        eq(obligation.businessId, businessId),
        isNull(obligation.voidedAt),
      ),
    );
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
  effectiveDueOn: string;
  amountMinor: bigint;
  settledMinor: bigint;
  waivedMinor: bigint;
  status: string;
}

/**
 * Web-P6b's lease hub: every obligation this lease has ever raised, oldest
 * due first. There is no `lease_id` column on `obligation` itself — a rent
 * due points at its `billing_period`, a mileage-excess due at its
 * `mileage_assessment`, an incident-driven customer contribution (D-9/GAP-10,
 * `recordCustomerContribution`, domain/incident.ts) at its `incident_recovery`
 * — always lease-scoped by construction, since a contribution needs a
 * customer and "no lease means no customer" — and only a post-closure charge
 * (F-8.4) points at the lease directly — so this is four source paths, the
 * same shape `trackCreatedLease` (tests/support/factories.ts) already tears
 * down by (GAP-163: the fourth was missing until now, confirmed invisible on
 * `LeaseHubScreen`). Three round trips to collect the child ids (periods,
 * assessments, recoveries), then one query, rather than a correlated
 * subquery — the convention this codebase already uses
 * (queries/day-record.ts's `listDayRecordsForDriver`); the incident-recovery
 * path is a single join rather than two hops, since
 * `incident_recovery.incident_id → incident.lease_id` is only one.
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

  const recoveries = await db
    .select({ id: incidentRecovery.id })
    .from(incidentRecovery)
    .innerJoin(incident, eq(incident.id, incidentRecovery.incidentId))
    .where(and(eq(incident.leaseId, leaseId), isNull(incidentRecovery.voidedAt)));
  const recoveryIds = recoveries.map((r) => r.id);

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
  if (recoveryIds.length > 0) {
    sourceClauses.push(
      and(
        eq(obligation.sourceType, "incident_recovery"),
        inArray(obligation.sourceId, recoveryIds),
      ),
    );
  }

  const rows = await db
    .select({
      id: obligation.id,
      kind: obligation.kind,
      dueOn: obligation.dueOn,
      effectiveDueOn: obligation.effectiveDueOn,
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
