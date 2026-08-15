import { z } from "zod";
import { businessDateSchema, moneyWireSchema } from "./common.js";

/**
 * UC-04. Only `name` is required (U-2 / M-6) — DM §5's `driver` table makes
 * every other column nullable for exactly this: the fee figures and licence
 * expiry are real fields on the same form, not a separate step, but none of
 * them blocks the save.
 */
export const createDriverRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  mobile: z.string().trim().min(1).max(30).optional(),
  driverDayFeeMinor: moneyWireSchema.optional(),
  driverTripFeeMinor: moneyWireSchema.optional(),
  licenceExpiry: businessDateSchema.optional(),
});
export type CreateDriverRequest = z.infer<typeof createDriverRequestSchema>;

export const driverResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  mobile: z.string().nullable(),
  driverDayFeeMinor: z.string().nullable(),
  driverTripFeeMinor: z.string().nullable(),
  licenceExpiry: z.string().nullable(),
  // Optional, not just nullable: every screen built before F-1.11 mocks this
  // response with no knowledge of archiving at all, and none of them needs
  // to be taught the field just to keep compiling.
  archivedAt: z.string().nullable().optional(),
});
export type DriverResponse = z.infer<typeof driverResponseSchema>;

/** F-1.11/UC-100/W-50: a reason is required — migration 0023's own CHECK on `driver` refuses `voided_at` with an empty or absent `voided_reason`, the same audit requirement every other void table in this schema carries. */
export const archiveDriverRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type ArchiveDriverRequest = z.infer<typeof archiveDriverRequestSchema>;

/** F-1.8/W-42/A11: no request body — the driver comes from the route, matching F-1.8's "on the driver's page" step. */
export const driverLinkInviteResponseSchema = z.object({
  code: z.string(),
  expiresAt: z.string(),
});
export type DriverLinkInviteResponse = z.infer<typeof driverLinkInviteResponseSchema>;
