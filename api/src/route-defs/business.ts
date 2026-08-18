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
  },
});
// Phase 1 (18 Aug 2026, W-63): the 409 this route used to document —
// one_active_business_per_user — is gone. A second business is legal, no
// longer a conflict this route can even produce; the threshold/allowance
// gate that replaces it is Phase 2's, on this same route.
