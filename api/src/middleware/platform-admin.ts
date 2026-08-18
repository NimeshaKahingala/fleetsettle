import type { MiddlewareHandler } from "hono";
import { extractBearerToken, verifyAccessToken } from "../auth/verify.js";
import { InvalidTokenError, NotFoundError } from "../errors/app-error.js";
import { findAppUserBySub } from "../queries/business.js";
import { findActivePlatformAdmin } from "../queries/platform/platform-admin.js";
import type { Env } from "../types.js";

/**
 * IG §7.6: structurally parallel to `authMiddleware`, resolving against
 * `platform_admin` instead of `business_member`/`driver` — and **never**
 * setting `businessId`. There is no business in scope here; any code that
 * acquires one has escaped the tier. The two middlewares are never composed
 * on one route — `/api/admin/*` mounts on this alone (index.ts).
 *
 * A non-admin gets 404, the same discipline `authMiddleware` applies to a
 * foreign business (CLAUDE.md → Tenancy): a 403 would confirm the platform
 * tier exists at all to someone who has no business knowing it does.
 */
export const platformAdminMiddleware = (): MiddlewareHandler<Env> => {
  return async (c, next) => {
    const token = extractBearerToken(c.req.header("Authorization"));
    const payload = await verifyAccessToken(token, c.env);

    if (typeof payload.sub !== "string" || !payload.sub) throw new InvalidTokenError();

    // platform_admin.user_id references app_user.id, never asgardeo_sub
    // directly — the same identity resolution every other middleware uses.
    const user = await findAppUserBySub(c.get("reader"), payload.sub);
    const admin = user ? await findActivePlatformAdmin(c.get("reader"), user.id) : undefined;
    if (!admin) throw new NotFoundError();

    c.set("userId", admin.userId);
    c.set("isPlatformAdmin", true);

    await next();
  };
};
