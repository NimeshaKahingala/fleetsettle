import type { RouteHandler } from "@hono/zod-openapi";
import { requireBusinessId, requireCapability, requireUserId } from "../auth/context.js";
import { voidObligation } from "../domain/obligation.js";
import type { voidObligationRoute } from "../route-defs/obligation.js";
import type { Env } from "../types.js";

/** GAP-12/W-61/INV-36 §3.10. `dailyOperations` — the same gate `recordPostClosureCharge` uses to raise one. */
export const voidObligationHandler: RouteHandler<typeof voidObligationRoute, Env> = async (c) => {
  requireCapability(c, "dailyOperations");
  const businessId = requireBusinessId(c);
  const userId = requireUserId(c);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");

  const result = await voidObligation(c.get("writer"), {
    businessId,
    obligationId: id,
    reason: body.reason,
    userId,
  });

  return c.json(result, 200);
};
