import { z } from "zod";
import { uuidSchema } from "./common.js";
import { businessMemberRoleSchema } from "./business-member.js";

/**
 * IG §7.5/decision 17. `/api/session` is the one route that can answer
 * before any business is selected — the pre-business tier (`GET
 * /api/session`, `POST /api/business`, `/api/invite/*`) is the only place
 * an identity holding no membership, or more than one, can be told so.
 * `role` is `meRoleSchema` plus nothing extra: a platform admin with no
 * membership at all has no row here to describe a role for.
 */
export const sessionMembershipSchema = z.object({
  businessId: uuidSchema,
  name: z.string(),
  role: z.union([businessMemberRoleSchema, z.literal("driver")]),
  driverId: uuidSchema.optional(),
});
export type SessionMembership = z.infer<typeof sessionMembershipSchema>;

/**
 * Decision 17: the field `CreateBusinessForm` needs to render "being
 * reviewed" vs "declined: <reason>" vs the create form, on a page refresh —
 * without it decision 13's "refresh to see the outcome" has no mechanism.
 */
export const sessionPendingRequestSchema = z.object({
  status: z.enum(["pending", "rejected"]),
  rejectionReason: z.string().nullable(),
});
export type SessionPendingRequest = z.infer<typeof sessionPendingRequestSchema>;

export const sessionResponseSchema = z.object({
  userId: uuidSchema,
  isPlatformAdmin: z.boolean(),
  businesses: z.array(sessionMembershipSchema),
  pendingRequest: sessionPendingRequestSchema.nullable(),
  // Decision 26: distinguishes a user revoked from their only membership
  // from a first-time signup — both otherwise resolve to businesses: [].
  // Never names the business or the actor (the same disclosure discipline
  // as 404-not-403).
  hadMembership: z.boolean(),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
