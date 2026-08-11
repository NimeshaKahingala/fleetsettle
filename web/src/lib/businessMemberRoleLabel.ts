import type { BusinessMemberRole } from "@fleetsettle/shared/schemas";

export const BUSINESS_MEMBER_ROLE_LABEL: Record<BusinessMemberRole, string> = {
  owner: "Owner",
  owner_manager: "Owner-manager",
  manager: "Manager",
};

// GAP-1 guard: until manager scoping is built, the UI must not invite new
// `manager` accounts that would see business-wide reports/capital.
export const INVITABLE_BUSINESS_MEMBER_ROLES: BusinessMemberRole[] = ["owner", "owner_manager"];
