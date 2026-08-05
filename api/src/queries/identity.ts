import { and, eq, isNull, or } from "drizzle-orm";
import type { Reader } from "../db/client.js";
import { appUser, business, businessMember, driver } from "../db/schema.js";

export type Membership =
  | {
      userId: string;
      businessId: string;
      businessTimezone: string;
      role: "owner" | "owner_manager" | "manager";
    }
  | {
      userId: string;
      businessId: string;
      businessTimezone: string;
      role: "driver";
      driverId: string;
    };

const MEMBER_ROLES = new Set(["owner", "owner_manager", "manager"]);

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
  const rows = await reader
    .select({
      userId: appUser.id,
      memberBusinessId: businessMember.businessId,
      memberRole: businessMember.role,
      driverId: driver.id,
      driverBusinessId: driver.businessId,
      // Every domain write that needs "today" needs the business's own
      // configured timezone, never a hardcoded default (CLAUDE.md → Time) —
      // resolved here, once, rather than a second round trip per write.
      businessTimezone: business.timezone,
    })
    .from(appUser)
    .leftJoin(
      businessMember,
      and(eq(businessMember.userId, appUser.id), isNull(businessMember.revokedAt)),
    )
    .leftJoin(driver, eq(driver.linkedUserId, appUser.id))
    .leftJoin(
      business,
      or(eq(business.id, businessMember.businessId), eq(business.id, driver.businessId)),
    )
    .where(eq(appUser.asgardeoSub, sub))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  if (
    row.memberBusinessId &&
    row.memberRole &&
    MEMBER_ROLES.has(row.memberRole) &&
    row.businessTimezone
  ) {
    return {
      userId: row.userId,
      businessId: row.memberBusinessId,
      businessTimezone: row.businessTimezone,
      role: row.memberRole as "owner" | "owner_manager" | "manager",
    };
  }
  if (row.driverId && row.driverBusinessId && row.businessTimezone) {
    return {
      userId: row.userId,
      businessId: row.driverBusinessId,
      businessTimezone: row.businessTimezone,
      role: "driver",
      driverId: row.driverId,
    };
  }
  return null;
}
