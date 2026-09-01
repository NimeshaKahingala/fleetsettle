import { and, eq, isNull, sql } from "drizzle-orm";
import { unionAll } from "drizzle-orm/pg-core";
import type { Reader } from "../db/client.js";
import { appUser, business, businessMember, driver } from "../db/schema.js";

export type Membership =
  | {
      userId: string;
      businessId: string;
      businessName: string;
      businessTimezone: string;
      role: "owner" | "owner_manager" | "manager";
    }
  | {
      userId: string;
      businessId: string;
      businessName: string;
      businessTimezone: string;
      role: "driver";
      driverId: string;
    };

/**
 * The query behind IG §7.5's chain: `sub → app_user → business_member`
 * *and* — since a linked driver never gets a `business_member` row (DM §3's
 * CHECK constraint only allows owner/owner_manager/manager) — `sub →
 * app_user → driver.linked_user_id`, independently. One identity may now
 * hold both shapes at once, in different businesses (W-66), so this returns
 * every active membership rather than at most one.
 *
 * **A `UNION ALL` of the two shapes, each joined to its own business —
 * never a single `or()` join.** The previous version joined `business` with
 * `or(business.id = businessMember.businessId, business.id = driver.businessId)`,
 * which produces a cross-product ambiguous as to which business belongs to
 * which membership the moment either side can have more than one row. It
 * worked only because `one_active_business_per_user` (dropped, migration
 * 0029) capped each side at one row and `.limit(1)` hid the rest. Two round
 * trips would be simpler to write; this stays one, because `authMiddleware`
 * calls it on every request and each `reader` query is its own HTTP call.
 *
 * An identity with no membership at all returns `[]` — no business_id to
 * scope anything by, which `authMiddleware` maps to the same 404 a foreign
 * business would (CLAUDE.md → Tenancy: a 403 confirms the row exists, and
 * there is no row here at all).
 *
 * **One row per businessId, even though nothing stops the same identity
 * being both a `business_member` and a linked `driver` of the *same*
 * business** (an owner who also drives one of the vehicles, in this
 * two-car-and-a-bus product, is not far-fetched) — `business_member` and
 * `driver.linked_user_id` are independent tables with no mutual-exclusivity
 * constraint between them. Left undeduped, that identity would get two
 * `Membership` rows sharing one `businessId`: `authMiddleware`'s no-header
 * branch would wrongly refuse a single-business identity with
 * `BUSINESS_NOT_SELECTED` (`memberships.length > 1` even though there is
 * one real business), and its header branch would pick whichever row
 * `UNION ALL` happened to return first — unordered, so not deterministic —
 * silently deciding whether `driverId` gets set. Collapsing to one row per
 * business, preferring the `business_member` shape, means an
 * owner/manager who is also a linked driver of their own business keeps
 * their full capability rather than being downgraded to driver-only.
 */
export async function resolveMemberships(reader: Reader, sub: string): Promise<Membership[]> {
  const memberSelect = reader
    .select({
      userId: appUser.id,
      businessId: businessMember.businessId,
      businessName: business.name,
      role: businessMember.role,
      driverId: sql<string | null>`null`.as("driver_id"),
      businessTimezone: business.timezone,
    })
    .from(appUser)
    .innerJoin(
      businessMember,
      and(eq(businessMember.userId, appUser.id), isNull(businessMember.revokedAt)),
    )
    .innerJoin(business, eq(business.id, businessMember.businessId))
    .where(eq(appUser.asgardeoSub, sub));

  // `memberSelect` above filters `isNull(businessMember.revokedAt)` — a
  // revoked owner/manager loses `resolveMemberships` entirely. This join
  // carries no equivalent `isNull(driver.voidedAt)`, so an *archived*
  // linked driver keeps every membership row, and with it `viewOwnData`
  // (F-1.11/UC-59): he can still open his own app and see his own current
  // figures after being let go. Decided deliberately, not an unstated
  // consequence — W-58's own "archive, never delete" already means his
  // historical rows keep rendering exactly as before; extending that to
  // his own live login is the same instinct applied to the person, not
  // only his records, and archiving him was never framed as revoking
  // access the way a business member's revoke explicitly is. A future
  // reviewer who wants an archived driver locked out entirely should add
  // the filter here — this comment is what makes that a decision to
  // revisit, not a bug to rediscover.
  const driverSelect = reader
    .select({
      userId: appUser.id,
      businessId: driver.businessId,
      businessName: business.name,
      role: sql<string>`'driver'`.as("role"),
      driverId: driver.id,
      businessTimezone: business.timezone,
    })
    .from(appUser)
    .innerJoin(driver, eq(driver.linkedUserId, appUser.id))
    .innerJoin(business, eq(business.id, driver.businessId))
    .where(eq(appUser.asgardeoSub, sub));

  const rows = await unionAll(memberSelect, driverSelect);

  const byBusiness = new Map<string, Membership>();
  for (const row of rows) {
    const existing = byBusiness.get(row.businessId);
    if (existing && existing.role !== "driver") continue; // a member row already won this business
    byBusiness.set(
      row.businessId,
      row.role === "driver"
        ? {
            userId: row.userId,
            businessId: row.businessId,
            businessName: row.businessName,
            businessTimezone: row.businessTimezone,
            role: "driver",
            driverId: row.driverId as string,
          }
        : {
            userId: row.userId,
            businessId: row.businessId,
            businessName: row.businessName,
            businessTimezone: row.businessTimezone,
            role: row.role as "owner" | "owner_manager" | "manager",
          },
    );
  }

  return [...byBusiness.values()];
}
