import type { MiddlewareHandler } from "hono";
import { extractBearerToken, verifyAccessToken } from "../auth/verify.js";
import { InvalidTokenError, NotFoundError } from "../errors/app-error.js";
import { resolveMembership } from "../queries/identity.js";
import type { Env } from "../types.js";

/**
 * IG §7.1's chain, end to end: verify the Bearer token against JWKS, resolve
 * `sub` to a business (via `business_member` or a linked driver), and set
 * `businessId`/`userId`/`role`/`driverId` for everything downstream. Requires
 * `dbMiddleware` mounted first — this reads `c.get("reader")`.
 *
 * No membership resolves to 404, the same as a foreign business would
 * (CLAUDE.md → Tenancy): a verified identity with nothing to scope by has
 * nothing to see, and a 403 here would confirm a row that does not exist.
 */
export const authMiddleware = (): MiddlewareHandler<Env> => {
  return async (c, next) => {
    const token = extractBearerToken(c.req.header("Authorization"));
    const payload = await verifyAccessToken(token, c.env);

    if (typeof payload.sub !== "string" || !payload.sub) throw new InvalidTokenError();

    const membership = await resolveMembership(c.get("reader"), payload.sub);
    if (!membership) throw new NotFoundError();

    c.set("userId", membership.userId);
    c.set("businessId", membership.businessId);
    c.set("role", membership.role);
    if (membership.role === "driver") c.set("driverId", membership.driverId);

    await next();
  };
};

/**
 * F-0.1's one exception to `authMiddleware`: creating the very first business
 * for an identity that has no `business_member` row yet, so there is nothing
 * for `resolveMembership` to resolve — every other route needs a business to
 * scope by, this is the one that creates it. Verifies the token and nothing
 * else; `c.get("businessId")` stays unset all the way through this route.
 */
export const verifyTokenMiddleware = (): MiddlewareHandler<Env> => {
  return async (c, next) => {
    const token = extractBearerToken(c.req.header("Authorization"));
    const payload = await verifyAccessToken(token, c.env);

    if (typeof payload.sub !== "string" || !payload.sub) throw new InvalidTokenError();

    c.set("authSub", payload.sub);
    c.set("authEmail", typeof payload["email"] === "string" ? payload["email"] : undefined);
    c.set("authName", typeof payload["name"] === "string" ? payload["name"] : undefined);

    await next();
  };
};
