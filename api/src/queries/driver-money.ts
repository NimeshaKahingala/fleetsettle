import { and, desc, eq, gte, isNull, lte, ne, sql } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import {
  accountingPeriod,
  advance,
  advanceSettlement,
  deposit,
  depositMovement,
  offsetAllocation,
  offsetRecord,
} from "../db/schema.js";

type WriteDb = Writer | Tx;
type ReadDb = Reader | Writer | Tx;

export interface NewAdvance {
  id: string;
  businessId: string;
  driverId: string;
  tripId?: string;
  amountMinor: bigint;
  issuedOn: string;
  issuedByUserId?: string;
  postedPeriodId: string;
  belongsToPeriodId?: string;
  replacesId?: string;
}

/** UC-53. Not a cost — reconciled to zero, and INV-17 blocks trip closure until it is. */
export async function insertAdvance(db: WriteDb, values: NewAdvance): Promise<void> {
  await db.insert(advance).values({ ...values, status: "open" });
}

/** GAP-103: one `INSERT` for a whole opening-balance batch's `advance_outstanding` entries (IG §3.1). */
export async function insertAdvances(db: WriteDb, values: NewAdvance[]): Promise<void> {
  if (values.length === 0) return;
  await db.insert(advance).values(values.map((v) => ({ ...v, status: "open" as const })));
}

export interface AdvanceRow {
  id: string;
  businessId: string;
  driverId: string;
  tripId: string | null;
  amountMinor: bigint;
  issuedOn: string;
  status: "open" | "part_settled" | "settled";
  voidedAt: string | null;
  replacesId: string | null;
}

/** Scoped by `businessId` — the same shape every P2+ read gets (CLAUDE.md → Tenancy). */
export async function findAdvanceForBusiness(
  db: ReadDb,
  businessId: string,
  advanceId: string,
): Promise<AdvanceRow | undefined> {
  const rows = await db
    .select({
      id: advance.id,
      businessId: advance.businessId,
      driverId: advance.driverId,
      tripId: advance.tripId,
      amountMinor: advance.amountMinor,
      issuedOn: advance.issuedOn,
      status: advance.status,
      voidedAt: advance.voidedAt,
      replacesId: advance.replacesId,
    })
    .from(advance)
    .where(and(eq(advance.id, advanceId), eq(advance.businessId, businessId)))
    .limit(1);
  return rows[0] as AdvanceRow | undefined;
}

/** F-5.4/UC-44, INV-17: an advance still `open`/`part_settled` against this trip is what blocks closing it. F-5.5/UC-45: the same set is what cancelling settles, one way or the other. */
export async function findUnsettledAdvancesForTrip(
  db: ReadDb,
  tripId: string,
): Promise<AdvanceRow[]> {
  const rows = await db
    .select({
      id: advance.id,
      businessId: advance.businessId,
      driverId: advance.driverId,
      tripId: advance.tripId,
      amountMinor: advance.amountMinor,
      issuedOn: advance.issuedOn,
      status: advance.status,
      voidedAt: advance.voidedAt,
      replacesId: advance.replacesId,
    })
    .from(advance)
    .where(
      and(eq(advance.tripId, tripId), ne(advance.status, "settled"), isNull(advance.voidedAt)),
    );
  return rows as AdvanceRow[];
}

/** F-6.8/UC-59: the linked driver's own advances, windowed by `issuedOn` — never voided ones, which are a correction, not a fact he still owes against. */
export async function listAdvancesForDriver(
  db: ReadDb,
  businessId: string,
  driverId: string,
  from: string,
  to: string,
): Promise<AdvanceRow[]> {
  const rows = await db
    .select({
      id: advance.id,
      businessId: advance.businessId,
      driverId: advance.driverId,
      tripId: advance.tripId,
      amountMinor: advance.amountMinor,
      issuedOn: advance.issuedOn,
      status: advance.status,
      voidedAt: advance.voidedAt,
      replacesId: advance.replacesId,
    })
    .from(advance)
    .where(
      and(
        eq(advance.businessId, businessId),
        eq(advance.driverId, driverId),
        isNull(advance.voidedAt),
        gte(advance.issuedOn, from),
        lte(advance.issuedOn, to),
      ),
    );
  return rows as AdvanceRow[];
}

