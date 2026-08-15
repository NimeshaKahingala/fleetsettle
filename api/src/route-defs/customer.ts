import { createRoute } from "@hono/zod-openapi";
import {
  archiveCustomerRequestSchema,
  createCustomerRequestSchema,
  customerResponseSchema,
  listCustomerObligationsResponseSchema,
  listPaymentsResponseSchema,
} from "@fleetsettle/shared/schemas";
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

/** A4/GAP-22: the customer detail screen's dues — outstanding obligations only, oldest due first. */
export const listCustomerObligationsRoute = createRoute({
  method: "get",
  path: "/{id}/obligation",
  request: { params: customerIdParams },
  responses: {
    200: {
      content: { "application/json": { schema: listCustomerObligationsResponseSchema } },
      description: "This customer's outstanding dues, oldest due first",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read a customer's dues" },
    // Cross-tenant is 404, never 403 (CLAUDE.md → Tenancy).
    404: { description: "No such customer in this business" },
  },
});

/** A4/GAP-22: the customer detail screen's payment history, newest first. */
export const listCustomerPaymentsRoute = createRoute({
  method: "get",
  path: "/{id}/payment",
  request: { params: customerIdParams },
  responses: {
    200: {
      content: { "application/json": { schema: listPaymentsResponseSchema } },
      description: "Every payment this customer has made, newest first",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read a customer's payments" },
    // Cross-tenant is 404, never 403 (CLAUDE.md → Tenancy).
    404: { description: "No such customer in this business" },
  },
});

/** F-1.11/UC-100/W-60/INV-35: refused (409) while any due, payable, held deposit is still open — the refusal names every open figure separately. */
export const archiveCustomerRoute = createRoute({
  method: "post",
  path: "/{id}/archive",
  request: {
    params: customerIdParams,
    body: { content: { "application/json": { schema: archiveCustomerRequestSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: customerResponseSchema } },
      description: "The customer, archived",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot archive a customer" },
    404: { description: "No such customer in this business" },
    409: { description: "Already archived, or still carrying open money (INV-35)" },
  },
});

/** F-1.11's "Unarchive" alternate: back in every picker, history untouched either way. */
export const unarchiveCustomerRoute = createRoute({
  method: "post",
  path: "/{id}/unarchive",
  request: { params: customerIdParams },
  responses: {
    200: {
      content: { "application/json": { schema: customerResponseSchema } },
      description: "The customer, no longer archived",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot unarchive a customer" },
    404: { description: "No such customer in this business" },
  },
});
