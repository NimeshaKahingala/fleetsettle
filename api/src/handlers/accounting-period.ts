import type { RouteHandler } from "@hono/zod-openapi";
import { requireBusinessId, requireCapability, requireUserId } from "../auth/context.js";
import { closeAccountingPeriod, getCloseChecklist } from "../domain/accounting-period.js";
import { listAccountingPeriodsForBusiness } from "../queries/accounting-period.js";
import type {
  closeAccountingPeriodRoute,
  getCloseChecklistRoute,
  listAccountingPeriodsRoute,
} from "../route-defs/accounting-period.js";
import type { Env } from "../types.js";

/** A3: informational, alongside the other report reads — not gated by `closePeriod` the way the two handlers below are, since listing which months are closed is not the act of closing one. */
export const listAccountingPeriodsHandler: RouteHandler<
  typeof listAccountingPeriodsRoute,
  Env
> = async (c) => {
  requireCapability(c, "viewReports");
  const businessId = requireBusinessId(c);

  const rows = await listAccountingPeriodsForBusiness(c.get("reader"), businessId);

  return c.json(rows, 200);
};

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
