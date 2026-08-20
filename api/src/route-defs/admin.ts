import { createRoute, z } from "@hono/zod-openapi";
import {
  adminBusinessesResponseSchema,
  adminGrantSchema,
  adminRequestsResponseSchema,
  adminUsersResponseSchema,
  decideRequestInputSchema,
  platformAdminsResponseSchema,
  platformAuditLogResponseSchema,
  setBusinessAllowanceInputSchema,
} from "@fleetsettle/shared/schemas";

/**
 * IG §7.6/design §4: every route here is mounted behind `platformAdminMiddleware`
 * (index.ts) — never `authMiddleware`. Every response shape is exactly the
 * "may read" column of the design's own boundary table: names, counts,
 * roles. Never a balance, a report, or an export (INV-38).
 */

export const listRequestsRoute = createRoute({
  method: "get",
  path: "/requests",
  responses: {
    200: {
      content: { "application/json": { schema: adminRequestsResponseSchema } },
      description: "Every business-creation request, newest first",
    },
    404: { description: "Not a platform admin" },
  },
});

export const decideRequestRoute = createRoute({
  method: "post",
  path: "/requests/{id}/decide",
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: decideRequestInputSchema } } },
  },
  responses: {
    // GAP-143 (19 Aug 2026 live QA pass, F-6): 204, not 200 — this response
    // has no body, and `web/src/lib/api.ts`'s `request<T>()` only skips
    // `res.json()` for exactly 204. A 200 with an empty body made every
    // successful call here throw "Unexpected end of JSON input" client-side.
    204: { description: "Approved — the business now exists — or rejected" },
    404: { description: "Not a platform admin, or no such request" },
    409: { description: "This request has already been decided" },
  },
});

export const listBusinessesRoute = createRoute({
  method: "get",
  path: "/businesses",
  responses: {
    200: {
      content: { "application/json": { schema: adminBusinessesResponseSchema } },
      description: "Every business — name, created, member count. Never a balance.",
    },
    404: { description: "Not a platform admin" },
  },
});

export const listUsersRoute = createRoute({
  method: "get",
  path: "/users",
  responses: {
    200: {
      content: { "application/json": { schema: adminUsersResponseSchema } },
      description: "Every identity — name, email, allowance, active business count",
    },
    404: { description: "Not a platform admin" },
  },
});

export const setAllowanceRoute = createRoute({
  method: "post",
  path: "/users/{id}/allowance",
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: setBusinessAllowanceInputSchema } } },
  },
  responses: {
    // GAP-143: see decideRequestRoute's own comment above.
    204: { description: "Allowance updated" },
    404: { description: "Not a platform admin, or no such user" },
  },
});

export const listAdminsRoute = createRoute({
  method: "get",
  path: "/admins",
  responses: {
    200: {
      content: { "application/json": { schema: platformAdminsResponseSchema } },
      description: "Every active platform admin",
    },
    404: { description: "Not a platform admin" },
  },
});

export const grantAdminRoute = createRoute({
  method: "post",
  path: "/admins",
  request: {
    body: { content: { "application/json": { schema: adminGrantSchema } } },
  },
  responses: {
    // GAP-143: see decideRequestRoute's own comment above.
    204: { description: "Granted (or re-granted)" },
    404: { description: "Not a platform admin, or no such user" },
  },
});

export const revokeAdminRoute = createRoute({
  method: "post",
  path: "/admins/{id}/revoke",
  request: {
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    // GAP-143: see decideRequestRoute's own comment above.
    204: { description: "Revoked" },
    404: { description: "Not a platform admin" },
    409: { description: "The platform must always have at least one active admin (INV-40)" },
  },
});

export const getAuditLogRoute = createRoute({
  method: "get",
  path: "/audit-log",
  responses: {
    200: {
      content: { "application/json": { schema: platformAuditLogResponseSchema } },
      description: "The platform's own log — grants, revokes, decisions, allowance changes",
    },
    404: { description: "Not a platform admin" },
  },
});
