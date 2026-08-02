import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import { obligation } from "../db/schema.js";

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
}

/** DM §10.1: everything anyone owes anyone. `settledMinor`/`status` are supplied already-correct by the caller — this endpoint's writes never need a follow-up UPDATE (CLAUDE.md → Writes: one transaction). */
export async function insertObligation(db: WriteDb, values: NewObligation): Promise<void> {
  await db.insert(obligation).values(values);
}

export interface ObligationRow {
  id: string;
  amountMinor: bigint;
  settledMinor: bigint;
  status: string;
}

/** A day_record's obligation — `source_type = 'day_record'` (DM §10.1) — read back for the idempotent no-op response. */
export async function findObligationBySource(
  db: ReadDb,
  sourceType: string,
  sourceId: string,
): Promise<ObligationRow | undefined> {
  const rows = await db
    .select({
      id: obligation.id,
      amountMinor: obligation.amountMinor,
      settledMinor: obligation.settledMinor,
      status: obligation.status,
    })
    .from(obligation)
    .where(and(eq(obligation.sourceType, sourceType), eq(obligation.sourceId, sourceId)))
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
  amountMinor: bigint;
  settledMinor: bigint;
  waivedMinor: bigint;
}

/** Oldest-`due_on`-first (§6.5's allocation discipline) — the obligations an offset (or a future generic settle) draws down against, one direction at a time. */
export async function findOutstandingObligationsForDriver(
  db: ReadDb,
  businessId: string,
  driverId: string,
  direction: "owed_to_us" | "owed_by_us",
): Promise<OutstandingObligation[]> {
  const rows = await db
    .select({
      id: obligation.id,
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
  return rows;
}

/** §6.5's allocation discipline, generalised to any party — F-2.2's generic payment collection draws down a customer's `owed_to_us` obligations the same oldest-first way the driver-scoped query above already does. */
export async function findOutstandingObligationsForParty(
  db: ReadDb,
  businessId: string,
  partyType: "customer" | "driver" | "partner",
  partyId: string,
  direction: "owed_to_us" | "owed_by_us",
): Promise<OutstandingObligation[]> {
  const partyColumn =
    partyType === "customer"
      ? obligation.partyCustomerId
      : partyType === "driver"
        ? obligation.partyDriverId
        : obligation.partyUserId;

  const rows = await db
    .select({
      id: obligation.id,
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
  return rows;
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
