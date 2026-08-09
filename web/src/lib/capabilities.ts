import type { MeRole } from "@fleetsettle/shared/schemas";

/**
 * UI §12.4/B0b: a client-side copy of `api/src/auth/policy.ts`'s `MATRIX`,
 * row for row. **Convenience only** — every capability is re-checked in the
 * Worker on every request, and the driver boundary is `driver_id` scoping in
 * the data layer (§12.4, TS §2), never a claim this matrix could assert.
 * This file exists so a screen can decide what to render without a wasted
 * round trip to find out it will 403; it must never be read as the security
 * boundary itself.
 */

const STAFF: readonly MeRole[] = ["owner", "owner_manager", "manager"];
const OWNERS: readonly MeRole[] = ["owner", "owner_manager"];
const LINKED_DRIVER: readonly MeRole[] = ["driver"];

export type Capability =
  | "dailyOperations"
  | "leaseAndTripLifecycle"
  | "manageEntities"
  | "manageOpeningBalances"
  | "managePartnerCapital"
  | "manageMembers"
  | "writeOffOrWaiveAboveThreshold"
  | "reverseReceipt"
  | "closePeriod"
  | "viewReports"
  | "viewOwnerOnlyReports"
  | "viewOwnData"
  | "messagingKillSwitch"
  | "messagingConfig";

const MATRIX: Record<Capability, readonly MeRole[]> = {
  dailyOperations: STAFF,
  leaseAndTripLifecycle: STAFF,
  manageEntities: STAFF,
  manageOpeningBalances: OWNERS,
  managePartnerCapital: OWNERS,
  manageMembers: OWNERS,
  writeOffOrWaiveAboveThreshold: OWNERS,
  reverseReceipt: OWNERS,
  closePeriod: OWNERS,
  viewReports: STAFF,
  viewOwnerOnlyReports: OWNERS,
  viewOwnData: LINKED_DRIVER,
  messagingKillSwitch: STAFF,
  messagingConfig: OWNERS,
};

export function can(role: MeRole, capability: Capability): boolean {
  return MATRIX[capability].includes(role);
}
