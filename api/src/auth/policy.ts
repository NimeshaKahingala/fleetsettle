/**
 * FL §2.3 / W-49, one function per row. This is the only place a capability
 * is decided (IG §7.2) — the client's copy (UI §12.4) is convenience only,
 * and every handler re-checks here regardless of what the UI already hid.
 *
 * "Driver" is not a `business_member.role` — a linked driver never gets a
 * membership row (DM §3's CHECK constraint only allows owner/owner_manager/
 * manager). It is a role in this type only, assigned by which row the
 * identity-resolution query matched (queries/identity.ts).
 *
 * Two rows of the matrix are deliberately not functions here:
 * - "Ownership shares, capital, payouts" restricts owner_manager to vehicles
 *   he owns/manages — a per-vehicle fact that doesn't exist until P2's
 *   ownership records do. That scoping is a data-layer WHERE clause then,
 *   the same way the driver boundary below is, not a flat role check now.
 * - "See another driver's data" is not a capability a role either has or
 *   lacks — it is enforced by driver_id scoping in the data layer (IG
 *   §7.1 rule 4), never by trusting a claim in the token.
 */

export type Role = "owner" | "owner_manager" | "manager" | "driver";

const STAFF: readonly Role[] = ["owner", "owner_manager", "manager"];
const OWNERS: readonly Role[] = ["owner", "owner_manager"];

export type Capability =
  | "dailyOperations" // daily cards, trips, expenses, collections
  | "leaseAndTripLifecycle" // start/close a lease, close a trip
  | "manageEntities" // F-1.1/F-1.6/F-2.1: add and read vehicles, drivers, customers — setup, not money
  | "writeOffOrWaiveAboveThreshold"
  | "reverseReceipt" // F-8.2
  | "closePeriod" // F-9.1
  | "messagingKillSwitch"
  | "messagingConfig"; // full config, not just the kill switch

const MATRIX: Record<Capability, readonly Role[]> = {
  dailyOperations: STAFF,
  leaseAndTripLifecycle: STAFF,
  manageEntities: STAFF,
  writeOffOrWaiveAboveThreshold: OWNERS,
  reverseReceipt: OWNERS,
  closePeriod: OWNERS,
  messagingKillSwitch: STAFF,
  messagingConfig: OWNERS,
};

export function can(role: Role, capability: Capability): boolean {
  return MATRIX[capability].includes(role);
}
