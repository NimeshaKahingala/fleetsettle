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
 * One row of the matrix is deliberately not a function here: "See another
 * driver's data" is not a capability a role either has or lacks — it is
 * enforced by driver_id scoping in the data layer (IG §7.1 rule 4), never by
 * trusting a claim in the token.
 *
 * `managePartnerCapital` (P7: `ownership_share`, `capital_contribution`,
 * `management_fee_agreement`, `partner_payout`) is, for now, the same flat
 * OWNERS check as `manageOpeningBalances` — not yet the per-vehicle
 * restriction that should eventually confine an `owner_manager` to vehicles
 * he actually owns or manages. That data (`ownership_share` itself) now
 * exists as of P7, which is what was missing before; the WHERE-clause
 * scoping on top of it — and the harder question of which table (ownership
 * vs. management) decides "his" vehicles for which action — is real design
 * work this pass did not do, recorded rather than guessed at.
 *
 * `viewReports` is the same flat stand-in a second time: UC-70/71/72 name a
 * `manager` as seeing only "shared vehicles," but every report in P11 reads
 * across the whole business regardless of role, for the identical reason —
 * the per-vehicle WHERE clause this would need is the same undone work as
 * `managePartnerCapital`'s, not a new gap.
 */

export type Role = "owner" | "owner_manager" | "manager" | "driver";

const STAFF: readonly Role[] = ["owner", "owner_manager", "manager"];
const OWNERS: readonly Role[] = ["owner", "owner_manager"];

export type Capability =
  | "dailyOperations" // daily cards, trips, expenses, collections
  | "leaseAndTripLifecycle" // start/close a lease, close a trip
  | "manageEntities" // F-1.1/F-1.6/F-2.1: add and read vehicles, drivers, customers — setup, not money
  | "manageOpeningBalances" // F-0.2/UC-09: the go-live starting position — owners only, like closePeriod below
  | "managePartnerCapital" // F-1.3/F-1.4/F-7.2: ownership shares, capital contributions, management agreements, partner payouts
  | "writeOffOrWaiveAboveThreshold"
  | "reverseReceipt" // F-8.2
  | "closePeriod" // F-9.1
  | "viewReports" // P11/UC-70/71/72/74/75/76/78: "owner, owner-manager, manager" — every report that doesn't say owners-only
  | "viewOwnerOnlyReports" // P11/UC-77/79 (and UC-73/99 when built): "Sees: owner, owner-manager" only
  | "messagingKillSwitch"
  | "messagingConfig"; // full config, not just the kill switch

const MATRIX: Record<Capability, readonly Role[]> = {
  dailyOperations: STAFF,
  leaseAndTripLifecycle: STAFF,
  manageEntities: STAFF,
  manageOpeningBalances: OWNERS,
  managePartnerCapital: OWNERS,
  writeOffOrWaiveAboveThreshold: OWNERS,
  reverseReceipt: OWNERS,
  closePeriod: OWNERS,
  viewReports: STAFF,
  viewOwnerOnlyReports: OWNERS,
  messagingKillSwitch: STAFF,
  messagingConfig: OWNERS,
};

export function can(role: Role, capability: Capability): boolean {
  return MATRIX[capability].includes(role);
}
