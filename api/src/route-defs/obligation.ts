import { createRoute } from "@hono/zod-openapi";
import { voidedResponseSchema, voidRequestSchema } from "@fleetsettle/shared/schemas";
import { z } from "zod";

const obligationIdParams = z.object({ id: z.string().uuid() });

/**
 * GAP-12/W-61/INV-36 §3.10: void, never delete — allowed only for an
 * obligation a person raised directly (a post-closure charge today); every
 * other kind is corrected at its source, and any obligation still carrying
 * a live allocation or adjustment refuses, naming each.
 */
export const voidObligationRoute = createRoute({
  method: "post",
  path: "/{id}/void",
  request: {
    params: obligationIdParams,
    body: { content: { "application/json": { schema: voidRequestSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: voidedResponseSchema } },
      description: "The voided obligation",
    },
    400: {
      description: "This obligation's kind cannot be voided directly — correct it at its source",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot void an obligation" },
    404: { description: "No such obligation in this business" },
    409: {
      description:
        "Already voided, a live allocation or adjustment is still against it, or PERIOD_CLOSED (GAP-35)",
    },
  },
});
