import { createRoute } from "@hono/zod-openapi";
import {
  businessCreationResponseSchema,
  createBusinessRequestSchema,
} from "@fleetsettle/shared/schemas";

/**
 * F-0.1 / UC-08 — the one route mounted behind `verifyTokenMiddleware`
 * instead of `authMiddleware` (auth/middleware.ts): there is no business yet
 * to resolve `c.get("businessId")` from, because this route is what creates
 * the first one.
 *
 * Phase 2 (18 Aug 2026, decisions 4/22): the response is a discriminated
 * union — below the requester's allowance, `kind: "created"`, unchanged
 * from Phase 1. At or above it, `kind: "pending"` — a `business_creation_request`
 * is held instead (F-0.3), decided later at `POST /api/admin/requests/{id}/decide`.
 */
export const createBusinessRoute = createRoute({
  method: "post",
  path: "/",
  request: {
    body: {
      content: { "application/json": { schema: createBusinessRequestSchema } },
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: businessCreationResponseSchema } },
      description:
        "Either the business (kind: created) or a held request awaiting platform-admin approval (kind: pending)",
    },
    401: { description: "Missing or invalid access token" },
    409: { description: "A request is already being reviewed (INV-41)" },
  },
});
