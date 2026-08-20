import { createRoute } from "@hono/zod-openapi";
import {
  listWriteOffsQuerySchema,
  listWriteOffsResponseSchema,
  recordWriteOffRecoveryRequestSchema,
  voidedResponseSchema,
  voidRequestSchema,
  writeOffRecoveryResponseSchema,
  writeOffRequestSchema,
  writeOffResponseSchema,
} from "@fleetsettle/shared/schemas";
import { z } from "zod";

const writeOffIdParams = z.object({ id: z.string().uuid() });
const writeOffRecoveryParams = z.object({ id: z.string().uuid(), recoveryId: z.string().uuid() });

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
    400: { description: "replacesId names a write-off against a different party" },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot write off a balance" },
    404: {
      description:
        "No such obligation, customer, driver, vehicle or replacesId write-off in this business",
    },
    409: {
      description:
        "That accounting period is closed, replacesId names a write-off that isn't voided yet, or it has already been replaced (GAP-60)",
    },
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
    400: { description: "replacesId names a recovery against a different write-off" },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot record a write-off recovery" },
    404: { description: "No such write-off or replacesId recovery in this business" },
    409: {
      description:
        "That accounting period is closed, replacesId names a recovery that isn't voided yet, or it has already been replaced (GAP-60)",
    },
  },
});

/** GAP-12/W-61/INV-36 §3.7: void, never delete — refused (VOID_BLOCKED) while any recovery against it is still live; the linked obligation's prior status is restored exactly. */
export const voidWriteOffRoute = createRoute({
  method: "post",
  path: "/{id}/void",
  request: {
    params: writeOffIdParams,
    body: { content: { "application/json": { schema: voidRequestSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: voidedResponseSchema } },
      description: "The voided write-off",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot void a write-off" },
    404: { description: "No such write-off in this business" },
    409: {
      description:
        "Already voided, a live recovery is still against it (VOID_BLOCKED), or PERIOD_CLOSED (GAP-35)",
    },
  },
});

/** GAP-12/W-61/INV-36 §3.8: void, never delete — cascades to mark the payment this recovery minted as reversed, since it was never entered on its own. */
export const voidWriteOffRecoveryRoute = createRoute({
  method: "post",
  path: "/{id}/recovery/{recoveryId}/void",
  request: {
    params: writeOffRecoveryParams,
    body: { content: { "application/json": { schema: voidRequestSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: voidedResponseSchema } },
      description: "The voided recovery",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot void a write-off recovery" },
    404: { description: "No such recovery in this business" },
    409: { description: "Already voided, or PERIOD_CLOSED (GAP-35)" },
  },
});
