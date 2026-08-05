import type { RouteHandler } from "@hono/zod-openapi";
import { requireBusinessId, requireCapability, requireUserId } from "../auth/context.js";
import { closeAccountingPeriod, getCloseChecklist } from "../domain/accounting-period.js";
import type {
  closeAccountingPeriodRoute,
  getCloseChecklistRoute,
} from "../route-defs/accounting-period.js";
import type { Env } from "../types.js";

/** F-9.1 step 1/UC-98. `closePeriod` — owners only, same row as the close itself. */
export const getCloseChecklistHandler: RouteHandler<typeof getCloseChecklistRoute, Env> = async (
  c,
) => {
  requireCapability(c, "closePeriod");
  const businessId = requireBusinessId(c);

  const result = await getCloseChecklist(c.get("reader"), businessId);

  return c.json(result, 200);
};

/** F-9.1/UC-98. `closePeriod` — owner/owner-manager only (the capability matrix's one unconditional manager refusal alongside ownership/capital). */
export const closeAccountingPeriodHandler: RouteHandler<
  typeof closeAccountingPeriodRoute,
  Env
> = async (c) => {
  requireCapability(c, "closePeriod");
  const businessId = requireBusinessId(c);
  const userId = requireUserId(c);

  const result = await closeAccountingPeriod(c.get("writer"), { businessId, userId });

  return c.json(result, 200);
};
