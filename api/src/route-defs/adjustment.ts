import { createRoute } from "@hono/zod-openapi";
import {
  createAdjustmentRequestSchema,
  obligationAfterAdjustmentSchema,
} from "@fleetsettle/shared/schemas";

/**
 * F-2.4/UC-15/W-17. Returns the obligation as it stands after the
 * adjustment, not the adjustment row alone — the figure a caller actually
 * wants next is "what does he owe now", and this is one round trip instead
 * of two.
 */
export const createAdjustmentRoute = createRoute({
  method: "post",
  path: "/",
  request: {
    body: { content: { "application/json": { schema: createAdjustmentRequestSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: obligationAfterAdjustmentSchema } },
      description: "The obligation, after the adjustment",
    },
    400: { description: "The adjustment would take the obligation below zero or over-waive it" },
    401: { description: "Missing or invalid access token" },
    // A manual waiver above the auto-waive threshold needs `writeOffOrWaiveAboveThreshold` (OWNERS).
    403: { description: "This role cannot make this adjustment" },
    404: { description: "No such obligation in this business" },
    409: { description: "That accounting period is closed" },
  },
});
