import { createRoute } from "@hono/zod-openapi";
import { businessResponseSchema, createBusinessRequestSchema } from "@fleetsettle/shared/schemas";

/**
 * F-0.1 / UC-08 — the one route mounted behind `verifyTokenMiddleware`
 * instead of `authMiddleware` (auth/middleware.ts): there is no business yet
 * to resolve `c.get("businessId")` from, because this route is what creates
 * the first one.
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
      content: { "application/json": { schema: businessResponseSchema } },
      description: "The business, its first open accounting period, and its one owner",
    },
    401: { description: "Missing or invalid access token" },
    // F-0.1: this identity already resolves to a business (DM §3's
    // one_active_business_per_user index) — a double-submit or a retry, not
    // a validation error.
    409: { description: "This account already belongs to a business" },
  },
});
