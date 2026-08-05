import { createRoute } from "@hono/zod-openapi";
import { createCustomerRequestSchema, customerResponseSchema } from "@fleetsettle/shared/schemas";
import { z } from "zod";

const customerIdParams = z.object({ id: z.string().uuid() });
const listCustomersResponseSchema = z.array(customerResponseSchema);

/** F-2.1 / UC-10: reused wherever a customer is picked or created — not only inline in the lease-start flow. */
export const createCustomerRoute = createRoute({
  method: "post",
  path: "/",
  request: {
    body: { content: { "application/json": { schema: createCustomerRequestSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: customerResponseSchema } },
      description: "The customer",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot add a customer" },
  },
});

export const getCustomerRoute = createRoute({
  method: "get",
  path: "/{id}",
  request: { params: customerIdParams },
  responses: {
    200: {
      content: { "application/json": { schema: customerResponseSchema } },
      description: "The customer",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read customers" },
    // Cross-tenant is 404, never 403 (CLAUDE.md → Tenancy).
    404: { description: "No such customer in this business" },
  },
});

/** F-2.8: a repeat customer picker needs the list, not just a lookup by id. */
export const listCustomersRoute = createRoute({
  method: "get",
  path: "/",
  responses: {
    200: {
      content: { "application/json": { schema: listCustomersResponseSchema } },
      description: "Every customer in this business",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read customers" },
  },
});
