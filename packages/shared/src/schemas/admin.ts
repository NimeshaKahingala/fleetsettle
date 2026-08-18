import { z } from "zod";
import { uuidSchema } from "./common.js";

/**
 * IG §7.6: everything here is what a platform admin may see — a requester's
 * name/email, a business's name/created/member count, counts and roles.
 * Never a balance, a report, or an export (INV-38). `queries/platform/` is
 * barred by `check-forbidden.mjs` from importing money-table schema, and
 * these response shapes are the other half of that boundary: nothing here
 * has a field a money query would need to fill.
 */

export const businessCreationRequestStatusSchema = z.enum(["pending", "approved", "rejected"]);
export type BusinessCreationRequestStatus = z.infer<typeof businessCreationRequestStatusSchema>;

export const adminRequestSchema = z.object({
  id: uuidSchema,
  requestedBy: uuidSchema,
  requesterName: z.string(),
  requesterEmail: z.string().nullable(),
  name: z.string(),
  status: businessCreationRequestStatusSchema,
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  // W-67: an admin approving their own request is allowed, and rendered
  // visibly distinct from an arms-length one — the flag exists for exactly
  // this and cannot be added credibly after the fact.
  selfAction: z.boolean(),
});
export type AdminRequest = z.infer<typeof adminRequestSchema>;

export const adminRequestsResponseSchema = z.array(adminRequestSchema);
export type AdminRequestsResponse = z.infer<typeof adminRequestsResponseSchema>;

export const decideRequestInputSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approve") }),
  z.object({ decision: z.literal("reject"), reason: z.string().trim().min(1).max(500) }),
]);
export type DecideRequestInput = z.infer<typeof decideRequestInputSchema>;

export const adminBusinessSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  createdAt: z.string(),
  // eslint-disable-next-line no-restricted-syntax -- a member count, not money
  memberCount: z.number().int().nonnegative(),
});
export type AdminBusiness = z.infer<typeof adminBusinessSchema>;

export const adminBusinessesResponseSchema = z.array(adminBusinessSchema);
export type AdminBusinessesResponse = z.infer<typeof adminBusinessesResponseSchema>;

export const adminUserSchema = z.object({
  id: uuidSchema,
  email: z.string().nullable(),
  displayName: z.string().nullable(),
  // eslint-disable-next-line no-restricted-syntax -- decision 22's allowance, a count, not money
  businessAllowance: z.number().int().nonnegative(),
  // eslint-disable-next-line no-restricted-syntax -- an active-membership count, not money
  activeBusinessCount: z.number().int().nonnegative(),
  isPlatformAdmin: z.boolean(),
});
export type AdminUser = z.infer<typeof adminUserSchema>;

export const adminUsersResponseSchema = z.array(adminUserSchema);
export type AdminUsersResponse = z.infer<typeof adminUsersResponseSchema>;

export const setBusinessAllowanceInputSchema = z.object({
  // eslint-disable-next-line no-restricted-syntax -- decision 22's allowance, a count, not money
  businessAllowance: z.number().int().min(0).max(1000),
});
export type SetBusinessAllowanceInput = z.infer<typeof setBusinessAllowanceInputSchema>;

export const adminGrantSchema = z.object({
  userId: uuidSchema,
});
export type AdminGrant = z.infer<typeof adminGrantSchema>;

export const platformAdminSchema = z.object({
  userId: uuidSchema,
  email: z.string().nullable(),
  displayName: z.string().nullable(),
  grantedAt: z.string(),
});
export type PlatformAdmin = z.infer<typeof platformAdminSchema>;

export const platformAdminsResponseSchema = z.array(platformAdminSchema);
export type PlatformAdminsResponse = z.infer<typeof platformAdminsResponseSchema>;

export const platformAuditActionSchema = z.enum([
  "request_approved",
  "request_rejected",
  "admin_granted",
  "admin_revoked",
  "allowance_changed",
]);
export type PlatformAuditAction = z.infer<typeof platformAuditActionSchema>;

export const platformAuditLogEntrySchema = z.object({
  id: z.string(),
  action: platformAuditActionSchema,
  subjectId: uuidSchema,
  actorId: uuidSchema,
  actorName: z.string(),
  selfAction: z.boolean(),
  createdAt: z.string(),
});
export type PlatformAuditLogEntry = z.infer<typeof platformAuditLogEntrySchema>;

export const platformAuditLogResponseSchema = z.array(platformAuditLogEntrySchema);
export type PlatformAuditLogResponse = z.infer<typeof platformAuditLogResponseSchema>;
