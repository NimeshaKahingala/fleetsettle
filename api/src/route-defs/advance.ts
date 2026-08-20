import { createRoute } from "@hono/zod-openapi";
import {
  advanceResponseSchema,
  issueAdvanceRequestSchema,
  listAdvanceSettlementsResponseSchema,
  settleAdvanceRequestSchema,
  settledAdvanceResponseSchema,
  voidedAdvanceResponseSchema,
  voidedAdvanceSettlementResponseSchema,
  voidRequestSchema,
} from "@fleetsettle/shared/schemas";
import { z } from "zod";

const advanceIdParams = z.object({ id: z.string().uuid() });
const advanceSettlementParams = z.object({
  id: z.string().uuid(),
  settlementId: z.string().uuid(),
});

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
    400: { description: "replacesId names an advance against a different driver" },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot issue an advance" },
    404: { description: "No such driver or replacesId advance in this business" },
    409: {
      description:
        "That accounting period is closed, replacesId names an advance that isn't voided yet, or it has already been replaced (GAP-60)",
    },
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
      content: { "application/json": { schema: settledAdvanceResponseSchema } },
      description: "The advance, after this settlement",
    },
    400: {
      description:
        "This settlement would exceed the advance's original amount, or replacesId names a settlement against a different advance",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot settle an advance" },
    404: { description: "No such advance or replacesId settlement in this business" },
    409: {
      description:
        "That accounting period is closed, replacesId names a settlement that isn't voided yet, or it has already been replaced (GAP-60)",
    },
  },
});

/** GAP-147: every settlement recorded against one advance, newest first — the read a manager needs to find one to void, `dailyOperations` matching the endpoint it exists to serve. */
export const listAdvanceSettlementsRoute = createRoute({
  method: "get",
  path: "/{id}/settlement",
  request: { params: advanceIdParams },
  responses: {
    200: {
      content: { "application/json": { schema: listAdvanceSettlementsResponseSchema } },
      description: "Every settlement against this advance, newest first",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot view advance settlements" },
    404: { description: "No such advance in this business" },
  },
});

/** GAP-12/W-61/INV-36 §3.5: void, never delete — `advance.status` comes back recomputed from the live settlements that remain, restoring INV-17's trip-close block if it un-reconciles the advance. */
export const voidAdvanceSettlementRoute = createRoute({
  method: "post",
  path: "/{id}/settlement/{settlementId}/void",
  request: {
    params: advanceSettlementParams,
    body: { content: { "application/json": { schema: voidRequestSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: voidedAdvanceSettlementResponseSchema } },
      description: "The voided settlement, and the advance as it stands now",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot void a settlement" },
    404: { description: "No such settlement in this business" },
    409: { description: "Already voided, or PERIOD_CLOSED (GAP-35)" },
  },
});

/** GAP-12/W-61/INV-36 §3.6: void, never delete — refused (VOID_BLOCKED) while any settlement against it is still live; each is its own entered act and must be voided first. */
export const voidAdvanceRoute = createRoute({
  method: "post",
  path: "/{id}/void",
  request: {
    params: advanceIdParams,
    body: { content: { "application/json": { schema: voidRequestSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: voidedAdvanceResponseSchema } },
      description: "The voided advance",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot void an advance" },
    404: { description: "No such advance in this business" },
    409: {
      description:
        "Already voided, a live settlement is still against it (VOID_BLOCKED), or PERIOD_CLOSED (GAP-35)",
    },
  },
});
