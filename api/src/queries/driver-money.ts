import { and, desc, eq, gte, isNull, lte, ne } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import {
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
}

/** UC-53. Not a cost — reconciled to zero, and INV-17 blocks trip closure until it is. */
export async function insertAdvance(db: WriteDb, values: NewAdvance): Promise<void> {
  await db.insert(advance).values({ ...values, status: "open" });
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
}

export async function insertAdvanceSettlement(
  db: WriteDb,
  values: NewAdvanceSettlement,
): Promise<void> {
  await db.insert(advanceSettlement).values(values);
}

/** The advance closes at zero (UC-53) — the running total of every settlement recorded against it so far. */
export async function sumSettledForAdvance(db: ReadDb, advanceId: string): Promise<bigint> {
  const rows = await db
    .select({ amountMinor: advanceSettlement.amountMinor })
    .from(advanceSettlement)
    .where(eq(advanceSettlement.advanceId, advanceId));
  return rows.reduce((sum, row) => sum + row.amountMinor, 0n);
}

export async function updateAdvanceStatus(
  db: WriteDb,
  advanceId: string,
  status: "open" | "part_settled" | "settled",
): Promise<void> {
  await db.update(advance).set({ status }).where(eq(advance.id, advanceId));
}

export interface NewDeposit {
  id: string;
  businessId: string;
  partyDriverId: string;
}

/** F-6.7/UC-58/W-8. One `deposit` row per driver arrangement — the balance is the SUM of its movements (DM §10.4), never a stored figure to drift. */
export async function insertDeposit(db: WriteDb, values: NewDeposit): Promise<void> {
  await db.insert(deposit).values({ ...values, partyType: "driver", status: "held" });
}

export interface DepositRow {
  id: string;
  businessId: string;
  partyDriverId: string | null;
  status: "held" | "hold_window" | "released" | "applied" | "retained";
}

/** The one deposit currently held for this driver — DM §10.4 makes no promise there's ever more than one live at a time; this reads whichever isn't yet released or retained. */
export async function findHeldDepositForDriver(
  db: ReadDb,
  businessId: string,
  driverId: string,
): Promise<DepositRow | undefined> {
  const rows = await db
    .select({
      id: deposit.id,
      businessId: deposit.businessId,
      partyDriverId: deposit.partyDriverId,
      status: deposit.status,
    })
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

export async function findDepositForBusiness(
  db: ReadDb,
  businessId: string,
  depositId: string,
): Promise<DepositRow | undefined> {
  const rows = await db
    .select({
      id: deposit.id,
      businessId: deposit.businessId,
      partyDriverId: deposit.partyDriverId,
      status: deposit.status,
    })
    .from(deposit)
    .where(and(eq(deposit.id, depositId), eq(deposit.businessId, businessId)))
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
}

export async function insertDepositMovement(
  db: WriteDb,
  values: NewDepositMovement,
): Promise<void> {
  await db.insert(depositMovement).values(values);
}

/** INV-4: money you hold, never income — the SUM of movements is the held balance, so a taken/topped_up adds and a refunded/retained/applied draws down. */
export async function sumDepositMovements(db: ReadDb, depositId: string): Promise<bigint> {
  const rows = await db
    .select({
      movementType: depositMovement.movementType,
      amountMinor: depositMovement.amountMinor,
    })
    .from(depositMovement)
    .where(eq(depositMovement.depositId, depositId));

  const ADDS = new Set(["taken", "topped_up"]);
  return rows.reduce(
    (sum, row) => (ADDS.has(row.movementType) ? sum + row.amountMinor : sum - row.amountMinor),
    0n,
  );
}

export async function updateDepositStatus(
  db: WriteDb,
  depositId: string,
  status: DepositRow["status"],
): Promise<void> {
  await db.update(deposit).set({ status }).where(eq(deposit.id, depositId));
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
}

/** W-2/UC-56: the ONLY thing that moves both driver balances (INV-3). */
export async function insertOffsetRecord(db: WriteDb, values: NewOffsetRecord): Promise<void> {
  await db.insert(offsetRecord).values(values);
}

export interface OffsetRecordRow {
  id: string;
  amountMinor: bigint;
  occurredOn: string;
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