export interface NewAdvanceSettlement {
  id: string;
  businessId: string;
  advanceId: string;
  kind: "spent" | "returned" | "kept_as_fee";
  amountMinor: bigint;
  occurredOn: string;
  postedPeriodId: string;
  belongsToPeriodId?: string;
  replacesId?: string;
}

export async function insertAdvanceSettlement(
  db: WriteDb,
  values: NewAdvanceSettlement,
): Promise<void> {
  await db.insert(advanceSettlement).values(values);
}

export interface AdvanceSettlementRow {
  id: string;
  advanceId: string;
  kind: "spent" | "returned" | "kept_as_fee";
  amountMinor: bigint;
  occurredOn: string;
  voidedAt: string | null;
  voidedReason: string | null;
  replacesId: string | null;
}

/** GAP-12/W-61/INV-36 §3.5. Scoped by `businessId` — the same tenancy shape every P2+ read gets. */
export async function findAdvanceSettlementForBusiness(
  db: ReadDb,
  businessId: string,
  settlementId: string,
): Promise<AdvanceSettlementRow | undefined> {
  const rows = await db
    .select({
      id: advanceSettlement.id,
      advanceId: advanceSettlement.advanceId,
      kind: advanceSettlement.kind,
      amountMinor: advanceSettlement.amountMinor,
      occurredOn: advanceSettlement.occurredOn,
      voidedAt: advanceSettlement.voidedAt,
      voidedReason: advanceSettlement.voidedReason,
      replacesId: advanceSettlement.replacesId,
    })
    .from(advanceSettlement)
    .where(
      and(eq(advanceSettlement.id, settlementId), eq(advanceSettlement.businessId, businessId)),
    )
    .limit(1);
  return rows[0] as AdvanceSettlementRow | undefined;
}

/** GAP-147: every settlement ever recorded against one advance, newest first — the read a manager needs to find one to void, `dailyOperations` matching the endpoint it exists to serve. */
export async function listAdvanceSettlementsForAdvance(
  db: ReadDb,
  businessId: string,
  advanceId: string,
): Promise<AdvanceSettlementRow[]> {
  const rows = await db
    .select({
      id: advanceSettlement.id,
      advanceId: advanceSettlement.advanceId,
      kind: advanceSettlement.kind,
      amountMinor: advanceSettlement.amountMinor,
      occurredOn: advanceSettlement.occurredOn,
      voidedAt: advanceSettlement.voidedAt,
      voidedReason: advanceSettlement.voidedReason,
      replacesId: advanceSettlement.replacesId,
    })
    .from(advanceSettlement)
    .where(
      and(eq(advanceSettlement.businessId, businessId), eq(advanceSettlement.advanceId, advanceId)),
    )
    .orderBy(desc(advanceSettlement.occurredOn), desc(advanceSettlement.id));
  return rows as AdvanceSettlementRow[];
}

/** GAP-12/W-61/INV-36 §3.5: void, never delete — the `voidExpense` shape, `WHERE … voided_at IS NULL` so a losing race is a no-op rather than a clobber. */
export async function voidAdvanceSettlementRow(
  db: WriteDb,
  settlementId: string,
  values: { voidedReason: string; voidedBy: string },
): Promise<{ voidedAt: string } | undefined> {
  const rows = await db
    .update(advanceSettlement)
    .set({ voidedAt: sql`now()`, voidedReason: values.voidedReason, voidedBy: values.voidedBy })
    .where(and(eq(advanceSettlement.id, settlementId), isNull(advanceSettlement.voidedAt)))
    .returning({ voidedAt: advanceSettlement.voidedAt });
  return rows[0] as { voidedAt: string } | undefined;
}

