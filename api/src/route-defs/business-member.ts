import { createRoute } from "@hono/zod-openapi";
import {
  businessMemberRoleChangedResponseSchema,
  businessMembersResponseSchema,
  changeBusinessMemberRoleRequestSchema,
  inviteBusinessMemberRequestSchema,
  inviteBusinessMemberResponseSchema,
  revokedBusinessMemberResponseSchema,
} from "@fleetsettle/shared/schemas";
import { z } from "zod";

const businessMemberIdParams = z.object({ id: z.string().uuid() });

/** GAP-31: `dailyOperations` (STAFF), not `managePartnerCapital` — the caller is `BorneByPaidBy` inside `RecordExpenseSheet`, which a manager uses, not an owners-only screen. */
export const listBusinessMembersRoute = createRoute({
  method: "get",
  path: "/",
  responses: {
    200: {
      content: { "application/json": { schema: businessMembersResponseSchema } },
      description: "This business's active owners, owner-managers and managers",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read business members" },
  },
});

/** A11/W-57/F-1.4: `manageMembers` (OWNERS) — a manager cannot invite anyone, including another manager. */
export const inviteBusinessMemberRoute = createRoute({
  method: "post",
  path: "/invite",
  request: {
    body: { content: { "application/json": { schema: inviteBusinessMemberRequestSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: inviteBusinessMemberResponseSchema } },
      description: "The plaintext code — shown once, never retrievable again",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot invite a member" },
  },
});

/** A11/GAP-43: INV-31 refuses to leave a business with no active owner/owner-manager — 409, not merely a warning (Plan.md: nothing could undo it once it happened). */
export const revokeBusinessMemberRoute = createRoute({
  method: "post",
  path: "/{id}/revoke",
  request: { params: businessMemberIdParams },
  responses: {
    200: {
      content: { "application/json": { schema: revokedBusinessMemberResponseSchema } },
      description: "Access ended; everything this member entered stays attributed to them",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot revoke a member" },
    // Cross-tenant is 404, never 403 (CLAUDE.md → Tenancy). A revoked or
    // unknown id both read as "no such active member" — this route does not
    // distinguish them.
    404: { description: "No such active member in this business" },
    409: {
      description: "This business must always have at least one active owner or owner-manager",
    },
  },
});

/** A11: revoke-and-grant, one call — never an in-place role edit. */
export const changeBusinessMemberRoleRoute = createRoute({
  method: "post",
  path: "/{id}/change-role",
  request: {
    params: businessMemberIdParams,
    body: { content: { "application/json": { schema: changeBusinessMemberRoleRequestSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: businessMemberRoleChangedResponseSchema } },
      description: "The new membership row — the old one stays in place, revoked",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot change a member's role" },
    404: { description: "No such active member in this business" },
    409: {
      description: "This business must always have at least one active owner or owner-manager",
    },
  },
});
