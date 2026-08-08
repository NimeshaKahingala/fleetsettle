import { createRoute } from "@hono/zod-openapi";
import { meResponseSchema } from "@fleetsettle/shared/schemas";

/**
 * UI §1.1/B0b: the identity the client needs for role → shell selection.
 * Reaching the handler at all already proves the token verified and
 * resolved to a business (mounted behind `dbMiddleware` + `authMiddleware`).
 */
export const getMeRoute = createRoute({
  method: "get",
  path: "/",
  responses: {
    200: {
      content: { "application/json": { schema: meResponseSchema } },
      description: "The caller's own identity: user, business, role, and driver id if linked",
    },
    401: { description: "Missing or invalid access token" },
  },
});
