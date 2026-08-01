import { createRoute } from "@hono/zod-openapi";
import { createOffsetRequestSchema, offsetResponseSchema } from "@fleetsettle/shared/schemas";

/**
 * F-6.4/UC-56/W-2. INV-3: the ONLY endpoint that moves both of a driver's
 * balances — nothing nets automatically anywhere else in this API.
 */
export const createOffsetRoute = createRoute({
  method: "post",
  path: "/",
  request: {
    body: { content: { "application/json": { schema: createOffsetRequestSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: offsetResponseSchema } },
      description: "The offset",
    },
    400: { description: "This offset exceeds what is outstanding on one side or the other" },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot record an offset" },
    404: { description: "No such driver in this business" },
    409: { description: "That accounting period is closed" },
  },
});
