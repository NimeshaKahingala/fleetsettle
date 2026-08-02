import { createRoute } from "@hono/zod-openapi";
import { paymentResponseSchema, recordPaymentRequestSchema } from "@fleetsettle/shared/schemas";

/**
 * F-2.2/UC-11: a generic payment against a party's outstanding `owed_to_us`
 * obligations, oldest-`due_on`-first (§6.5) — "two months together, oldest
 * first" is this allocation run for real. Customer rent is the first user
 * of it; the same endpoint serves any party owed_to_us in the future.
 */
export const recordPaymentRoute = createRoute({
  method: "post",
  path: "/",
  request: {
    body: { content: { "application/json": { schema: recordPaymentRequestSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: paymentResponseSchema } },
      description: "The payment and how it was allocated",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot record a payment" },
    404: { description: "No such customer or driver in this business" },
    409: { description: "That accounting period is closed" },
  },
});
