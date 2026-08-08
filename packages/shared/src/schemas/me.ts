import { z } from "zod";
import { uuidSchema } from "./common.js";

/**
 * UI §1.1/W-49: the identity `FirstRunGate` (and, from B0b, every
 * `<Can>`-gated affordance) reads role from. Mirrors `auth/policy.ts`'s
 * `Role` type exactly — the one place a driver's role appears without a
 * `business_member` row, since `driver` is assigned by which query matched
 * rather than by a membership CHECK constraint (DM §3).
 */
export const meRoleSchema = z.enum(["owner", "owner_manager", "manager", "driver"]);
export type MeRole = z.infer<typeof meRoleSchema>;

export const meResponseSchema = z.object({
  userId: uuidSchema,
  businessId: uuidSchema,
  role: meRoleSchema,
  driverId: uuidSchema.optional(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;