/**
 * The advance closes at zero (UC-53) — the running total of every settlement
 * recorded against it so far. GAP-12/INV-36: a voided settlement (§3.5)
 * must not count, or `advance.status` recomputed from this sum would still
 * read as settled while the driver holds cash again.
 */
export async function sumSettledForAdvance(db: ReadDb, advanceId: string): Promise<bigint> {
  const rows = await db
    .select({ amountMinor: advanceSettlement.amountMinor })
    .from(advanceSettlement)
    .where(and(eq(advanceSettlement.advanceId, advanceId), isNull(advanceSettlement.voidedAt)));
  return rows.reduce((sum, row) => sum + row.amountMinor, 0n);
}

export async function updateAdvanceStatus(
  db: WriteDb,
  advanceId: string,
  status: "open" | "part_settled" | "settled",
): Promise<void> {
  await db.update(advance).set({ status }).where(eq(advance.id, advanceId));
}

/** GAP-12/W-61/INV-36 §3.6: `voidAdvance`'s own refuse-guard — every live settlement against this advance, each its own entered act, named in the refusal so the manager can void them first, in the order he entered them. */
export async function findLiveSettlementsForAdvance(
  db: ReadDb,
  advanceId: string,
): Promise<Array<{ id: string; amountMinor: bigint }>> {
  const rows = await db
    .select({ id: advanceSettlement.id, amountMinor: advanceSettlement.amountMinor })
    .from(advanceSettlement)
    .where(and(eq(advanceSettlement.advanceId, advanceId), isNull(advanceSettlement.voidedAt)));
  return rows;
}

/** INV-35/F-1.11: the archive check's own read — every advance this driver still owes settlement on, never a voided one (a correction, not a fact he still owes against, the same convention `listAdvancesForDriver` already uses). */
export async function findOpenAdvancesForDriver(
  db: ReadDb,
  businessId: string,
  driverId: string,
): Promise<Array<{ id: string; amountMinor: bigint }>> {
  const rows = await db
    .select({ id: advance.id, amountMinor: advance.amountMinor })
    .from(advance)
    .where(
      and(
        eq(advance.businessId, businessId),
        eq(advance.driverId, driverId),
        sql`${advance.status} IN ('open', 'part_settled')`,
        isNull(advance.voidedAt),
      ),
    );
  return rows;
}

/** GAP-103: an opening-balance correction voids the advance a prior commit posted, by id — `WHERE … voided_at IS NULL` keeps a second call a no-op. */
export async function voidAdvanceById(
  db: WriteDb,
  advanceId: string,
  values: { voidedReason: string; voidedBy: string },
): Promise<void> {
  await db
    .update(advance)
    .set({ voidedAt: sql`now()`, voidedReason: values.voidedReason, voidedBy: values.voidedBy })
    .where(and(eq(advance.id, advanceId), isNull(advance.voidedAt)));
}

/** GAP-12/W-61/INV-36 §3.6: void, never delete — the same write as `voidAdvanceById`, but `.returning()` so a losing race against a concurrent void returns `undefined` rather than a clobbered row (the house pattern `voidCapitalContributionRow` established). */
export async function voidAdvanceRow(
  db: WriteDb,
  advanceId: string,
  values: { voidedReason: string; voidedBy: string },
): Promise<{ voidedAt: string } | undefined> {
  const rows = await db
    .update(advance)
    .set({ voidedAt: sql`now()`, voidedReason: values.voidedReason, voidedBy: values.voidedBy })
    .where(and(eq(advance.id, advanceId), isNull(advance.voidedAt)))
    .returning({ voidedAt: advance.voidedAt });
  return rows[0] as { voidedAt: string } | undefined;
}

export interface NewDeposit {
  id: string;
  businessId: string;
  partyType: "customer" | "driver";
  partyCustomerId?: string;
  partyDriverId?: string;
  leaseId?: string;
  dailyLeaseId?: string;
}

/** F-6.7/UC-58/W-8, F-2.1/UC-16: one `deposit` row per driver arrangement or lease — the balance is the SUM of its movements (DM §10.4), never a stored figure to drift. */
export async function insertDeposit(db: WriteDb, values: NewDeposit): Promise<void> {
  await db.insert(deposit).values({ ...values, status: "held" });
}

