import { z } from "zod";
import { businessDateSchema, moneyWireSchema, uuidSchema } from "./common.js";

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
    amountMinor: moneyWireSchema,
    spentOn: businessDateSchema,
    borneBy: borneBySchema.optional(),
    borneByDriverId: uuidSchema.optional(),
    borneByCustomerId: uuidSchema.optional(),
    paidByUserId: uuidSchema.optional(),
    // eslint-disable-next-line no-restricted-syntax -- fuel litres, not money (UC-72)
    litres: z.number().positive().optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.borneBy !== "driver" || v.borneByDriverId !== undefined, {
    message: "borneByDriverId is required when borneBy is 'driver'",
    path: ["borneByDriverId"],
  })
  .refine((v) => v.borneBy !== "customer" || v.borneByCustomerId !== undefined, {
    message: "borneByCustomerId is required when borneBy is 'customer'",
    path: ["borneByCustomerId"],
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
  note: z.string().nullable(),
});
export type ExpenseResponse = z.infer<typeof expenseResponseSchema>;
