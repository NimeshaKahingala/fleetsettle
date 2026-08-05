import { createRoute } from "@hono/zod-openapi";
import {
  createExpenseRequestSchema,
  expenseResponseSchema,
  listExpensesQuerySchema,
  listExpensesResponseSchema,
  voidedExpenseResponseSchema,
  voidExpenseRequestSchema,
} from "@fleetsettle/shared/schemas";
import { z } from "zod";

const expenseIdParams = z.object({ id: z.string().uuid() });

/** Web-P8b's costs list (F-3.1): every filter optional, newest first. No 404 for a filter naming another business's vehicle/trip/incident — the `businessId` AND already excludes it, same as Web-P2's day-record/trip/daily-lease lists never validate their own filter ids either. */
export const listExpensesRoute = createRoute({
  method: "get",
  path: "/",
  request: { query: listExpensesQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: listExpensesResponseSchema } },
      description: "Every expense matching the given filters, newest first, voided ones included",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read costs" },
  },
});

/** F-3.1/F-3.2/F-3.3, UC-60/UC-66. `vehicleId` absent is a valid overhead cost (UC-66, INV-24), never an error. */
export const createExpenseRoute = createRoute({
  method: "post",
  path: "/",
  request: {
    body: { content: { "application/json": { schema: createExpenseRequestSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: expenseResponseSchema } },
      description: "The expense",
    },
    400: { description: "borne-by names a party with no matching id" },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot record an expense" },
    404: { description: "No such vehicle, trip, driver or customer in this business" },
    409: { description: "That accounting period is closed" },
  },
});

/** F-8.5/UC-96/W-50: void, never delete — "wrong vehicle... fuel logged against the wrong trip." Correcting means voiding this one and recording a fresh one through the create endpoint above. */
export const voidExpenseRoute = createRoute({
  method: "post",
  path: "/{id}/void",
  request: {
    params: expenseIdParams,
    body: { content: { "application/json": { schema: voidExpenseRequestSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: voidedExpenseResponseSchema } },
      description: "The voided expense",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot void an expense" },
    404: { description: "No such expense in this business" },
    409: { description: "This expense has already been voided" },
  },
});
