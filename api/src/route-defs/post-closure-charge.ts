import { createRoute } from "@hono/zod-openapi";
import {
  postClosureChargeResponseSchema,
  recordPostClosureChargeRequestSchema,
} from "@fleetsettle/shared/schemas";

/** F-8.4/UC-91/W-29: a fine or toll arriving after the lease or trip has already closed — it creates an outstanding balance regardless. */
export const recordPostClosureChargeRoute = createRoute({
  method: "post",
  path: "/",
  request: {
    body: { content: { "application/json": { schema: recordPostClosureChargeRequestSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: postClosureChargeResponseSchema } },
      description: "The post-closure charge",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot record a post-closure charge" },
    404: {
      description:
        "No such lease, trip, customer, driver or replacesId obligation in this business",
    },
    409: {
      description:
        "That accounting period is closed, replacesId names an obligation that isn't voided yet, or it has already been replaced (GAP-60)",
    },
  },
});