/** GAP-103: one `INSERT` for a whole opening-balance batch's `deposit_held` entries (IG §3.1). */
export async function insertDeposits(db: WriteDb, values: NewDeposit[]): Promise<void> {
  if (values.length === 0) return;
  await db.insert(deposit).values(values.map((v) => ({ ...v, status: "held" as const })));
}

export interface DepositRow {
  id: string;
  businessId: string;
  partyType: "customer" | "driver";
  partyCustomerId: string | null;
  partyDriverId: string | null;
  leaseId: string | null;
  status: "held" | "hold_window" | "released" | "applied" | "retained";
  holdReleaseDate: string | null;
}

const DEPOSIT_COLUMNS = {
  id: deposit.id,
  businessId: deposit.businessId,
  partyType: deposit.partyType,
  partyCustomerId: deposit.partyCustomerId,
  partyDriverId: deposit.partyDriverId,
  leaseId: deposit.leaseId,
  status: deposit.status,
  holdReleaseDate: deposit.holdReleaseDate,
};

/** The one deposit currently held for this driver — DM §10.4 makes no promise there's ever more than one live at a time; this reads whichever isn't yet released or retained. */
export async function findHeldDepositForDriver(
  db: ReadDb,
  businessId: string,
  driverId: string,
): Promise<DepositRow | undefined> {
  const rows = await db
    .select(DEPOSIT_COLUMNS)
    .from(deposit)
    .where(
      and(
        eq(deposit.businessId, businessId),
        eq(deposit.partyDriverId, driverId),
        eq(deposit.status, "held"),
      ),
    )
    .orderBy(desc(deposit.createdAt))
    .limit(1);
  return rows[0] as DepositRow | undefined;
}

/** INV-35/F-1.11: the archive check's own read — every deposit still `held` or in `hold_window` for this party, either kind, not yet `released`/`applied`/`retained`. */
export async function findOpenDepositsForParty(
  db: ReadDb,
  businessId: string,
  partyType: "customer" | "driver",
  partyId: string,
): Promise<DepositRow[]> {
  const partyColumn = partyType === "customer" ? deposit.partyCustomerId : deposit.partyDriverId;
  const rows = await db
    .select(DEPOSIT_COLUMNS)
    .from(deposit)
    .where(
      and(
        eq(deposit.businessId, businessId),
        eq(partyColumn, partyId),
        sql`${deposit.status} IN ('held', 'hold_window')`,
      ),
    );
  return rows as DepositRow[];
}

export async function findDepositForBusiness(
  db: ReadDb,
  businessId: string,
  depositId: string,
): Promise<DepositRow | undefined> {
  const rows = await db
    .select(DEPOSIT_COLUMNS)
    .from(deposit)
    .where(and(eq(deposit.id, depositId), eq(deposit.businessId, businessId)))
    .limit(1);
  return rows[0] as DepositRow | undefined;
}

/** F-2.6/UC-16 step 6: the deposit currently attached to this lease, whatever its status — the closure flow needs to find it (not only a `held` one) so it can also read one already in `hold_window`. */
export async function findDepositForLease(
  db: ReadDb,
  businessId: string,
  leaseId: string,
): Promise<DepositRow | undefined> {
  const rows = await db
    .select(DEPOSIT_COLUMNS)
    .from(deposit)
    .where(and(eq(deposit.businessId, businessId), eq(deposit.leaseId, leaseId)))
    .orderBy(desc(deposit.createdAt))
    .limit(1);
  return rows[0] as DepositRow | undefined;
}

export interface NewDepositMovement {
  id: string;
  businessId: string;
  depositId: string;
  movementType: "taken" | "topped_up" | "reduced" | "applied" | "refunded" | "retained";
  amountMinor: bigint;
  occurredOn: string;
  reason?: string;
  obligationId?: string;
  postedPeriodId: string;
  belongsToPeriodId?: string;
  createdBy?: string;
  replacesId?: string;
}

