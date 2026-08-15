import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import { expense, odometerReading } from "../db/schema.js";

type WriteDb = Writer | Tx;
type ReadDb = Reader | Writer | Tx;

export interface NewExpense {
  id: string;
  businessId: string;
  vehicleId?: string;
  tripId?: string;
  incidentId?: string;
  category: string;
  amountMinor: bigint;
  spentOn: string;
  borneBy: "us" | "driver" | "customer";
  borneByDriverId?: string;
  borneByCustomerId?: string;
  paidByUserId?: string;
  litres?: number;
  odometerReadingId?: string;
  note?: string;
  postedPeriodId: string;
  belongsToPeriodId?: string;
  createdBy?: string;
  replacesId?: string;
}

/** DM §9. `spent_on` is a real date, not the write's timestamp — an expense entered days late is still dated when it happened. */
export async function insertExpense(db: WriteDb, values: NewExpense): Promise<void> {
  await db.insert(expense).values(values);
}

export interface ExpenseRow {
  id: string;
  amountMinor: bigint;
  postedPeriodId: string;
  voidedAt: string | null;
}

/** F-8.5/UC-96. Scoped by `businessId` — the same tenancy shape every P2+ read gets. */
export async function findExpenseForBusiness(
  db: ReadDb,
  businessId: string,
  expenseId: string,
): Promise<ExpenseRow | undefined> {
  const rows = await db
    .select({
      id: expense.id,
      amountMinor: expense.amountMinor,
      postedPeriodId: expense.postedPeriodId,
      voidedAt: expense.voidedAt,
    })
    .from(expense)
    .where(and(eq(expense.id, expenseId), eq(expense.businessId, businessId)))
    .limit(1);
  return rows[0];
}

/**
 * F-8.5/UC-96/W-50: void, never delete — `posted_period_id` is deliberately
 * untouched, since a void is a correction to *this* row, not a repost into
 * a different period. It is still refused once that period has closed
 * (migration 0008/GAP-35): `assert_period_open()` treats the resulting
 * `voided_at` transition as a post in its own right, on top of 0006's
 * "an update that never touches `posted_period_id` succeeds". "Replace" is
 * recording a fresh, correct expense afterward through the ordinary create
 * endpoint, `replacesId` set — GAP-60/D-16's `replaces_id` column links the
 * two formally; the void itself never writes it (`createExpense` does).
 */
export async function voidExpenseRow(
  db: WriteDb,
  expenseId: string,
  values: { voidedReason: string; voidedBy: string },
): Promise<{ voidedAt: string }> {
  const rows = await db
    .update(expense)
    .set({ voidedAt: sql`now()`, voidedReason: values.voidedReason, voidedBy: values.voidedBy })
    .where(eq(expense.id, expenseId))
    .returning({ voidedAt: expense.voidedAt });
  // `voidedAt` is written by the SET above, in the same statement — never null on the row this WHERE just matched.
  return rows[0] as { voidedAt: string };
}

export interface VehicleExpenseRow {
  id: string;
  tripId: string | null;
  incidentId: string | null;
  category:
    | "fuel"
    | "tolls"
    | "fines"
    | "cleaning"
    | "tyres"
    | "servicing"
    | "repairs"
    | "insurance"
    | "licence"
    | "crew_food"
    | "permits"
    | "office"
    | "legal"
    | "messaging"
    | "other";
  amountMinor: bigint;
  spentOn: string;
  borneBy: "us" | "driver" | "customer";
  borneByDriverId: string | null;
  borneByCustomerId: string | null;
  paidByUserId: string | null;
  litres: number | null;
  note: string | null;
  voidedAt: string | null;
  voidedReason: string | null;
}

/** Vehicle overview's costs tab (Web-P5): every expense logged against this vehicle, voided ones included and struck through by the caller (W-50) — never filtered out, since "what did we spend" must still show what was later corrected. Newest first. */
export async function listExpensesForVehicle(
  db: ReadDb,
  businessId: string,
  vehicleId: string,
): Promise<VehicleExpenseRow[]> {
  const rows = await db
    .select({
      id: expense.id,
      tripId: expense.tripId,
      incidentId: expense.incidentId,
      category: expense.category,
      amountMinor: expense.amountMinor,
      spentOn: expense.spentOn,
      borneBy: expense.borneBy,
      borneByDriverId: expense.borneByDriverId,
      borneByCustomerId: expense.borneByCustomerId,
      paidByUserId: expense.paidByUserId,
      litres: expense.litres,
      note: expense.note,
      voidedAt: expense.voidedAt,
      voidedReason: expense.voidedReason,
    })
    .from(expense)
    .where(and(eq(expense.businessId, businessId), eq(expense.vehicleId, vehicleId)))
    .orderBy(desc(expense.spentOn));
  return rows as VehicleExpenseRow[];
}

