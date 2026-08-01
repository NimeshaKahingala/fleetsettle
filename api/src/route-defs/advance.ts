import { createRoute } from "@hono/zod-openapi";
import {
  advanceResponseSchema,
  issueAdvanceRequestSchema,
  settleAdvanceRequestSchema,
} from "@fleetsettle/shared/schemas";
import { z } from "zod";

const advanceIdParams = z.object({ id: z.string().uuid() });

/** F-6.3/UC-53. Not a cost — a trip attached or none (UC-50: a retainer/bonus is the same shape). */
export const issueAdvanceRoute = createRoute({
  method: "post",
  path: "/",
  request: {
    body: { content: { "application/json": { schema: issueAdvanceRequestSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: advanceResponseSchema } },
      description: "The advance",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot issue an advance" },
    404: { description: "No such driver in this business" },
    409: { description: "That accounting period is closed" },
  },
});

/** UC-53: "the advance closes at zero" — spent / returned / kept as fee, each its own settlement row. */
export const settleAdvanceRoute = createRoute({
  method: "post",
  path: "/{id}/settle",
  request: {
    params: advanceIdParams,
    body: { content: { "application/json": { schema: settleAdvanceRequestSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: advanceResponseSchema } },
      description: "The advance, after this settlement",
    },
    400: { description: "This settlement would exceed the advance's original amount" },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot settle an advance" },
    404: { description: "No such advance in this business" },
    409: { description: "That accounting period is closed" },
  },
});
