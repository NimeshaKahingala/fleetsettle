import { createRoute } from "@hono/zod-openapi";
import {
  closeAccountingPeriodResponseSchema,
  closeChecklistResponseSchema,
  listAccountingPeriodsResponseSchema,
} from "@fleetsettle/shared/schemas";

/** A3: this business's whole period history, newest first — so a screen can show which months are closed. */
export const listAccountingPeriodsRoute = createRoute({
  method: "get",
  path: "/",
  responses: {
    200: {
      content: { "application/json": { schema: listAccountingPeriodsResponseSchema } },
      description: "Every accounting period this business has had, newest first",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot view accounting periods" },
  },
});

/** F-9.1 step 1/UC-98: the pre-close checklist, reviewable before committing to close. */
export const getCloseChecklistRoute = createRoute({
  method: "get",
  path: "/checklist",
  responses: {
    200: {
      content: { "application/json": { schema: closeChecklistResponseSchema } },
      description: "The currently open period, and what it lists before closing",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot close a period" },
    404: { description: "No open accounting period for this business" },
  },
});

/** F-9.1/UC-98: close the currently open period and open its successor in the same transaction (DM §3.1). One-way — there is no reopen (W-35). */
export const closeAccountingPeriodRoute = createRoute({
  method: "post",
  path: "/close",
  responses: {
    200: {
      content: { "application/json": { schema: closeAccountingPeriodResponseSchema } },
      description: "The closed period, its successor, and the checklist as it stood at close",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot close a period" },
    404: { description: "No open accounting period for this business" },
  },
});
