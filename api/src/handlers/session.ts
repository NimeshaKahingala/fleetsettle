import { newId } from "@fleetsettle/shared";
import type { RouteHandler } from "@hono/zod-openapi";
import { requireAuthSub } from "../auth/context.js";
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
 */
export const getSessionHandler: RouteHandler<typeof getSessionRoute, Env> = async (c) => {
  const sub = requireAuthSub(c);
  const writer = c.get("writer");

  const existing = await findAppUserBySub(writer, sub);
  let userId = existing?.id;
  if (!userId) {
    userId = newId();
    const email = c.get("authEmail");
    const displayName = c.get("authName");
    await insertAppUser(writer, {
      id: userId,
      asgardeoSub: sub,
      ...(email !== undefined ? { email } : {}),
      ...(displayName !== undefined ? { displayName } : {}),
    });
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
