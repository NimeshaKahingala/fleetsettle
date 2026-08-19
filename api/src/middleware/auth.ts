import type { MiddlewareHandler } from "hono";
import { extractBearerToken, verifyAccessToken } from "../auth/verify.js";
import { BusinessNotSelectedError, InvalidTokenError, NotFoundError } from "../errors/app-error.js";
import { resolveMemberships, type Membership } from "../queries/identity.js";
import type { Env } from "../types.js";

/**
 * IG §7.5's five-step chain: verify the Bearer token against JWKS, resolve
 * `sub` to every membership this identity holds (via `business_member` or a
 * linked driver — an identity may now hold both, in different businesses,
 * W-66), pick which one is in scope for this request, and set
 * `businessId`/`userId`/`role`/`driverId` for everything downstream. Requires
 * `dbMiddleware` mounted first — this reads `c.get("reader")`.
 *
 * **The header is a filter over memberships the server derived from the
 * token, never a grant.** `X-Business-Id` narrows an already-resolved set;
 * it is never itself the source of `businessId` — that always comes from
 * the matched membership row (step 5), so no later refactor can reach for
 * the header string directly.
 */
export const authMiddleware = (): MiddlewareHandler<Env> => {
  return async (c, next) => {
    const token = extractBearerToken(c.req.header("Authorization"));
    const payload = await verifyAccessToken(token, c.env);

    if (typeof payload.sub !== "string" || !payload.sub) throw new InvalidTokenError();

    // Step 2: every membership this identity holds, from the database —
    // never from the token.
    const memberships = await resolveMemberships(c.get("reader"), payload.sub);

    const header = c.req.header("X-Business-Id"); // allow: this is the rule's own sanctioned resolution point (IG §7.5)
    let membership: Membership;
    if (header !== undefined) {
      // Step 3: not in the resolved set → 404, never 403 (CLAUDE.md →
      // Tenancy: a 403 confirms the business exists).
      const matched = memberships.find((m) => m.businessId === header);
      if (!matched) throw new NotFoundError();
      membership = matched;
    } else if (memberships.length === 1) {
      // Step 4a: no header, exactly one membership — use it, unremarked.
      const [only] = memberships;
      if (!only) throw new NotFoundError();
      membership = only;
    } else if (memberships.length === 0) {
      throw new NotFoundError();
    } else {
      // Step 4b: no header, more than one membership — refuse the guess.
      throw new BusinessNotSelectedError();
    }

    // Step 5: businessId is set from the matched membership ROW, never from
    // the header string — the difference between a validated selector and
    // a trusted claim.
    c.set("userId", membership.userId);
    c.set("businessId", membership.businessId);
    c.set("businessTimezone", membership.businessTimezone);
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
