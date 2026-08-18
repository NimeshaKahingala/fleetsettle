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

  return rows.map((row): Membership =>
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
