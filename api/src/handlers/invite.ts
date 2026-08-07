import type { RouteHandler } from "@hono/zod-openapi";
import { requireAuthSub } from "../auth/context.js";
import { redeemInvite } from "../domain/membership.js";
import type { redeemInviteRoute } from "../route-defs/invite.js";
import type { Env } from "../types.js";

/** W-57. Reads `authSub` (`verifyTokenMiddleware`), never `businessId` — there may be none yet, the same shape `createBusinessHandler` uses. */
export const redeemInviteHandler: RouteHandler<typeof redeemInviteRoute, Env> = async (c) => {
  const sub = requireAuthSub(c);
  const body = c.req.valid("json");
  const email = c.get("authEmail");
  const displayName = c.get("authName");

  const result = await redeemInvite(c.get("writer"), {
    code: body.code,
    sub,
    ...(email !== undefined ? { email } : {}),
    ...(displayName !== undefined ? { displayName } : {}),
  });

  return c.json(result, 200);
};
