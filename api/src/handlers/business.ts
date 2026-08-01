import { businessToday } from "@fleetsettle/shared";
import type { RouteHandler } from "@hono/zod-openapi";
import { requireAuthSub } from "../auth/context.js";
import { createBusiness } from "../domain/setup.js";
import type { createBusinessRoute } from "../route-defs/business.js";
import type { Env } from "../types.js";

/** F-0.1 / UC-08. Reads `authSub` (`verifyTokenMiddleware`), never `businessId` — there is none yet. */
export const createBusinessHandler: RouteHandler<typeof createBusinessRoute, Env> = async (c) => {
  const sub = requireAuthSub(c);
  const body = c.req.valid("json");
  const email = c.get("authEmail");
  const displayName = c.get("authName");

  const { businessId, accountingPeriodId } = await createBusiness(c.get("writer"), {
    sub,
    ...(email !== undefined ? { email } : {}),
    ...(displayName !== undefined ? { displayName } : {}),
    name: body.name,
    currencyCode: body.currencyCode,
    timezone: body.timezone,
    today: businessToday(body.timezone),
  });

  return c.json(
    {
      id: businessId,
      name: body.name,
      currencyCode: body.currencyCode,
      timezone: body.timezone,
      accountingPeriodId,
    },
    201,
  );
};
