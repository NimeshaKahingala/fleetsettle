import { createRoute } from "@hono/zod-openapi";
import { sessionResponseSchema } from "@fleetsettle/shared/schemas";

/**
 * IG §7.5/decision 17. Mounted behind `verifyTokenMiddleware`, never
 * `authMiddleware` — alongside `/api/business` and `/api/invite/*`, the one
 * place an identity holding no membership, or more than one, can be told
 * so. This is what `FirstRunGate` and the business switcher both read.
 */
export const getSessionRoute = createRoute({
  method: "get",
  path: "/",
  responses: {
    200: {
      content: { "application/json": { schema: sessionResponseSchema } },
      description:
        "Every membership this identity holds, platform-admin status, and its own pending or rejected business-creation request, if any",
    },
    401: { description: "Missing or invalid access token" },
  },
});
