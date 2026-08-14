import { createRoute } from "@hono/zod-openapi";
import {
  createAdjustmentRequestSchema,
  createdAdjustmentResponseSchema,
  voidedAdjustmentResponseSchema,
  voidRequestSchema,
} from "@fleetsettle/shared/schemas";
import { z } from "zod";

const adjustmentIdParams = z.object({ id: z.string().uuid() });

/**
 * F-2.4/UC-15/W-17. Returns the obligation as it stands after the
 * adjustment, not the adjustment row alone — the figure a caller actually
 * wants next is "what does he owe now", and this is one round trip instead
 * of two. Carries `adjustmentId` too (GAP-12/W-61/INV-36 §3.1) — found
 * missing while wiring the void endpoint: nothing else in this response
 * lets a later caller address this specific adjustment.
 */
export const createAdjustmentRoute = createRoute({
  method: "post",
  path: "/",
  request: {
    body: { content: { "application/json": { schema: createAdjustmentRequestSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: createdAdjustmentResponseSchema } },
      description: "The obligation, after the adjustment, and the adjustment's own id",
    },
    400: { description: "The adjustment would take the obligation below zero or over-waive it" },
    401: { description: "Missing or invalid access token" },
    // A manual waiver above the auto-waive threshold needs `writeOffOrWaiveAboveThreshold` (OWNERS).
    403: { description: "This role cannot make this adjustment" },
    404: { description: "No such obligation or replacesId adjustment in this business" },
    409: {
      description:
        "That accounting period is closed, replacesId names an adjustment that isn't voided yet, or it has already been replaced (GAP-60)",
    },
  },
});

/** GAP-12/W-61/INV-36 §3.1: void, never delete — reverses exactly what the adjustment did, unwinding a payment allocation into unallocated credit if the reversal needs it. */
export const voidAdjustmentRoute = createRoute({
  method: "post",
  path: "/{id}/void",
  request: {
    params: adjustmentIdParams,
    body: { content: { "application/json": { schema: voidRequestSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: voidedAdjustmentResponseSchema } },
      description: "The voided adjustment, and the obligation as it stands now",
    },
    400: {
      description:
        "Voiding this would take the obligation below what is allocated against it, and not all " +
        "of that is unwindable (some may be settled through an offset instead)",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot void an adjustment" },
    404: { description: "No such adjustment in this business" },
    409: { description: "Already voided, or PERIOD_CLOSED (GAP-35)" },
  },
});
