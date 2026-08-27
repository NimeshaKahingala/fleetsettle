import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import { payment, writeOff, writeOffRecovery } from "../db/schema.js";

type WriteDb = Writer | Tx;
type ReadDb = Reader | Writer | Tx;

export interface NewWriteOff {
  id: string;
  businessId: string;
  obligationId?: string;
  partyType: "customer" | "driver";
  partyCustomerId?: string;
  partyDriverId?: string;
  vehicleId?: string;
  amountMinor: bigint;
  reason: string;
  writtenOffOn: string;
  postedPeriodId: string;
  belongsToPeriodId?: string;
  createdBy?: string;
  replacesId?: string;
}

/** F-8.3/UC-90/W-28. */
export async function insertWriteOff(db: WriteDb, values: NewWriteOff): Promise<void> {
  await db.insert(writeOff).values(values);
}

export interface WriteOffRow {
  id: string;
  obligationId: string | null;
  partyType: "customer" | "driver";
  partyCustomerId: string | null;
  partyDriverId: string | null;
  vehicleId: string | null;
  amountMinor: bigint;
  reason: string;
  writtenOffOn: string;
  voidedAt: string | null;
  replacesId: string | null;
}

/**
 * Scoped by `businessId` — the same tenancy shape every P2+ read gets.
 *
 * GAP-190/B12: `forUpdate` locks the row for the caller's own transaction —
 * `recordWriteOffRecovery` and `voidWriteOff` both take it now, on the same
 * "lock the parent" reasoning `deposit.ts`'s own `FOR UPDATE` comment
 * explains: a plain read proves nothing about what a concurrent transaction
 * is about to insert against this write-off.
 */
export async function findWriteOffForBusiness(
  db: ReadDb,
  businessId: string,
  writeOffId: string,
  forUpdate = false,
): Promise<WriteOffRow | undefined> {
  const query = db
    .select({
      id: writeOff.id,
      obligationId: writeOff.obligationId,
      partyType: writeOff.partyType,
      partyCustomerId: writeOff.partyCustomerId,
      partyDriverId: writeOff.partyDriverId,
      vehicleId: writeOff.vehicleId,
      amountMinor: writeOff.amountMinor,
      reason: writeOff.reason,
      writtenOffOn: writeOff.writtenOffOn,
      voidedAt: writeOff.voidedAt,
      replacesId: writeOff.replacesId,
    })
    .from(writeOff)
    .where(and(eq(writeOff.id, writeOffId), eq(writeOff.businessId, businessId)))
    .limit(1);
  const rows = await (forUpdate ? query.for("update") : query);
  return rows[0] as WriteOffRow | undefined;
}

export interface WriteOffListRow {
  id: string;
  obligationId: string | null;
  partyType: "customer" | "driver";
  partyCustomerId: string | null;
  partyDriverId: string | null;
  vehicleId: string | null;
  amountMinor: bigint;
  reason: string;
  writtenOffOn: string;
  voidedAt: string | null;
  voidedReason: string | null;
  replacesId: string | null;
}

export interface WriteOffListFilters {
  partyType?: "customer" | "driver";
  partyCustomerId?: string;
  partyDriverId?: string;
  vehicleId?: string;
  from?: string;
  to?: string;
}

/**
 * A3: every write-off this business has ever recorded — every filter
 * optional, newest first. Voided rows stay in, struck through by the caller
 * with their reason (W-50), the same convention `listExpensesForBusiness`
 * already established — GAP-12/A9b built the void endpoint that sets
 * `voided_at` on this table.
 */
export async function listWriteOffsForBusiness(
  db: ReadDb,
  businessId: string,
  filters: WriteOffListFilters,
): Promise<WriteOffListRow[]> {
  const rows = await db
    .select({
      id: writeOff.id,
      obligationId: writeOff.obligationId,
      partyType: writeOff.partyType,
      partyCustomerId: writeOff.partyCustomerId,
      partyDriverId: writeOff.partyDriverId,
      vehicleId: writeOff.vehicleId,
      amountMinor: writeOff.amountMinor,
      reason: writeOff.reason,
      writtenOffOn: writeOff.writtenOffOn,
      voidedAt: writeOff.voidedAt,
      voidedReason: writeOff.voidedReason,
      replacesId: writeOff.replacesId,
    })
    .from(writeOff)
    .where(
      and(
        eq(writeOff.businessId, businessId),
        filters.partyType !== undefined ? eq(writeOff.partyType, filters.partyType) : undefined,
        filters.partyCustomerId !== undefined
          ? eq(writeOff.partyCustomerId, filters.partyCustomerId)
          : undefined,
        filters.partyDriverId !== undefined
          ? eq(writeOff.partyDriverId, filters.partyDriverId)
          : undefined,
        filters.vehicleId !== undefined ? eq(writeOff.vehicleId, filters.vehicleId) : undefined,
        filters.from !== undefined ? gte(writeOff.writtenOffOn, filters.from) : undefined,
        filters.to !== undefined ? lte(writeOff.writtenOffOn, filters.to) : undefined,
      ),
    )
    .orderBy(desc(writeOff.writtenOffOn), desc(writeOff.id));
  return rows as WriteOffListRow[];
}