export async function insertDepositMovement(
  db: WriteDb,
  values: NewDepositMovement,
): Promise<void> {
  await db.insert(depositMovement).values(values);
}

export interface DepositMovementRow {
  id: string;
  depositId: string;
  movementType: "taken" | "topped_up" | "reduced" | "applied" | "refunded" | "retained";
  amountMinor: bigint;
  /** GAP-6/F-2.7: which obligation an `applied` movement settled — `voidDepositMovement` needs this to reverse `obligation.settled_minor` on void. */
  obligationId: string | null;
  voidedAt: string | null;
}

export interface DepositMovementHistoryRow extends DepositMovementRow {
  occurredOn: string;
  reason: string | null;
  voidedReason: string | null;
  /** GAP-173/W-35: the `period_start` of the period this movement belongs to, set only when it differs from the one it posted into. */
  belongsToPeriodStart: string | null;
}

/** F-6.8/UC-59 and UC-58: the deposit balance must be explainable from the movements, including voided corrections that stay visible in history. */
export async function listDepositMovementsForDeposit(
  db: ReadDb,
  businessId: string,
  depositId: string,
): Promise<DepositMovementHistoryRow[]> {
  const rows = await db
    .select({
      id: depositMovement.id,
      depositId: depositMovement.depositId,
      movementType: depositMovement.movementType,
      amountMinor: depositMovement.amountMinor,
      obligationId: depositMovement.obligationId,
      occurredOn: depositMovement.occurredOn,
      reason: depositMovement.reason,
      // GAP-173/W-35/F-8.1: non-null only for a late fact.
      belongsToPeriodStart: accountingPeriod.periodStart,
      voidedAt: depositMovement.voidedAt,
      voidedReason: depositMovement.voidedReason,
    })
    .from(depositMovement)
    .leftJoin(accountingPeriod, eq(depositMovement.belongsToPeriodId, accountingPeriod.id))
    .where(
      and(eq(depositMovement.businessId, businessId), eq(depositMovement.depositId, depositId)),
    )
    .orderBy(desc(depositMovement.occurredOn), desc(depositMovement.id));
  return rows as DepositMovementHistoryRow[];
}

/** GAP-12/W-61/INV-36 §3.3. Scoped by `businessId` — the same tenancy shape every P2+ read gets. */
export async function findDepositMovementForBusiness(
  db: ReadDb,
  businessId: string,
  movementId: string,
): Promise<DepositMovementRow | undefined> {
  const rows = await db
    .select({
      id: depositMovement.id,
      depositId: depositMovement.depositId,
      movementType: depositMovement.movementType,
      amountMinor: depositMovement.amountMinor,
      obligationId: depositMovement.obligationId,
      voidedAt: depositMovement.voidedAt,
    })
    .from(depositMovement)
    .where(and(eq(depositMovement.id, movementId), eq(depositMovement.businessId, businessId)))
    .limit(1);
  return rows[0] as DepositMovementRow | undefined;
}

/** GAP-12/W-61/INV-36 §3.3: void, never delete — the `voidExpense` shape, `WHERE … voided_at IS NULL` so a losing race is a no-op rather than a clobber. */
export async function voidDepositMovementRow(
  db: WriteDb,
  movementId: string,
  values: { voidedReason: string; voidedBy: string },
): Promise<{ voidedAt: string } | undefined> {
  const rows = await db
    .update(depositMovement)
    .set({ voidedAt: sql`now()`, voidedReason: values.voidedReason, voidedBy: values.voidedBy })
    .where(and(eq(depositMovement.id, movementId), isNull(depositMovement.voidedAt)))
    .returning({ voidedAt: depositMovement.voidedAt });
  return rows[0] as { voidedAt: string } | undefined;
}

