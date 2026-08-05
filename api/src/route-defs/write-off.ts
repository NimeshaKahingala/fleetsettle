import { createRoute } from "@hono/zod-openapi";
import {
  listWriteOffsQuerySchema,
  listWriteOffsResponseSchema,
  recordWriteOffRecoveryRequestSchema,
  writeOffRecoveryResponseSchema,
  writeOffRequestSchema,
  writeOffResponseSchema,
} from "@fleetsettle/shared/schemas";
import { z } from "zod";

const writeOffIdParams = z.object({ id: z.string().uuid() });

/** A3: every filter optional, newest first. Voided rows stay in, struck through with their reason (W-50). */
export const listWriteOffsRoute = createRoute({
  method: "get",
  path: "/",
  request: { query: listWriteOffsQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: listWriteOffsResponseSchema } },
      description: "Every write-off matching the given filters, newest first",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot view write-offs" },
  },
});

/** F-8.3/UC-90/W-28: a loss you were handed, never pooled with a waiver (INV-14). */
export const recordWriteOffRoute = createRoute({
  method: "post",
  path: "/",
  request: {
    body: { content: { "application/json": { schema: writeOffRequestSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: writeOffResponseSchema } },
      description: "The write-off",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot write off a balance" },
    404: { description: "No such obligation, customer or driver in this business" },
    409: { description: "That accounting period is closed" },
  },
});

/** INV-15: a later payment against a written-off balance nets against it, never fresh income. */
export const recordWriteOffRecoveryRoute = createRoute({
  method: "post",
  path: "/{id}/recovery",
  request: {
    params: writeOffIdParams,
    body: { content: { "application/json": { schema: recordWriteOffRecoveryRequestSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: writeOffRecoveryResponseSchema } },
      description: "The recovery, and the payment it was recorded through",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot record a write-off recovery" },
    404: { description: "No such write-off in this business" },
    409: { description: "That accounting period is closed" },
  },
});