/**
 * F-3.5/UC-13/GAP-68: the baseline the maintenance prompt compares the
 * vehicle's latest odometer reading against — the reading linked to this
 * vehicle's own most recent live `servicing` expense. `undefined` when none
 * has ever been recorded with a reading attached — the prompt has nothing
 * to compare against yet, and W-56 says that is "not available", not zero.
 */
export async function findLastMaintenanceOdometerKm(
  db: ReadDb,
  vehicleId: string,
): Promise<number | undefined> {
  const rows = await db
    .select({ readingKm: odometerReading.readingKm })
    .from(expense)
    .innerJoin(odometerReading, eq(odometerReading.id, expense.odometerReadingId))
    .where(
      and(
        eq(expense.vehicleId, vehicleId),
        eq(expense.category, "servicing"),
        isNull(expense.voidedAt),
      ),
    )
    .orderBy(desc(expense.spentOn), desc(expense.createdAt))
    .limit(1);
  return rows[0]?.readingKm;
}

export interface BusinessExpenseRow {
  id: string;
  vehicleId: string | null;
  tripId: string | null;
  incidentId: string | null;
  category:
    | "fuel"
    | "tolls"
    | "fines"
    | "cleaning"
    | "tyres"
    | "servicing"
    | "repairs"
    | "insurance"
    | "licence"
    | "crew_food"
    | "permits"
    | "office"
    | "legal"
    | "messaging"
    | "other";
  amountMinor: bigint;
  spentOn: string;
  borneBy: "us" | "driver" | "customer";
  borneByDriverId: string | null;
  borneByCustomerId: string | null;
  paidByUserId: string | null;
  litres: number | null;
  odometerReadingId: string | null;
  note: string | null;
  voidedAt: string | null;
  voidedReason: string | null;
  replacesId: string | null;
}

export interface ExpenseFilters {
  vehicleId?: string;
  tripId?: string;
  incidentId?: string;
  category?: string;
  from?: string;
  to?: string;
}

/**
 * Web-P8b's costs list (F-3.1): every filter optional — no scope beyond
 * `businessId` is required, generalising `listExpensesForVehicle`/
 * `-Trip`/`-Incident`'s single-scope shape into one query with all of theirs
 * as optional narrowing. Voided rows stay in, struck through by the caller
 * (W-50), the same convention those three already established. Newest
 * first, `id` as the tie-break within a date (UUIDv7 sorts by time).
 */
