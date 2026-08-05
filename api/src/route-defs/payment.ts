import { createRoute } from "@hono/zod-openapi";
import {
  correctPaymentRequestSchema,
  listPaymentsQuerySchema,
  listPaymentsResponseSchema,
  paymentCorrectionResponseSchema,
  paymentResponseSchema,
  recordPaymentRequestSchema,
} from "@fleetsettle/shared/schemas";
import { z } from "zod";

const paymentIdParams = z.object({ id: z.string().uuid() });

/** A3/GAP-38: every filter optional, newest first — F-8.2's "open the receipt" needs somewhere to find the receipt from. */
export const listPaymentsRoute = createRoute({
  method: "get",
  path: "/",
  request: { query: listPaymentsQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: listPaymentsResponseSchema } },
      description: "Every payment matching the given filters, newest first",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot view payments" },
  },
});

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

/** F-8.2/UC-93/W-36/W-37: a payment that turned out not to have (fully) arrived. Partial is the norm; `bearer` decides whether the difference goes back to the party's arrears or is absorbed as a cash-handling loss. */
export const correctPaymentRoute = createRoute({
  method: "post",
  path: "/{id}/correct",
  request: {
    params: paymentIdParams,
    body: { content: { "application/json": { schema: correctPaymentRequestSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: paymentCorrectionResponseSchema } },
      description: "The correction, and the payment's corrected amount and status",
    },
    400: { description: "differenceMinor exceeds the payment's current recorded amount" },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot reverse a receipt" },
    404: { description: "No such payment in this business" },
    409: { description: "This payment has already been fully reversed, or PERIOD_CLOSED" },
  },
});