/** GAP-12/W-61/INV-36 §3.7: void, never delete — the `voidExpense` shape, `WHERE … voided_at IS NULL` so a losing race is a no-op rather than a clobber. */
export async function voidWriteOffRow(
  db: WriteDb,
  writeOffId: string,
  values: { voidedReason: string; voidedBy: string },
): Promise<{ voidedAt: string } | undefined> {
  const rows = await db
    .update(writeOff)
    .set({ voidedAt: sql`now()`, voidedReason: values.voidedReason, voidedBy: values.voidedBy })
    .where(and(eq(writeOff.id, writeOffId), isNull(writeOff.voidedAt)))
    .returning({ voidedAt: writeOff.voidedAt });
  return rows[0] as { voidedAt: string } | undefined;
}

/** GAP-12/W-61/INV-36 §3.7: `voidWriteOff`'s own refuse-guard — every live recovery against this write-off, each its own entered act (§2), named in the refusal. */
export async function findLiveRecoveriesForWriteOff(
  db: ReadDb,
  writeOffId: string,
): Promise<Array<{ id: string; amountMinor: bigint }>> {
  const rows = await db
    .select({ id: writeOffRecovery.id, amountMinor: writeOffRecovery.amountMinor })
    .from(writeOffRecovery)
    .where(and(eq(writeOffRecovery.writeOffId, writeOffId), isNull(writeOffRecovery.voidedAt)));
  return rows;
}

export interface NewWriteOffRecovery {
  id: string;
  businessId: string;
  writeOffId: string;
  paymentId: string;
  amountMinor: bigint;
  postedPeriodId: string;
  belongsToPeriodId?: string;
  replacesId?: string;
}

/** INV-15: nets against the write-off it recovers — never fresh income. */
export async function insertWriteOffRecovery(
  db: WriteDb,
  values: NewWriteOffRecovery,
): Promise<void> {
  await db.insert(writeOffRecovery).values(values);
}

export interface WriteOffRecoveryRow {
  id: string;
  writeOffId: string;
  paymentId: string;
  amountMinor: bigint;
  voidedAt: string | null;
  replacesId: string | null;
}

/** GAP-12/W-61/INV-36 §3.8. Scoped by `businessId` — the same tenancy shape every P2+ read gets. */
export async function findWriteOffRecoveryForBusiness(
  db: ReadDb,
  businessId: string,
  recoveryId: string,
): Promise<WriteOffRecoveryRow | undefined> {
  const rows = await db
    .select({
      id: writeOffRecovery.id,
      writeOffId: writeOffRecovery.writeOffId,
      paymentId: writeOffRecovery.paymentId,
      amountMinor: writeOffRecovery.amountMinor,
      voidedAt: writeOffRecovery.voidedAt,
      replacesId: writeOffRecovery.replacesId,
    })
    .from(writeOffRecovery)
    .where(and(eq(writeOffRecovery.id, recoveryId), eq(writeOffRecovery.businessId, businessId)))
    .limit(1);
  return rows[0];
}

export interface WriteOffRecoveryListRow {
  id: string;
  writeOffId: string;
  paymentId: string;
  amountMinor: bigint;
  occurredOn: string;
  voidedAt: string | null;
  voidedReason: string | null;
  replacesId: string | null;
}

/**
 * GAP-147: every recovery ever recorded against one write-off, newest
 * first — the read a manager needs to find one to void, the same
 * reachability gap GAP-155 closed for write-offs themselves. `occurredOn`
 * has no column on `write_off_recovery` (INV-15: recorded through the
 * ordinary payment mechanism, deliberately never a fact of its own) — an
 * inner join is exact, never a guess, because `payment_id` is `NOT NULL`
 * and every recovery mints exactly one payment (`recordWriteOffRecovery`,
 * same transaction).
 */
export async function listWriteOffRecoveriesForWriteOff(
  db: ReadDb,
  businessId: string,
  writeOffId: string,
): Promise<WriteOffRecoveryListRow[]> {
  return db
    .select({
      id: writeOffRecovery.id,
      writeOffId: writeOffRecovery.writeOffId,
      paymentId: writeOffRecovery.paymentId,
      amountMinor: writeOffRecovery.amountMinor,
      occurredOn: payment.occurredOn,
      voidedAt: writeOffRecovery.voidedAt,
      voidedReason: writeOffRecovery.voidedReason,
      replacesId: writeOffRecovery.replacesId,
    })
    .from(writeOffRecovery)
    .innerJoin(payment, eq(payment.id, writeOffRecovery.paymentId))
    .where(
      and(eq(writeOffRecovery.businessId, businessId), eq(writeOffRecovery.writeOffId, writeOffId)),
    )
    .orderBy(desc(payment.occurredOn), desc(writeOffRecovery.id));
}

/** GAP-12/W-61/INV-36 §3.8: void, never delete — the `voidExpense` shape, `WHERE … voided_at IS NULL` so a losing race is a no-op rather than a clobber. */
export async function voidWriteOffRecoveryRow(
  db: WriteDb,
  recoveryId: string,
  values: { voidedReason: string; voidedBy: string },
): Promise<{ voidedAt: string } | undefined> {
  const rows = await db
    .update(writeOffRecovery)
    .set({ voidedAt: sql`now()`, voidedReason: values.voidedReason, voidedBy: values.voidedBy })
    .where(and(eq(writeOffRecovery.id, recoveryId), isNull(writeOffRecovery.voidedAt)))
    .returning({ voidedAt: writeOffRecovery.voidedAt });
  return rows[0] as { voidedAt: string } | undefined;
}
