import { z } from "zod";
import {
  businessDateSchema,
  moneyWireSchema,
  positiveMoneyWireSchema,
  uuidSchema,
} from "./common.js";
import { odometerSourceSchema } from "./lease-billing.js";

/** DM §9's `CHECK` on `expense.category` — the borne-by default matrix (UC §6.7) is keyed on this. */
export const expenseCategorySchema = z.enum([
  "fuel",
  "tolls",
  "fines",
  "cleaning",
  "tyres",
  "servicing",
  "repairs",
  "insurance",
  "licence",
  "crew_food",
  "permits",
  "office",
  "legal",
  "messaging",
  "other",
]);
export type ExpenseCategory = z.infer<typeof expenseCategorySchema>;

export const borneBySchema = z.enum(["us", "driver", "customer"]);
export type BorneBy = z.infer<typeof borneBySchema>;

/**
 * F-3.1/F-3.2/F-3.3, UC-60/UC-66. `vehicleId` absent means an overhead cost
 * (UC-66, INV-24) — never a required field pretending zero is a vehicle.
 * `borneBy`/`paidByUserId` are both defaulted server-side (UC §6.7's matrix,
 * "whoever is entering") and both overridable here — W-48/INV-27 keeps them
 * two separate questions, never derived from one another.
 */
export const createExpenseRequestSchema = z
  .object({
    vehicleId: uuidSchema.optional(),
    // F-5.2/F-5.4: a cost incurred on a charter, folded into that trip's own
    // P&L (UC-44) rather than only the vehicle's month — the trip and the
    // vehicle are not exclusive, so both may be set.
    tripId: uuidSchema.optional(),
    // F-3.4/UC-12: a repair cost attached to the incident container — entered
    // "as invoices arrive over following weeks" against an already-open
    // incident, not exclusive with tripId or vehicleId.
    incidentId: uuidSchema.optional(),
    category: expenseCategorySchema,
    // GAP-177: a cost of nothing is not a cost. Zero here is a mis-entry.
    amountMinor: positiveMoneyWireSchema,
    spentOn: businessDateSchema,
    borneBy: borneBySchema.optional(),
    borneByDriverId: uuidSchema.optional(),
    borneByCustomerId: uuidSchema.optional(),
    paidByUserId: uuidSchema.optional(),
    // eslint-disable-next-line no-restricted-syntax -- fuel litres, not money (UC-72)
    litres: z.number().positive().optional(),
    // GAP-30/F-3.3: a fuel fill's own odometer reading, written as a real
    // `odometer_reading` row in the same transaction (INV-19/W-18) — not
    // stored on the expense alone. Needs a vehicle to belong to, and the two
    // fields are given together or not at all, same shape as
    // `bookTripRequestSchema`'s opening reading.
    // eslint-disable-next-line no-restricted-syntax -- an odometer figure, not money
    odometerReadingKm: z.number().int().nonnegative().optional(),
    odometerSource: odometerSourceSchema.optional(),
    note: z.string().trim().max(500).optional(),
    // GAP-60/D-16/F-8.5: set when this expense is the corrected replacement
    // for one already voided — the target must belong to this business and
    // already be voided, checked server-side (domain/expense.ts).
    replacesId: uuidSchema.optional(),
  })
  .refine((v) => v.borneBy !== "driver" || v.borneByDriverId !== undefined, {
    message: "borneByDriverId is required when borneBy is 'driver'",
    path: ["borneByDriverId"],
  })
  .refine((v) => v.borneBy !== "customer" || v.borneByCustomerId !== undefined, {
    message: "borneByCustomerId is required when borneBy is 'customer'",
    path: ["borneByCustomerId"],
  })
  .refine((v) => (v.odometerReadingKm === undefined) === (v.odometerSource === undefined), {
    message: "odometerReadingKm and odometerSource must be given together",
    path: ["odometerSource"],
  })
  .refine((v) => v.odometerReadingKm === undefined || v.vehicleId !== undefined, {
    message: "vehicleId is required to record an odometer reading",
    path: ["vehicleId"],
  });
export type CreateExpenseRequest = z.infer<typeof createExpenseRequestSchema>;

