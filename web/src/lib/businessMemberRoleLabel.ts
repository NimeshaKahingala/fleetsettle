import type { BusinessMemberRole } from "@fleetsettle/shared/schemas";

export const BUSINESS_MEMBER_ROLE_LABEL: Record<BusinessMemberRole, string> = {
  owner: "Owner",
  owner_manager: "Owner-manager",
  manager: "Manager",
};

// GAP-1/W-59/INV-34/D-17 (Wave 3, 13 Aug 2026): `manager` is invitable now
// that per-vehicle scoping is built server-side — the guard that excluded
// it here was a stopgap for the gap in that scoping, not a permanent rule.
export const INVITABLE_BUSINESS_MEMBER_ROLES: BusinessMemberRole[] = [
  "owner",
  "owner_manager",
  "manager",
];
