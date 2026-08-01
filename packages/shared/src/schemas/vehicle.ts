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

export const vehicleResponseSchema = z.object({
  id: z.string().uuid(),
  registration: z.string(),
  vehicleType: z.string(),
  lifecycle: z.enum(["active", "archived", "disposed"]),
  // The vehicle_arrangement row with effective_to IS NULL (F-1.1) — absent
  // only in the impossible case of a vehicle with no current arrangement.
  arrangement: vehicleArrangementCodeSchema.optional(),
});
export type VehicleResponse = z.infer<typeof vehicleResponseSchema>;

export const listVehiclesResponseSchema = z.array(vehicleResponseSchema);

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