export const expenseResponseSchema = z.object({
  id: z.string().uuid(),
  vehicleId: z.string().uuid().nullable(),
  tripId: z.string().uuid().nullable(),
  incidentId: z.string().uuid().nullable(),
  category: expenseCategorySchema,
  amountMinor: z.string(),
  spentOn: z.string(),
  borneBy: borneBySchema,
  borneByDriverId: z.string().uuid().nullable(),
  borneByCustomerId: z.string().uuid().nullable(),
  paidByUserId: z.string().uuid().nullable(),
  // eslint-disable-next-line no-restricted-syntax -- fuel litres, not money
  litres: z.number().nullable(),
  // GAP-30/UC-72: the `odometer_reading` row this fill wrote, when it did —
  // `listUsBoughtFuelFills` (queries/reports.ts) is what dereferences this
  // into a km/l figure for the fuel-efficiency report.
  odometerReadingId: z.string().uuid().nullable(),
  note: z.string().nullable(),
  // GAP-60/D-16/F-8.6: "what corrected this?", answered from the record
  // itself rather than only from a global log.
  replacesId: z.string().uuid().nullable(),
});
export type ExpenseResponse = z.infer<typeof expenseResponseSchema>;

/** Vehicle overview's costs tab (Web-P5): `expenseResponseSchema` plus the void fields — a voided expense stays in the list, struck through with its reason, never removed (W-50). */
export const expenseListRowSchema = expenseResponseSchema.extend({
  voidedAt: z.string().nullable(),
  voidedReason: z.string().nullable(),
});
export type ExpenseListRow = z.infer<typeof expenseListRowSchema>;

export const listExpensesResponseSchema = z.array(expenseListRowSchema);
export type ListExpensesResponse = z.infer<typeof listExpensesResponseSchema>;

/**
 * Web-P8b's costs list (F-3.1): every filter optional — an unfiltered call
 * is every expense the business has ever logged, newest first. `from`/`to`
 * bound `spentOn`, not `createdAt` (an expense entered late is still dated
 * when it happened, same as `insertExpense`'s own doc comment).
 */
export const listExpensesQuerySchema = z.object({
  vehicleId: uuidSchema.optional(),
  tripId: uuidSchema.optional(),
  incidentId: uuidSchema.optional(),
  category: expenseCategorySchema.optional(),
  from: businessDateSchema.optional(),
  to: businessDateSchema.optional(),
});
export type ListExpensesQuery = z.infer<typeof listExpensesQuerySchema>;

/**
 * GAP-32/§6.7: a live preview of the default-owner matrix, resolved against
 * the vehicle's arrangement as of `spentOn` — what `resolveBorneByDefault`
 * (domain/expense.ts) would choose if the record were saved right now. Lets
 * the client show the default before offering an override to a *different*
 * driver or customer, without a second implementation of the matrix.
 */
export const resolveBorneByQuerySchema = z.object({
  vehicleId: uuidSchema,
  category: expenseCategorySchema,
  spentOn: businessDateSchema,
});
export type ResolveBorneByQuery = z.infer<typeof resolveBorneByQuerySchema>;

export const resolveBorneByResponseSchema = z.object({
  borneBy: borneBySchema,
  borneByDriverId: z.string().uuid().nullable(),
  borneByCustomerId: z.string().uuid().nullable(),
});
export type ResolveBorneByResponse = z.infer<typeof resolveBorneByResponseSchema>;

/**
 * GAP-34/U-3: "vehicle defaults to the one with something pending" — no
 * last-touched-vehicle column exists, so this reuses the one concrete
 * "pending" fact already tracked against a vehicle: Home item 4's own
 * unconfirmed-day definition, oldest first. `vehicleId` is `null` when
 * nothing is pending — the caller's own fallback (first vehicle in the
 * list) is unaffected.
 */
export const expensePrefillVehicleResponseSchema = z.object({
  vehicleId: z.string().uuid().nullable(),
});
export type ExpensePrefillVehicleResponse = z.infer<typeof expensePrefillVehicleResponseSchema>;

/** F-8.5/UC-96: "wrong vehicle... fuel logged against the wrong trip" — void it, with a reason, then record the corrected one through the ordinary create endpoint. */
export const voidExpenseRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type VoidExpenseRequest = z.infer<typeof voidExpenseRequestSchema>;

export const voidedExpenseResponseSchema = z.object({
  id: uuidSchema,
  voidedAt: z.string(),
});
export type VoidedExpenseResponse = z.infer<typeof voidedExpenseResponseSchema>;
