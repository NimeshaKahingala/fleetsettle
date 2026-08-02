import { and, eq, isNull, sql } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import { expense } from "../db/schema.js";

type WriteDb = Writer | Tx;
type ReadDb = Reader | Writer | Tx;

export interface NewExpense {
  id: string;
  businessId: string;
  vehicleId?: string;
  tripId?: string;
  category: string;
  amountMinor: bigint;
  spentOn: string;
  borneBy: "us" | "driver" | "customer";
  borneByDriverId?: string;
  borneByCustomerId?: string;
  paidByUserId?: string;
  litres?: number;
  note?: string;
  postedPeriodId: string;
  belongsToPeriodId?: string;
  createdBy?: string;
}

/** DM §9. `spent_on` is a real date, not the write's timestamp — an expense entered days late is still dated when it happened. */
export async function insertExpense(db: WriteDb, values: NewExpense): Promise<void> {
  await db.insert(expense).values(values);
}

export interface TripCostByCategory {
  category: string;
  amountMinor: bigint;
}

/** F-5.4/UC-44: "costs by type" — only `borne_by = 'us'` reaches trip profit (INV-5); a driver- or customer-borne cost is informational, never inside this sum. */
export async function sumTripCostsByCategory(
  db: ReadDb,
  tripId: string,
): Promise<TripCostByCategory[]> {
  const rows = await db
    .select({
      category: expense.category,
      amountMinor: sql<string>`SUM(${expense.amountMinor})`,
    })
    .from(expense)
    .where(and(eq(expense.tripId, tripId), eq(expense.borneBy, "us"), isNull(expense.voidedAt)))
    .groupBy(expense.category);
  return rows.map((r) => ({ category: r.category, amountMinor: BigInt(r.amountMinor) }));
}

/** F-5.4/UC-44: fuel efficiency needs litres, not amount spent — "not available" when none were logged (W-56), never zero. */
export async function sumTripFuelLitres(db: ReadDb, tripId: string): Promise<number | null> {
  const rows = await db
    .select({ litres: sql<string | null>`SUM(${expense.litres})` })
    .from(expense)
    .where(and(eq(expense.tripId, tripId), eq(expense.category, "fuel"), isNull(expense.voidedAt)));
  const total = rows[0]?.litres;
  // eslint-disable-next-line no-restricted-syntax -- litres, a fuel volume, not money
  return total === null || total === undefined ? null : Number(total);
}
