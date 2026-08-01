import type { Reader } from "../db/client.js";

export type Membership =
  | { userId: string; businessId: string; role: "owner" | "owner_manager" | "manager" }
  | { userId: string; businessId: string; role: "driver"; driverId: string };

interface MembershipRow {
  user_id: string;
  member_business_id: string | null;
  member_role: "owner" | "owner_manager" | "manager" | null;
  driver_id: string | null;
  driver_business_id: string | null;
}

/**
 * The one query behind IG §7.1's chain: `sub → app_user → business_member`,
 * or — since a linked driver never gets a `business_member` row (DM §3's
 * CHECK constraint only allows owner/owner_manager/manager) — `sub →
 * app_user → driver.linked_user_id`. One round trip, not three: this runs
 * on every authenticated request, and each `reader` query is its own HTTP
 * call.
 *
 * A user with neither row returns `null` — no business_id to scope
 * anything by, which downstream (auth/middleware.ts) maps to the same 404
 * a foreign business would (CLAUDE.md → Tenancy: a 403 confirms the row
 * exists, and there is no row here at all).
 *
 * This product has no multi-business membership (nothing in use-cases.md or
 * user-flows.md describes one user across two businesses, or a business
 * switcher) — `business_id` is never taken from the client for exactly that
 * reason, so this assumes at most one `business_member` row and at most one
 * linked `driver` row per user, and takes the first if that assumption is
 * ever wrong rather than adding a selector nothing in the product has.
 */
export async function resolveMembership(reader: Reader, sub: string): Promise<Membership | null> {
  const rows = (await reader`
    SELECT
      au.id AS user_id,
      bm.business_id AS member_business_id,
      bm.role AS member_role,
      d.id AS driver_id,
      d.business_id AS driver_business_id
    FROM app_user au
    LEFT JOIN business_member bm ON bm.user_id = au.id AND bm.revoked_at IS NULL
    LEFT JOIN driver d ON d.linked_user_id = au.id
    WHERE au.asgardeo_sub = ${sub}
    LIMIT 1
  `) as MembershipRow[];

  const row = rows[0];
  if (!row) return null;

  if (row.member_business_id && row.member_role) {
    return { userId: row.user_id, businessId: row.member_business_id, role: row.member_role };
  }
  if (row.driver_id && row.driver_business_id) {
    return {
      userId: row.user_id,
      businessId: row.driver_business_id,
      role: "driver",
      driverId: row.driver_id,
    };
  }
  return null;
}
