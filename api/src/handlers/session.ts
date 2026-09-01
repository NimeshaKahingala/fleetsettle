import { newId } from "@fleetsettle/shared";
import type { RouteHandler } from "@hono/zod-openapi";
import { requireAuthSub } from "../auth/context.js";
import { isUniqueViolation } from "../db/pg-error.js";
import { findAppUserBySub, hadAnyMembership, insertAppUser } from "../queries/business.js";
import { resolveMemberships } from "../queries/identity.js";
import { findOwnOutstandingRequest } from "../queries/platform/business-creation-request.js";
import { findActivePlatformAdmin } from "../queries/platform/platform-admin.js";
import type { getSessionRoute } from "../route-defs/session.js";
import type { Env } from "../types.js";

/**
 * IG §7.5/decision 17. Upserts `app_user` on first call, exactly like
 * `createBusiness`/`redeemInvite` already do — this is also what solves the
 * platform-admin bootstrap problem (design §5 step 2): signing in once,
 * with no business created yet, is enough to get a real `app_user` row to
 * point the first `platform_admin` row at.
 *
 * L-6, 31 Aug 2026: the read-then-insert wrapped in a transaction, and the
 * insert's own unique violation on `asgardeo_sub` (two tabs/devices signing
 * in for the first time at once — the same narrow race `requestOrCreateBusiness`
 * accepts explicitly, business-creation.ts's own comment) treated as
 * success rather than a 500: idempotency lives in the constraint, not in
 * code (CLAUDE.md → Writes), so the loser of the race re-reads the winner's
 * own row instead of failing on it. The re-read happens *outside* the
 * failed transaction, on `writer` directly — Postgres aborts every
 * statement in a transaction once one violates a constraint, so retrying
 * on the same `tx` the violation came from would itself fail with "current
 * transaction is aborted."
 */
export const getSessionHandler: RouteHandler<typeof getSessionRoute, Env> = async (c) => {
  const sub = requireAuthSub(c);
  const writer = c.get("writer");

  let userId: string;
  try {
    userId = await writer.transaction(async (tx) => {
      const existing = await findAppUserBySub(tx, sub);
      if (existing) return existing.id;

      const newUserId = newId();
      const email = c.get("authEmail");
      const displayName = c.get("authName");
      await insertAppUser(tx, {
        id: newUserId,
        asgardeoSub: sub,
        ...(email !== undefined ? { email } : {}),
        ...(displayName !== undefined ? { displayName } : {}),
      });
      return newUserId;
    });
  } catch (err) {
    if (!isUniqueViolation(err, "app_user_asgardeo_sub_key")) throw err;
    const winner = await findAppUserBySub(writer, sub);
    if (!winner) throw err;
    userId = winner.id;
  }

  const [memberships, admin, pendingRequest, hadMembership] = await Promise.all([
    resolveMemberships(c.get("reader"), sub),
    findActivePlatformAdmin(c.get("reader"), userId),
    findOwnOutstandingRequest(c.get("reader"), userId),
    hadAnyMembership(c.get("reader"), userId),
  ]);

  return c.json(
    {
      userId,
      isPlatformAdmin: admin !== undefined,
      businesses: memberships.map((m) => ({
        businessId: m.businessId,
        name: m.businessName,
        role: m.role,
        ...(m.role === "driver" ? { driverId: m.driverId } : {}),
      })),
      pendingRequest: pendingRequest ?? null,
      hadMembership,
    },
    200,
  );
};