export async function listExpensesForBusiness(
  db: ReadDb,
  businessId: string,
  filters: ExpenseFilters,
): Promise<BusinessExpenseRow[]> {
  const rows = await db
    .select({
      id: expense.id,
      vehicleId: expense.vehicleId,
      tripId: expense.tripId,
      incidentId: expense.incidentId,
      category: expense.category,
      amountMinor: expense.amountMinor,
      spentOn: expense.spentOn,
      borneBy: expense.borneBy,
      borneByDriverId: expense.borneByDriverId,
      borneByCustomerId: expense.borneByCustomerId,
      paidByUserId: expense.paidByUserId,
      litres: expense.litres,
      odometerReadingId: expense.odometerReadingId,
      note: expense.note,
      voidedAt: expense.voidedAt,
      voidedReason: expense.voidedReason,
      replacesId: expense.replacesId,
    })
    .from(expense)
    .where(
      and(
        eq(expense.businessId, businessId),
        filters.vehicleId !== undefined ? eq(expense.vehicleId, filters.vehicleId) : undefined,
        filters.tripId !== undefined ? eq(expense.tripId, filters.tripId) : undefined,
        filters.incidentId !== undefined ? eq(expense.incidentId, filters.incidentId) : undefined,
        filters.category !== undefined ? eq(expense.category, filters.category) : undefined,
        filters.from !== undefined ? gte(expense.spentOn, filters.from) : undefined,
        filters.to !== undefined ? lte(expense.spentOn, filters.to) : undefined,
      ),
    )
    .orderBy(desc(expense.spentOn), desc(expense.id));
  return rows as BusinessExpenseRow[];
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

export interface TripExpenseRow {
  id: string;
  vehicleId: string | null;
  incidentId: string | null;
  category:
    | "fuel"
    | "tolls"
    | "fines"
    | "cleaning"
    | "tyres"
    | "servicing"
    | "repairs"
    | "insurance"
    | "licence"
    | "crew_food"
    | "permits"
    | "office"
    | "legal"
    | "messaging"
    | "other";
  amountMinor: bigint;
  spentOn: string;
  borneBy: "us" | "driver" | "customer";
  borneByDriverId: string | null;
  borneByCustomerId: string | null;
  paidByUserId: string | null;
  litres: number | null;
  note: string | null;
  voidedAt: string | null;
  voidedReason: string | null;
}

/**
 * Web-P7's open-trip screen: every cost logged against this trip so far —
 * not filtered to `borne_by = 'us'` the way `sumTripCostsByCategory` (the
 * P&L's own sum) is, and voided rows stay in, struck through by the caller
 * (W-50) — the same "never hidden, never silently swapped" convention
 * `listExpensesForVehicle` already established, applied to a trip instead
 * of a vehicle. Called only after the handler has already confirmed the
 * trip belongs to this business (`findTripForBusiness`), the same trust
 * boundary `sumTripCostsByCategory` already relies on from `closeTrip`.
 */
export async function listExpensesForTrip(db: ReadDb, tripId: string): Promise<TripExpenseRow[]> {
  const rows = await db
    .select({
      id: expense.id,
      vehicleId: expense.vehicleId,
      incidentId: expense.incidentId,
      category: expense.category,
      amountMinor: expense.amountMinor,
      spentOn: expense.spentOn,
      borneBy: expense.borneBy,
      borneByDriverId: expense.borneByDriverId,
      borneByCustomerId: expense.borneByCustomerId,
      paidByUserId: expense.paidByUserId,
      litres: expense.litres,
      note: expense.note,
      voidedAt: expense.voidedAt,
      voidedReason: expense.voidedReason,
    })
    .from(expense)
    .where(eq(expense.tripId, tripId))
    .orderBy(desc(expense.spentOn));
  return rows as TripExpenseRow[];
}

export interface IncidentExpenseRow {
  id: string;
  vehicleId: string | null;
  tripId: string | null;
  category:
    | "fuel"
    | "tolls"
    | "fines"
    | "cleaning"
    | "tyres"
    | "servicing"
    | "repairs"
    | "insurance"
    | "licence"
    | "crew_food"
    | "permits"
    | "office"
    | "legal"
    | "messaging"
    | "other";
  amountMinor: bigint;
  spentOn: string;
  borneBy: "us" | "driver" | "customer";
  borneByDriverId: string | null;
  borneByCustomerId: string | null;
  paidByUserId: string | null;
  litres: number | null;
  note: string | null;
  voidedAt: string | null;
  voidedReason: string | null;
}

/**
 * Web-P8a's incident screen, step 3 ("Repairs — one cost or several, added
 * as invoices arrive over following weeks"): every cost attached to this
 * incident, newest first, voided ones included and struck through by the
 * caller — the same "never hidden, never silently swapped" convention
 * `listExpensesForVehicle`/`listExpensesForTrip` already established (W-50),
 * applied to an incident instead. `sumIncidentCostMinor` above is the
 * bottom line's own excludes-voided total; this is the itemised list behind
 * it. Called only after the handler has already confirmed the incident
 * belongs to this business (`findIncidentForBusiness`), the same trust
 * boundary those two queries rely on.
 */
export async function listExpensesForIncident(
  db: ReadDb,
  incidentId: string,
): Promise<IncidentExpenseRow[]> {
  const rows = await db
    .select({
      id: expense.id,
      vehicleId: expense.vehicleId,
      tripId: expense.tripId,
      category: expense.category,
      amountMinor: expense.amountMinor,
      spentOn: expense.spentOn,
      borneBy: expense.borneBy,
      borneByDriverId: expense.borneByDriverId,
      borneByCustomerId: expense.borneByCustomerId,
      paidByUserId: expense.paidByUserId,
      litres: expense.litres,
      note: expense.note,
      voidedAt: expense.voidedAt,
      voidedReason: expense.voidedReason,
    })
    .from(expense)
    .where(eq(expense.incidentId, incidentId))
    .orderBy(desc(expense.spentOn));
  return rows as IncidentExpenseRow[];
}

/** F-3.4/UC-12 step 6, "total repair cost" — every cost attached to the incident, not filtered by `borne_by`: an accident repair is (almost) always the business's own cost, and the container's bottom line is what was spent, not a profit-eligibility sum (that is INV-5's job on `expense_profit`). Zero (not "not available") is a real total here — no cost has been logged yet, not a gap in the data (W-56 governs the reverse case). */
export async function sumIncidentCostMinor(db: ReadDb, incidentId: string): Promise<bigint> {
  const rows = await db
    .select({ amountMinor: expense.amountMinor })
    .from(expense)
    .where(and(eq(expense.incidentId, incidentId), isNull(expense.voidedAt)));
  return rows.reduce((sum, row) => sum + row.amountMinor, 0n);
}

/** A2/GAP-4/UC-67 "put in": what this partner spent out of his own pocket, across every vehicle and every overhead cost, all-time — not who it was borne by. Derived at read time from `expense.paid_by_user_id`, deliberately never a written current-account entry (the response schema's own note on why). */
export async function sumOutOfPocketExpensesForUser(
  db: ReadDb,
  businessId: string,
  userId: string,
): Promise<bigint> {
  const rows = await db
    .select({ amountMinor: expense.amountMinor })
    .from(expense)
    .where(
      and(
        eq(expense.businessId, businessId),
        eq(expense.paidByUserId, userId),
        isNull(expense.voidedAt),
      ),
    );
  return rows.reduce((sum, row) => sum + row.amountMinor, 0n);
}
