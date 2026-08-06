import { newId, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { BorneBy, ExpenseCategory } from "@fleetsettle/shared/schemas";
import type { Reader, Writer } from "../db/client.js";
import { findActiveLeaseForVehicle } from "../queries/lease.js";
import { findCurrentDailyLeaseForVehicle } from "../queries/dailyLease.js";
import { resolvePeriodLinkage } from "../queries/accounting-period.js";
import { findExpenseForBusiness, insertExpense, voidExpenseRow } from "../queries/expense.js";
import { isPeriodClosedViolation } from "../db/pg-error.js";
import {
  ExpenseAlreadyVoidedError,
  NotFoundError,
  PeriodClosedError,
} from "../errors/app-error.js";

/**
 * UC §6.7's default-owner matrix: every cost has a default, derived from the
 * category and the vehicle's arrangement, never asked (W-7). `driver cost`
 * has no row here — arrangement B's driver cost is the daily lease amount
 * itself (P3's `day_record`/`obligation`), never an `expense` category.
 * Categories the matrix is silent on (crew_food, permits, office, legal,
 * messaging, other) default to `us`, the same as the matrix's own overhead
 * rows (tyres/servicing/repairs/insurance/licence).
 */
const BORNE_BY_MATRIX: Partial<Record<ExpenseCategory, Record<"A" | "B" | "C", BorneBy>>> = {
  fuel: { A: "customer", B: "driver", C: "us" },
  tolls: { A: "customer", B: "driver", C: "us" },
  fines: { A: "customer", B: "driver", C: "us" },
  cleaning: { A: "customer", B: "us", C: "us" },
};

export interface ResolvedBorneBy {
  borneBy: BorneBy;
  borneByDriverId?: string;
  borneByCustomerId?: string;
}

/**
 * §6.7's matrix, resolved against the vehicle's *current* arrangement — a
 * deliberate simplification (the same one `findCurrentDailyLeaseRate`
 * already makes for rates): an arrangement change between `spentOn` and
 * today would need a date-scoped lookup this phase doesn't build, and the
 * default is overridable on the record regardless.
 *
 * "Customer's while he has it, ours between rentals" (cleaning, §6.7) is the
 * general fallback applied to every category defaulting to `customer`/`driver`:
 * no active lease or daily lease to name means nobody currently holds the
 * vehicle, so the cost can only sensibly default to `us`.
 */
export async function resolveBorneByDefault(
  reader: Reader,
  vehicleId: string,
  category: ExpenseCategory,
  arrangement: "A" | "B" | "C" | null,
): Promise<ResolvedBorneBy> {
  const row = arrangement ? BORNE_BY_MATRIX[category]?.[arrangement] : undefined;
  if (row === undefined || row === "us") return { borneBy: "us" };

  if (row === "customer") {
    const active = await findActiveLeaseForVehicle(reader, vehicleId);
    if (!active) return { borneBy: "us" };
    return { borneBy: "customer", borneByCustomerId: active.customerId };
  }

  const current = await findCurrentDailyLeaseForVehicle(reader, vehicleId);
  if (!current) return { borneBy: "us" };
  return { borneBy: "driver", borneByDriverId: current.driverId };
}

export interface CreateExpenseInput {
  businessId: string;
  vehicleId?: string;
  tripId?: string;
  incidentId?: string;
  category: ExpenseCategory;
  amountMinor: Minor;
  spentOn: BusinessDate;
  borneBy: BorneBy;
  borneByDriverId?: string;
  borneByCustomerId?: string;
  paidByUserId: string;
  litres?: number;
  note?: string;
}

export interface CreatedExpense {
  expenseId: string;
}

/**
 * F-3.1/F-3.2/F-3.3, UC-60/UC-66/UC-72. A single insert — `expense` needs no
 * partner obligation from this phase: `paid_by_user_id` not being "the
 * business's own cash" is what should increase what the business owes that
 * partner (F-3.1's "no extra step"), but partner current accounts are P7's
 * table, not yet built. Recorded here rather than silently assumed.
 */
export async function createExpense(
  writer: Writer,
  input: CreateExpenseInput,
): Promise<CreatedExpense> {
  const linkage = await resolvePeriodLinkage(writer, input.businessId, input.spentOn);
  if (!linkage) throw new PeriodClosedError("No accounting period covers this business date yet");

  const expenseId = newId();
  try {
    // withActor (db/client.ts) only attributes writes that open a real
    // transaction — a bare top-level insert never runs one, and its own
    // audit_log row would silently carry a NULL changed_by (found while
    // proving F-8.6 against this exact write). Wrapped here even though
    // nothing else needs the atomicity.
    await writer.transaction((tx) =>
      insertExpense(tx, {
        id: expenseId,
        businessId: input.businessId,
        ...(input.vehicleId !== undefined ? { vehicleId: input.vehicleId } : {}),
        ...(input.tripId !== undefined ? { tripId: input.tripId } : {}),
        ...(input.incidentId !== undefined ? { incidentId: input.incidentId } : {}),
        category: input.category,
        amountMinor: input.amountMinor,
        spentOn: input.spentOn,
        borneBy: input.borneBy,
        ...(input.borneByDriverId !== undefined ? { borneByDriverId: input.borneByDriverId } : {}),
        ...(input.borneByCustomerId !== undefined
          ? { borneByCustomerId: input.borneByCustomerId }
          : {}),
        paidByUserId: input.paidByUserId,
        ...(input.litres !== undefined ? { litres: input.litres } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        postedPeriodId: linkage.postedPeriodId,
        ...(linkage.belongsToPeriodId !== null
          ? { belongsToPeriodId: linkage.belongsToPeriodId }
          : {}),
        createdBy: input.paidByUserId,
      }),
    );
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    throw err;
  }

  return { expenseId };
}

export interface VoidExpenseInput {
  businessId: string;
  expenseId: string;
  reason: string;
  userId: string;
}

export interface VoidedExpense {
  id: string;
  voidedAt: string;
}

/**
 * F-8.5/UC-96/W-50: "wrong vehicle... fuel logged against the wrong trip" —
 * void it, with a reason, then record the corrected version through the
 * ordinary create endpoint. Void, never delete, and `posted_period_id`
 * stays untouched — but a void is still a new reversal fact, and since
 * migration 0008 (GAP-35) `assert_period_open()` treats the `voided_at`
 * NULL → NOT NULL transition as a post in its own right: voiding an
 * expense from a now-closed period is refused, the same as creating one
 * would be. Voiding a *current-period* expense whose period later closes is
 * unaffected — the void already happened before the close.
 */
export async function voidExpense(writer: Writer, input: VoidExpenseInput): Promise<VoidedExpense> {
  const existing = await findExpenseForBusiness(writer, input.businessId, input.expenseId);
  if (!existing) throw new NotFoundError("No such expense in this business");
  if (existing.voidedAt !== null) throw new ExpenseAlreadyVoidedError();

  try {
    // See createExpense's own comment — withActor only attributes writes
    // inside a real transaction.
    const voided = await writer.transaction((tx) =>
      voidExpenseRow(tx, input.expenseId, {
        voidedReason: input.reason,
        voidedBy: input.userId,
      }),
    );
    return { id: input.expenseId, voidedAt: voided.voidedAt };
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    throw err;
  }
}
