import { createRoute } from "@hono/zod-openapi";
import {
  createExpenseRequestSchema,
  expensePrefillVehicleResponseSchema,
  expenseResponseSchema,
  listExpensesQuerySchema,
  listExpensesResponseSchema,
  resolveBorneByQuerySchema,
  resolveBorneByResponseSchema,
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
    // GAP-180/B24: the query string is schema-validated, so a bad filter is a
    // 400 from `defaultHook`, not an empty list.
    400: { description: "A query filter failed validation" },
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
    400: {
      description:
        "borne-by names a party with no matching id, or odometerReadingKm is given without a vehicleId (GAP-30)",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot record an expense" },
    404: {
      description: "No such vehicle, trip, driver, customer or replacesId expense in this business",
    },
    409: {
      description:
        "That accounting period is closed, replacesId names an expense that isn't voided yet, or it has already been replaced (GAP-60)",
    },
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
    409: { description: "This expense has already been voided, or PERIOD_CLOSED (GAP-35)" },
  },
});

/** GAP-32/§6.7: a live preview of the default-owner matrix — lets the client show who a cost would default to before offering an override to someone else, reusing `resolveBorneByDefault` rather than a second implementation of the matrix. */
export const resolveBorneByRoute = createRoute({
  method: "get",
  path: "/borne-by-default",
  request: { query: resolveBorneByQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: resolveBorneByResponseSchema } },
      description: "What borneBy would default to for this vehicle/category/date, if saved now",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot record an expense" },
    404: { description: "No such vehicle in this business" },
  },
});

/** GAP-34/U-3: the vehicle with something pending, for the expense form's own vehicle picker to default to. */
export const expensePrefillVehicleRoute = createRoute({
  method: "get",
  path: "/prefill-vehicle",
  responses: {
    200: {
      content: { "application/json": { schema: expensePrefillVehicleResponseSchema } },
      description: "The vehicle with the oldest unconfirmed day, or null when nothing is pending",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot record an expense" },
  },
});
