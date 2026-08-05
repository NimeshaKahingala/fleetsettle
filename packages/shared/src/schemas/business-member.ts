import { z } from "zod";
import { uuidSchema } from "./common.js";

/**
 * GAP-31/W-48: lists a business's own owners/owner-managers/managers so
 * `BorneByPaidBy`'s paid-by picker can offer a real second choice instead of
 * "You" alone. `role` mirrors `business_member`'s own CHECK constraint
 * (migration 0001) — a linked driver never gets a `business_member` row at
 * all (DM §3), so "driver" is never a value here.
 */
export const businessMemberRoleSchema = z.enum(["owner", "owner_manager", "manager"]);
export type BusinessMemberRole = z.infer<typeof businessMemberRoleSchema>;

export const businessMemberResponseSchema = z.object({
  userId: uuidSchema,
  displayName: z.string().nullable(),
  role: businessMemberRoleSchema,
});
export type BusinessMemberResponse = z.infer<typeof businessMemberResponseSchema>;

export const businessMembersResponseSchema = z.array(businessMemberResponseSchema);
export type BusinessMembersResponse = z.infer<typeof businessMembersResponseSchema>;
