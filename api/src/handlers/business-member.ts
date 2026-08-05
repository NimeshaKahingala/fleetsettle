import type { RouteHandler } from "@hono/zod-openapi";
import { requireBusinessId, requireCapability } from "../auth/context.js";
import {
  listBusinessMembersForBusiness,
  type BusinessMemberRow,
} from "../queries/business-member.js";
import type { listBusinessMembersRoute } from "../route-defs/business-member.js";
import type { Env } from "../types.js";

function toResponse(row: BusinessMemberRow) {
  return {
    userId: row.userId,
    displayName: row.displayName,
    role: row.role as "owner" | "owner_manager" | "manager",
  };
}

/** GAP-31. `dailyOperations` — see the route-def's own note on why this is not `managePartnerCapital`. */
export const listBusinessMembersHandler: RouteHandler<
  typeof listBusinessMembersRoute,
  Env
> = async (c) => {
  requireCapability(c, "dailyOperations");
  const businessId = requireBusinessId(c);

  const rows = await listBusinessMembersForBusiness(c.get("reader"), businessId);
  return c.json(rows.map(toResponse), 200);
};
