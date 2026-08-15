import { z } from "zod";
import { businessDateSchema } from "./common.js";

/** DM §4: the three arrangements a vehicle-day can belong to — A car on monthly rent, B a bus on its normal daily lease, C trips/charter. */
export const vehicleArrangementCodeSchema = z.enum(["A", "B", "C"]);

/**
 * UC-01: registration, type and a default arrangement — DM §4's comment is
 * explicit there is deliberately no draft state to save (U-2). Insurance and
 * registration expiry are the one exception worth asking for on the same
 * form (UC-01: "the only fields here that cost you money by being blank"),
 * but both stay optional — U-2 forbids requiring them, not offering them.
 */
export const createVehicleRequestSchema = z.object({
  registration: z.string().trim().min(1).max(50),
  vehicleType: z.string().trim().min(1).max(50),
  defaultArrangement: vehicleArrangementCodeSchema,
  insuranceExpiry: businessDateSchema.optional(),
  registrationExpiry: businessDateSchema.optional(),
});
export type CreateVehicleRequest = z.infer<typeof createVehicleRequestSchema>;

/**
 * F-3.5/UC-13/GAP-68: the maintenance prompt itself — present only on the
 * vehicle's own detail read (never the list, never Home, both declined in
 * the same decision that specified this). `null` means "checked, nothing
 * to prompt" (no interval set, or no maintenance ever recorded to compare
 * against) — the key still appears, never silently omitted the way a
 * report degrades under W-56.
 */
export const vehicleMaintenanceStatusSchema = z.object({
  // eslint-disable-next-line no-restricted-syntax -- kilometres, not money
  kmSinceLastServiceKm: z.number().int().nullable(),
  due: z.boolean(),
});
export type VehicleMaintenanceStatus = z.infer<typeof vehicleMaintenanceStatusSchema>;

export const vehicleResponseSchema = z.object({
  id: z.string().uuid(),
  registration: z.string(),
  vehicleType: z.string(),
  lifecycle: z.enum(["active", "archived", "disposed"]),
  // The vehicle_arrangement row with effective_to IS NULL (F-1.1) — absent
  // only in the impossible case of a vehicle with no current arrangement.
  arrangement: vehicleArrangementCodeSchema.optional(),
  // F-3.5/UC-13/GAP-68: optional, kilometres, never required to save the
  // vehicle (U-2). `null` means no interval is set — the prompt this drives
  // never appears in that case.
  // eslint-disable-next-line no-restricted-syntax -- kilometres, not money
  serviceIntervalKm: z.number().int().positive().nullable(),
  // Present only on the single-vehicle detail read; omitted from the list.
  maintenance: vehicleMaintenanceStatusSchema.nullable().optional(),
});
export type VehicleResponse = z.infer<typeof vehicleResponseSchema>;

export const listVehiclesResponseSchema = z.array(vehicleResponseSchema);

/** F-3.5/UC-13/GAP-68: "editable on the vehicle's own page" — `null` clears it. */
export const changeVehicleServiceIntervalRequestSchema = z.object({
  // eslint-disable-next-line no-restricted-syntax -- kilometres, not money
  serviceIntervalKm: z.number().int().positive().nullable(),
});
export type ChangeVehicleServiceIntervalRequest = z.infer<
  typeof changeVehicleServiceIntervalRequestSchema
>;

/** F-1.2/UC-94/GAP-54: "pick the new arrangement and an effective date." The row is never overwritten — this closes the current one and opens a new one. */
export const changeVehicleArrangementRequestSchema = z.object({
  arrangement: vehicleArrangementCodeSchema,
  effectiveFrom: businessDateSchema,
});
export type ChangeVehicleArrangementRequest = z.infer<typeof changeVehicleArrangementRequestSchema>;

export const vehicleArrangementResponseSchema = z.object({
  id: z.string().uuid(),
  vehicleId: z.string().uuid(),
  arrangement: vehicleArrangementCodeSchema,
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable(),
});
export type VehicleArrangementResponse = z.infer<typeof vehicleArrangementResponseSchema>;

/** UC-92 / W-31: one row per document type, upserted — a renewal replaces the date, it does not add a row. */
export const vehicleDocTypeSchema = z.enum([
  "insurance",
  "registration",
  "revenue_licence",
  "permit",
  "emissions",
]);

export const upsertVehicleDocumentRequestSchema = z.object({
  docType: vehicleDocTypeSchema,
  expiryDate: businessDateSchema,
  reference: z.string().trim().max(200).optional(),
});
export type UpsertVehicleDocumentRequest = z.infer<typeof upsertVehicleDocumentRequestSchema>;

export const vehicleDocumentResponseSchema = z.object({
  docType: vehicleDocTypeSchema,
  expiryDate: z.string(),
  reference: z.string().optional(),
});
export type VehicleDocumentResponse = z.infer<typeof vehicleDocumentResponseSchema>;

/** Vehicle overview's paperwork tab (Web-P5): every document type this vehicle has ever had a date set for — at most one row per `docType` (UC-92's upsert), never one per renewal. */
export const listVehicleDocumentsResponseSchema = z.array(vehicleDocumentResponseSchema);
export type ListVehicleDocumentsResponse = z.infer<typeof listVehicleDocumentsResponseSchema>;

/** F-1.10/GAP-26: every other reason a vehicle sits still (routine service, sale preparation, an owner's own use) — distinct from an incident's own `off_road_from`/`off_road_to` (§9.1), which already covers incident-caused downtime. */
export const vehicleUnavailabilityReasonSchema = z.enum(["service", "sale_preparation", "other"]);

export const markVehicleUnavailableRequestSchema = z
  .object({
    reason: vehicleUnavailabilityReasonSchema,
    unavailableFrom: businessDateSchema,
    unavailableTo: businessDateSchema.optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.unavailableTo === undefined || v.unavailableTo >= v.unavailableFrom, {
    message: "unavailableTo must not be before unavailableFrom",
    path: ["unavailableTo"],
  });
export type MarkVehicleUnavailableRequest = z.infer<typeof markVehicleUnavailableRequestSchema>;

export const vehicleUnavailabilityResponseSchema = z.object({
  id: z.string().uuid(),
  vehicleId: z.string().uuid(),
  reason: vehicleUnavailabilityReasonSchema,
  unavailableFrom: z.string(),
  unavailableTo: z.string().nullable(),
  note: z.string().nullable(),
});
export type VehicleUnavailabilityResponse = z.infer<typeof vehicleUnavailabilityResponseSchema>;

/** F-1.5's own calendar (UI §7.6): every live outage overlapping the queried month, so a free-looking day can still say why it isn't. */
export const vehicleUnavailabilityListResponseSchema = z.array(vehicleUnavailabilityResponseSchema);
export type VehicleUnavailabilityListResponse = z.infer<
  typeof vehicleUnavailabilityListResponseSchema
>;
