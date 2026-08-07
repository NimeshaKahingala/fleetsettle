import type { RouteHandler } from "@hono/zod-openapi";
import { requireBusinessId, requireCapability, requireUserId } from "../auth/context.js";
import {
  changeBusinessMemberRole,
  inviteBusinessMember,
  revokeBusinessMember,
} from "../domain/membership.js";
import { NotFoundError } from "../errors/app-error.js";
import {
  listBusinessMembersForBusiness,
  type BusinessMemberRow,
} from "../queries/business-member.js";
import type {
  changeBusinessMemberRoleRoute,
  inviteBusinessMemberRoute,
  listBusinessMembersRoute,
  revokeBusinessMemberRoute,
} from "../route-defs/business-member.js";
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

/** A11/W-57/F-1.4. `manageMembers` — OWNERS only. */
export const inviteBusinessMemberHandler: RouteHandler<
  typeof inviteBusinessMemberRoute,
  Env
> = async (c) => {
  requireCapability(c, "manageMembers");
  const businessId = requireBusinessId(c);
  const userId = requireUserId(c);
  const body = c.req.valid("json");

  const issued = await inviteBusinessMember(c.get("writer"), {
    businessId,
    role: body.role,
    createdBy: userId,
  });
  return c.json(issued, 201);
};

/** A11/GAP-43. */
export const revokeBusinessMemberHandler: RouteHandler<
  typeof revokeBusinessMemberRoute,
  Env
> = async (c) => {
  requireCapability(c, "manageMembers");
  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");

  const result = await revokeBusinessMember(c.get("writer"), businessId, id);
  if (!result.found) throw new NotFoundError("No such active member in this business");
  return c.json({ id, revokedAt: result.revokedAt }, 200);
};

/** A11. */
export const changeBusinessMemberRoleHandler: RouteHandler<
  typeof changeBusinessMemberRoleRoute,
  Env
> = async (c) => {
  requireCapability(c, "manageMembers");
  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");

  const result = await changeBusinessMemberRole(c.get("writer"), businessId, id, body.role);
  if (!result.found) throw new NotFoundError("No such active member in this business");
  return c.json({ id: result.id, userId: result.userId, role: result.role }, 200);
};
