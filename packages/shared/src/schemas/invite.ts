import { z } from "zod";
import { uuidSchema } from "./common.js";
import { businessMemberRoleSchema } from "./business-member.js";

/**
 * W-57: one redemption endpoint for both destinations F-1.4 and F-1.8 share
 * — the code alone decides which. No capability gate on this route (there is
 * nothing to gate: the caller may not belong to any business yet), and the
 * role/driver never comes from this request — only from whichever invite
 * the code matched (F-1.4's own accept clause: "redeeming a code never lets
 * the invitee pick their own role").
 */
export const redeemInviteRequestSchema = z.object({
  code: z.string().trim().min(1),
});
export type RedeemInviteRequest = z.infer<typeof redeemInviteRequestSchema>;

export const redeemInviteResponseSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("business_member"),
    businessId: uuidSchema,
    role: businessMemberRoleSchema,
  }),
  z.object({ kind: z.literal("driver_link"), driverId: uuidSchema }),
]);
export type RedeemInviteResponse = z.infer<typeof redeemInviteResponseSchema>;
