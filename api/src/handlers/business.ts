import { businessToday } from "@fleetsettle/shared";
import type { RouteHandler } from "@hono/zod-openapi";
import { requireAuthSub } from "../auth/context.js";
import { requestOrCreateBusiness } from "../domain/business-creation.js";
import type { createBusinessRoute } from "../route-defs/business.js";
import type { Env } from "../types.js";

/** F-0.1 / UC-08. Reads `authSub` (`verifyTokenMiddleware`), never `businessId` — there is none yet. */
export const createBusinessHandler: RouteHandler<typeof createBusinessRoute, Env> = async (c) => {
  const sub = requireAuthSub(c);
  const body = c.req.valid("json");
  const email = c.get("authEmail");
  const displayName = c.get("authName");

  const result = await requestOrCreateBusiness(c.get("writer"), {
    sub,
    ...(email !== undefined ? { email } : {}),
    ...(displayName !== undefined ? { displayName } : {}),
    name: body.name,
    currencyCode: body.currencyCode,
    timezone: body.timezone,
    today: businessToday(body.timezone),
  });

  if (result.kind === "created") {
    return c.json(
      {
        kind: "created" as const,
        id: result.businessId,
        name: body.name,
        currencyCode: body.currencyCode,
        timezone: body.timezone,
        accountingPeriodId: result.accountingPeriodId,
      },
      201,
    );
  }

  return c.json({ kind: "pending" as const, requestId: result.requestId }, 201);
};
