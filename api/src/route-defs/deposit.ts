import { createRoute } from "@hono/zod-openapi";
import {
  depositMovementRequestSchema,
  depositResponseSchema,
  takeDriverDepositRequestSchema,
  voidedDepositMovementResponseSchema,
  voidRequestSchema,
} from "@fleetsettle/shared/schemas";
import { z } from "zod";

const depositIdParams = z.object({ id: z.string().uuid() });
const depositMovementParams = z.object({ id: z.string().uuid(), movementId: z.string().uuid() });

/** F-6.7/UC-58/W-8. INV-4: never income, in any month. */
export const takeDriverDepositRoute = createRoute({
  method: "post",
  path: "/",
  request: {
    body: { content: { "application/json": { schema: takeDriverDepositRequestSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: depositResponseSchema } },
      description: "The deposit",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot take a deposit" },
    404: { description: "No such driver in this business" },
    409: { description: "That accounting period is closed" },
  },
});

/** F-2.7/F-6.7: refund in full, apply against arrears (deliberate, never automatic), or top up. */
export const recordDepositMovementRoute = createRoute({
  method: "post",
  path: "/{id}/movement",
  request: {
    params: depositIdParams,
    body: { content: { "application/json": { schema: depositMovementRequestSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: depositResponseSchema } },
      description: "The deposit, after this movement",
    },
    400: {
      description: "This movement would draw the deposit below zero, or it is no longer held",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot record a deposit movement" },
    404: { description: "No such deposit or replacesId movement in this business" },
    409: {
      description:
        "That accounting period is closed, replacesId names a movement that isn't voided yet, or it has already been replaced (GAP-60)",
    },
  },
});

/** GAP-12/W-61/INV-36 §3.3/§3.4: void, never delete — `deposit.status` comes back recomputed from what's left live. */
export const voidDepositMovementRoute = createRoute({
  method: "post",
  path: "/{id}/movement/{movementId}/void",
  request: {
    params: depositMovementParams,
    body: { content: { "application/json": { schema: voidRequestSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: voidedDepositMovementResponseSchema } },
      description: "The voided movement, and the deposit as it stands now",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot void a deposit movement" },
    404: { description: "No such deposit movement in this business" },
    409: { description: "Already voided, or PERIOD_CLOSED (GAP-35)" },
  },
});
