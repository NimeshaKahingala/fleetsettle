import { createRoute } from "@hono/zod-openapi";
import { createExpenseRequestSchema, expenseResponseSchema } from "@fleetsettle/shared/schemas";

/** F-3.1/F-3.2/F-3.3, UC-60/UC-66. `vehicleId` absent is a valid overhead cost (UC-66, INV-24), never an error. */
export const createExpenseRoute = createRoute({
  method: "post",
  path: "/",
  request: {
    body: { content: { "application/json": { schema: createExpenseRequestSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: expenseResponseSchema } },
      description: "The expense",
    },
    400: { description: "borne-by names a party with no matching id" },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot record an expense" },
    404: { description: "No such vehicle, driver or customer in this business" },
    409: { description: "That accounting period is closed" },
  },
});