/** GAP-12/W-61/INV-36 §3.4: `deposit.status`'s own recompute after a void — the newest surviving terminal (`refunded`/`retained`) movement, if any. `deposit.status` recomputes from this, falling back to `hold_window`/`held` when none remain (INV-35's archive guard depends on this never reading a status the void left stale). */
export async function findNewestLiveTerminalMovement(
  db: ReadDb,
  depositId: string,
): Promise<{ movementType: "refunded" | "retained" } | undefined> {
  const rows = await db
    .select({ movementType: depositMovement.movementType })
    .from(depositMovement)
    .where(
      and(
        eq(depositMovement.depositId, depositId),
        sql`${depositMovement.movementType} IN ('refunded', 'retained')`,
        isNull(depositMovement.voidedAt),
      ),
    )
    .orderBy(desc(depositMovement.id))
    .limit(1);
  return rows[0] as { movementType: "refunded" | "retained" } | undefined;
}

/** GAP-103: one `INSERT` for a whole opening-balance batch's `deposit_held` entries (IG §3.1) — each row's `depositId` already resolved by the caller before this runs, so the two bulk inserts (`insertDeposits`, this one) need no round trip between them. */
export async function insertDepositMovements(
  db: WriteDb,
  values: NewDepositMovement[],
): Promise<void> {
  if (values.length === 0) return;
  await db.insert(depositMovement).values(values);
}

/**
 * INV-4: money you hold, never income — the SUM of movements is the held
 * balance, so a taken/topped_up adds and a refunded/retained/applied draws
 * down. GAP-12/INV-36: `isNull(voidedAt)` — a voided movement (§3.3) must not
 * count, or the held balance stays wrong after the correction it was for.
 */
export async function sumDepositMovements(db: ReadDb, depositId: string): Promise<bigint> {
  const rows = await db
    .select({
      movementType: depositMovement.movementType,
      amountMinor: depositMovement.amountMinor,
    })
    .from(depositMovement)
    .where(and(eq(depositMovement.depositId, depositId), isNull(depositMovement.voidedAt)));

  const ADDS = new Set(["taken", "topped_up"]);
  return rows.reduce(
    (sum, row) => (ADDS.has(row.movementType) ? sum + row.amountMinor : sum - row.amountMinor),
    0n,
  );
}

/** GAP-103: a correction needs the original opening-balance movement's own amount to post an equal, opposite one — read by id directly, unfiltered by `voided_*`, since the caller already knows which exact row it means to reverse. */
export async function findDepositMovementAmount(
  db: ReadDb,
  movementId: string,
): Promise<bigint | undefined> {
  const rows = await db
    .select({ amountMinor: depositMovement.amountMinor })
    .from(depositMovement)
    .where(eq(depositMovement.id, movementId))
    .limit(1);
  return rows[0]?.amountMinor;
}

export async function updateDepositStatus(
  db: WriteDb,
  depositId: string,
  status: DepositRow["status"],
  holdReleaseDate?: string,
): Promise<void> {
  await db
    .update(deposit)
    .set({ status, ...(holdReleaseDate !== undefined ? { holdReleaseDate } : {}) })
    .where(eq(deposit.id, depositId));
}

export interface NewOffsetRecord {
  id: string;
  businessId: string;
  driverId: string;
  amountMinor: bigint;
  occurredOn: string;
  note?: string;
  postedPeriodId: string;
  belongsToPeriodId?: string;
  createdBy: string;
  replacesId?: string;
}

/** W-2/UC-56: the ONLY thing that moves both driver balances (INV-3). */
export async function insertOffsetRecord(db: WriteDb, values: NewOffsetRecord): Promise<void> {
  await db.insert(offsetRecord).values(values);
}

export interface OffsetRecordRow {
  id: string;
  amountMinor: bigint;
  occurredOn: string;
  voidedAt: string | null;
  voidedReason: string | null;
}

