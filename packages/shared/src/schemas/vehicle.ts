import { z } from "zod";
import { businessDateSchema } from "./common.js";

/** UC-01: two required fields, one step — DM §4's comment is explicit that there is deliberately no draft state to save. */
export const createVehicleRequestSchema = z.object({
  registration: z.string().trim().min(1).max(50),
  vehicleType: z.string().trim().min(1).max(50),
});
export type CreateVehicleRequest = z.infer<typeof createVehicleRequestSchema>;

export const vehicleResponseSchema = z.object({
  id: z.string().uuid(),
  registration: z.string(),
  vehicleType: z.string(),
  lifecycle: z.enum(["active", "archived", "disposed"]),
});
export type VehicleResponse = z.infer<typeof vehicleResponseSchema>;

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
