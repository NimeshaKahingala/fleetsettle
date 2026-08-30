import { newId, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { BorneBy, ExpenseCategory, OdometerSource } from "@fleetsettle/shared/schemas";
import type { Reader, Writer } from "../db/client.js";
import { findActiveLeaseForVehicle } from "../queries/lease.js";
import { findCurrentDailyLeaseForVehicle } from "../queries/dailyLease.js";
import { resolvePeriodLinkage } from "../queries/accounting-period.js";
import { findExpenseForBusiness, insertExpense, voidExpenseRow } from "../queries/expense.js";
import { insertOdometerReading } from "../queries/odometer-reading.js";
import { findVehicleArrangementAsOf } from "../queries/vehicle.js";
import { isPeriodClosedViolation, isUniqueViolation } from "../db/pg-error.js";
import {
  ExpenseAlreadyVoidedError,
  NotFoundError,
  PeriodClosedError,
  ReplacesTargetAlreadyReplacedError,
  ReplacesTargetNotVoidedError,
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
 * §6.7's matrix, resolved against the vehicle's arrangement **as of
 * `spentOn`** (GAP-56) — U-8 makes catch-up the ordinary case, not the
 * exception, so a fuel fill entered days or weeks late must resolve against
 * who held the vehicle *then*, not whoever holds it today. Fixes a real
 * money bug: reachable with one lease and no arrangement change at all — a
 * cost dated before a new customer's lease started, entered after it did,
 * was previously assigned to that new customer.
 *
 * "Customer's while he has it, ours between rentals" (cleaning, §6.7) is the
 * general fallback applied to every category defaulting to `customer`/`driver`:
 * no active lease or daily lease as of `spentOn` to name means nobody held
 * the vehicle then, so the cost can only sensibly default to `us`.
 */
export async function resolveBorneByDefault(
  reader: Reader,
  vehicleId: string,
  category: ExpenseCategory,
  spentOn: BusinessDate,
): Promise<ResolvedBorneBy> {
  const arrangement = await findVehicleArrangementAsOf(reader, vehicleId, spentOn);
  const row = arrangement ? BORNE_BY_MATRIX[category]?.[arrangement] : undefined;
  if (row === undefined || row === "us") return { borneBy: "us" };

  if (row === "customer") {
    const active = await findActiveLeaseForVehicle(reader, vehicleId, spentOn);
    if (!active) return { borneBy: "us" };
    return { borneBy: "customer", borneByCustomerId: active.customerId };
  }

  const current = await findCurrentDailyLeaseForVehicle(reader, vehicleId, spentOn);
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
  /**
   * GAP-207/NM-5: the real authenticated actor, distinct from `paidByUserId`
   * — the manager entering the expense (`borne_by`'s `paid_by` half, W-48:
   * whose pocket the cash came from) is not always the person who typed it
   * in. `expense.created_by` is the audit fact "who entered this record"
   * (F-8.6); collapsing it into `paidByUserId` let a record appear to have
   * been entered by someone who never touched the request.
   */
  actorUserId: string;
  litres?: number;
  odometerReadingKm?: number;
  odometerSource?: OdometerSource;
  note?: string;
  replacesId?: string;
}

export interface CreatedExpense {
  expenseId: string;
  odometerReadingId: string | null;
}

/**
 * F-3.1/F-3.2/F-3.3, UC-60/UC-66/UC-72. A single insert — `expense` needs no
 * partner obligation from this phase: `paid_by_user_id` not being "the
 * business's own cash" is what should increase what the business owes that
 * partner (F-3.1's "no extra step"), but partner current accounts are P7's
 * table, not yet built. Recorded here rather than silently assumed.
 *
 * GAP-60/D-16: `replacesId`, when set, is F-8.5's "replace" half — void the
 * mistake, then record the correct one through this same endpoint, naming
 * what it corrects. The target must belong to this business and already be
 * voided (checked before the insert, in the same transaction the period
 * check already opened); the partial unique index on `replaces_id`
 * (migration 0025) is the constraint that stops a second reply pointing at
 * the same voided row, the same "constraint, not code" shape every other
 * race guard in this file's neighbours already uses.
 *
 * GAP-30/F-3.3: `odometerReadingKm`/`odometerSource`, when both given,
 * write a real `odometer_reading` row in the same transaction rather than
 * only on the expense (INV-19/W-18 — a reading always carries its source),
 * the identical shape `bookTrip`'s opening reading and `startLease`'s
 * handover reading already use. The wire schema's own refine guarantees
 * `vehicleId` is present whenever a reading is; `expense.odometer_reading_id`
 * is what `listUsBoughtFuelFills` (queries/reports.ts, UC-72) has been
 * reading with nothing ever writing it.
 */
export async function createExpense(
  writer: Writer,
  input: CreateExpenseInput,
): Promise<CreatedExpense> {
  const expenseId = newId();
  let odometerReadingId: string | undefined;
  try {
    // withActor (db/client.ts) only attributes writes that open a real
    // transaction — a bare top-level insert never runs one, and its own
    // audit_log row would silently carry a NULL changed_by (found while
    // proving F-8.6 against this exact write). Wrapped here even though
    // nothing else needs the atomicity.
    await writer.transaction(async (tx) => {
      // GAP-178/B5: resolved inside the transaction that writes against it.
      // Read outside, the period can close between the check and the insert
      // and the row lands stamped with a month that is now settled.
      const linkage = await resolvePeriodLinkage(tx, input.businessId, input.spentOn);
      if (!linkage)
        throw new PeriodClosedError("No accounting period covers this business date yet");

      if (input.replacesId !== undefined) {
        const target = await findExpenseForBusiness(tx, input.businessId, input.replacesId);
        if (!target) throw new NotFoundError("No such expense in this business");
        if (target.voidedAt === null) throw new ReplacesTargetNotVoidedError();
      }

      if (
        input.odometerReadingKm !== undefined &&
        input.odometerSource !== undefined &&
        input.vehicleId !== undefined
      ) {
        odometerReadingId = newId();
        await insertOdometerReading(tx, {
          id: odometerReadingId,
          businessId: input.businessId,
          vehicleId: input.vehicleId,
          readingKm: input.odometerReadingKm,
          readOn: input.spentOn,
          source: input.odometerSource,
        });
      }

      await insertExpense(tx, {
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
        ...(odometerReadingId !== undefined ? { odometerReadingId } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        postedPeriodId: linkage.postedPeriodId,
        ...(linkage.belongsToPeriodId !== null
          ? { belongsToPeriodId: linkage.belongsToPeriodId }
          : {}),
        createdBy: input.actorUserId,
        ...(input.replacesId !== undefined ? { replacesId: input.replacesId } : {}),
      });
    });
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    if (isUniqueViolation(err, "expense_replaces_id_key")) {
      throw new ReplacesTargetAlreadyReplacedError();
    }
    throw err;
  }

  return { expenseId, odometerReadingId: odometerReadingId ?? null };
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
    // GAP-190/N2: the pre-check above ran on a Reader before this
    // transaction opened — a concurrent void can still win the race, in
    // which case voidExpenseRow's own WHERE now returns nothing rather than
    // clobbering the first void's voided_reason/voided_by.
    if (!voided) throw new ExpenseAlreadyVoidedError();
    return { id: input.expenseId, voidedAt: voided.voidedAt };
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    throw err;
  }
}
