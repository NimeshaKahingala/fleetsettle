import { and, eq, isNull, sql } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import { adjustment } from "../db/schema.js";

type WriteDb = Writer | Tx;
type ReadDb = Reader | Writer | Tx;

export interface NewAdjustment {
  id: string;
  businessId: string;
  obligationId: string;
  adjustmentType: string;
  amountMinor: bigint;
  sign: -1 | 1;
  reason?: string;
  occurredOn: string; // GAP-73, migration 0017
  postedPeriodId: string;
  belongsToPeriodId?: string;
  createdBy?: string;
}

/** DM §10.3. Never a deletion — a waiver is a recorded adjustment (UC-15). */
export async function insertAdjustment(db: WriteDb, values: NewAdjustment): Promise<void> {
  await db.insert(adjustment).values(values);
}

export interface AdjustmentRow {
  id: string;
  obligationId: string;
  adjustmentType: string;
  amountMinor: bigint;
  sign: -1 | 1;
  voidedAt: string | null;
}

/** GAP-12/W-61/INV-36 §3.1. Scoped by `businessId` — the same tenancy shape every P2+ read gets. */
export async function findAdjustmentForBusiness(
  db: ReadDb,
  businessId: string,
  adjustmentId: string,
): Promise<AdjustmentRow | undefined> {
  const rows = await db
    .select({
      id: adjustment.id,
      obligationId: adjustment.obligationId,
      adjustmentType: adjustment.adjustmentType,
      amountMinor: adjustment.amountMinor,
      sign: adjustment.sign,
      voidedAt: adjustment.voidedAt,
    })
    .from(adjustment)
    .where(and(eq(adjustment.id, adjustmentId), eq(adjustment.businessId, businessId)))
    .limit(1);
  return rows[0] as AdjustmentRow | undefined;
}

/** GAP-12/W-61/INV-36 §3.1: void, never delete — the `voidExpense` shape, `WHERE … voided_at IS NULL` so a losing race is a no-op rather than a clobber. */
export async function voidAdjustmentRow(
  db: WriteDb,
  adjustmentId: string,
  values: { voidedReason: string; voidedBy: string },
): Promise<{ voidedAt: string } | undefined> {
  const rows = await db
    .update(adjustment)
    .set({ voidedAt: sql`now()`, voidedReason: values.voidedReason, voidedBy: values.voidedBy })
    .where(and(eq(adjustment.id, adjustmentId), isNull(adjustment.voidedAt)))
    .returning({ voidedAt: adjustment.voidedAt });
  return rows[0] as { voidedAt: string } | undefined;
}
