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

/**
 * A11/W-57/F-1.4: the role is the only choice this form asks — no user
 * picker, because the invitee need not have signed in before (there is
 * nothing to pick from). `owner` is a real choice here, not just
 * `owner_manager`/`manager` (⚑, corrected 7 Aug 2026 — see use-cases.md
 * v1.2.4): it is how the passive, report-reading partner gets an account.
 */
export const inviteBusinessMemberRequestSchema = z.object({
  role: businessMemberRoleSchema,
});
export type InviteBusinessMemberRequest = z.infer<typeof inviteBusinessMemberRequestSchema>;

export const inviteBusinessMemberResponseSchema = z.object({
  code: z.string(),
  role: businessMemberRoleSchema,
  expiresAt: z.string(),
});
export type InviteBusinessMemberResponse = z.infer<typeof inviteBusinessMemberResponseSchema>;

/** A11: revoke-and-grant, never an in-place role edit (Plan.md's own "void and replace" reasoning applied to access) — the request only ever carries the new role. */
export const changeBusinessMemberRoleRequestSchema = z.object({
  role: businessMemberRoleSchema,
});
export type ChangeBusinessMemberRoleRequest = z.infer<typeof changeBusinessMemberRoleRequestSchema>;

export const revokedBusinessMemberResponseSchema = z.object({
  id: uuidSchema,
  revokedAt: z.string(),
});
export type RevokedBusinessMemberResponse = z.infer<typeof revokedBusinessMemberResponseSchema>;

/** The new row's own id — the old one stays in place, revoked (A11's revoke-and-grant). */
export const businessMemberRoleChangedResponseSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  role: businessMemberRoleSchema,
});
export type BusinessMemberRoleChangedResponse = z.infer<
  typeof businessMemberRoleChangedResponseSchema
>;