/** F-6.8/UC-59: the linked driver's own offsets, windowed by `occurredOn`. */
export async function listOffsetsForDriver(
  db: ReadDb,
  businessId: string,
  driverId: string,
  from: string,
  to: string,
): Promise<OffsetRecordRow[]> {
  const rows = await db
    .select({
      id: offsetRecord.id,
      amountMinor: offsetRecord.amountMinor,
      occurredOn: offsetRecord.occurredOn,
      voidedAt: offsetRecord.voidedAt,
      voidedReason: offsetRecord.voidedReason,
    })
    .from(offsetRecord)
    .where(
      and(
        eq(offsetRecord.businessId, businessId),
        eq(offsetRecord.driverId, driverId),
        gte(offsetRecord.occurredOn, from),
        lte(offsetRecord.occurredOn, to),
      ),
    );
  return rows;
}

export interface NewOffsetAllocation {
  id: string;
  offsetId: string;
  obligationId: string;
  amountMinor: bigint;
}

/** Which specific obligations, on each side, this offset actually settled — oldest-first (§6.5's allocation discipline), so "which dues did that offset cover" stays answerable. */
export async function insertOffsetAllocation(
  db: WriteDb,
  values: NewOffsetAllocation,
): Promise<void> {
  await db.insert(offsetAllocation).values(values);
}

export interface OffsetRecordForVoid {
  id: string;
  driverId: string;
  amountMinor: bigint;
  voidedAt: string | null;
}

/** GAP-12/W-61/INV-36 §3.2. Scoped by `businessId` — the same tenancy shape every P2+ read gets. */
export async function findOffsetRecordForBusiness(
  db: ReadDb,
  businessId: string,
  offsetId: string,
): Promise<OffsetRecordForVoid | undefined> {
  const rows = await db
    .select({
      id: offsetRecord.id,
      driverId: offsetRecord.driverId,
      amountMinor: offsetRecord.amountMinor,
      voidedAt: offsetRecord.voidedAt,
    })
    .from(offsetRecord)
    .where(and(eq(offsetRecord.id, offsetId), eq(offsetRecord.businessId, businessId)))
    .limit(1);
  return rows[0];
}

/** GAP-12/W-61/INV-36 §3.2: `voidOffset`'s own read — every live allocation this offset made, on either side, migration 0024's void trio now makes reversible. */
export async function findLiveOffsetAllocations(
  db: ReadDb,
  offsetId: string,
): Promise<Array<{ id: string; obligationId: string; amountMinor: bigint }>> {
  const rows = await db
    .select({
      id: offsetAllocation.id,
      obligationId: offsetAllocation.obligationId,
      amountMinor: offsetAllocation.amountMinor,
    })
    .from(offsetAllocation)
    .where(and(eq(offsetAllocation.offsetId, offsetId), isNull(offsetAllocation.voidedAt)));
  return rows;
}

/** GAP-12/W-61/INV-36 §3.2, migration 0024: void, never delete — `WHERE … voided_at IS NULL` so a losing race is a no-op rather than a clobber, the same house pattern every other void in this codebase carries. */
export async function voidOffsetAllocationRow(
  db: WriteDb,
  allocationId: string,
  values: { voidedReason: string; voidedBy: string },
): Promise<void> {
  await db
    .update(offsetAllocation)
    .set({ voidedAt: sql`now()`, voidedReason: values.voidedReason, voidedBy: values.voidedBy })
    .where(and(eq(offsetAllocation.id, allocationId), isNull(offsetAllocation.voidedAt)));
}

/** GAP-12/W-61/INV-36 §3.2: void, never delete — the `voidExpense` shape, `WHERE … voided_at IS NULL` so a losing race is a no-op rather than a clobber. */
export async function voidOffsetRecordRow(
  db: WriteDb,
  offsetId: string,
  values: { voidedReason: string; voidedBy: string },
): Promise<{ voidedAt: string } | undefined> {
  const rows = await db
    .update(offsetRecord)
    .set({ voidedAt: sql`now()`, voidedReason: values.voidedReason, voidedBy: values.voidedBy })
    .where(and(eq(offsetRecord.id, offsetId), isNull(offsetRecord.voidedAt)))
    .returning({ voidedAt: offsetRecord.voidedAt });
  return rows[0] as { voidedAt: string } | undefined;
}
