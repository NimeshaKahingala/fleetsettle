import type { PlatformAuditAction } from "@fleetsettle/shared/schemas";

/**
 * CLAUDE.md's vocabulary rule: no raw technical/enum strings reach the
 * interface. Mirrors `businessMemberRoleLabel.ts`'s own precedent — one
 * lookup table, plain English, next to the type it labels.
 */
export const PLATFORM_AUDIT_ACTION_LABEL: Record<PlatformAuditAction, string> = {
  request_approved: "Approved a business request",
  request_rejected: "Declined a business request",
  admin_granted: "Granted admin access",
  admin_revoked: "Revoked admin access",
  allowance_changed: "Changed a business allowance",
};
