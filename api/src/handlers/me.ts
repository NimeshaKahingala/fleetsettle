import type { RouteHandler } from "@hono/zod-openapi";
import { requireBusinessId, requireRole, requireUserId } from "../auth/context.js";
import type { getMeRoute } from "../route-defs/me.js";
import type { Env } from "../types.js";

export const getMeHandler: RouteHandler<typeof getMeRoute, Env> = (c) => {
  const userId = requireUserId(c);
  const businessId = requireBusinessId(c);
  const role = requireRole(c);
  const driverId = c.get("driverId");

  return c.json(
    {
      userId,
      businessId,
      role,
      ...(driverId ? { driverId } : {}),
    },
    200,
  );
};
