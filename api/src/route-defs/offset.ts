import { createRoute } from "@hono/zod-openapi";
import {
  createOffsetRequestSchema,
  offsetResponseSchema,
  voidedResponseSchema,
  voidRequestSchema,
} from "@fleetsettle/shared/schemas";
import { z } from "zod";

const offsetIdParams = z.object({ id: z.string().uuid() });

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
    400: {
      description:
        "This offset exceeds what is outstanding on one side or the other, or replacesId names an offset against a different driver",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot record an offset" },
    404: { description: "No such driver or replacesId offset in this business" },
    409: {
      description:
        "That accounting period is closed, replacesId names an offset that isn't voided yet, or it has already been replaced (GAP-60)",
    },
  },
});

/** GAP-12/W-61/INV-36 §3.2: void, never delete — unwinds both sides symmetrically (INV-3), never one balance without the other. */
export const voidOffsetRoute = createRoute({
  method: "post",
  path: "/{id}/void",
  request: {
    params: offsetIdParams,
    body: { content: { "application/json": { schema: voidRequestSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: voidedResponseSchema } },
      description: "The voided offset",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot void an offset" },
    404: { description: "No such offset in this business" },
    409: { description: "Already voided, or PERIOD_CLOSED (GAP-35)" },
  },
});
