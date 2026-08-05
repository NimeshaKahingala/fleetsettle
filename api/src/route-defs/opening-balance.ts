import { createRoute } from "@hono/zod-openapi";
import {
  commitOpeningBalanceBatchRequestSchema,
  openingBalanceBatchResponseSchema,
} from "@fleetsettle/shared/schemas";

/**
 * F-0.2 / UC-09. Same request body backs the save and the confirm — see
 * `commitOpeningBalanceBatchRequestSchema`'s own comment — so both routes
 * declare the same 404 (a named party belongs to no business, or another
 * one) alongside their own invariant.
 */
export const saveOpeningBalanceRoute = createRoute({
  method: "put",
  path: "/",
  request: {
    body: { content: { "application/json": { schema: commitOpeningBalanceBatchRequestSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: openingBalanceBatchResponseSchema } },
      description: "The saved batch, draft or already committed",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot manage opening balances" },
    404: {
      description: "An entry names a vehicle, driver, customer or partner outside this business",
    },
    409: {
      description: "The first accounting period has closed — this is now an ordinary adjustment",
    },
  },
});

export const getOpeningBalanceRoute = createRoute({
  method: "get",
  path: "/",
  responses: {
    200: {
      content: { "application/json": { schema: openingBalanceBatchResponseSchema } },
      description: "The batch",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read opening balances" },
    404: { description: "No opening balance batch has been saved yet" },
  },
});

export const commitOpeningBalanceRoute = createRoute({
  method: "post",
  path: "/commit",
  responses: {
    200: {
      content: { "application/json": { schema: openingBalanceBatchResponseSchema } },
      description: "The committed batch",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot manage opening balances" },
    404: { description: "No opening balance batch has been saved yet" },
  },
});
