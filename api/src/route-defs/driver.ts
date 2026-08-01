import { createRoute } from "@hono/zod-openapi";
import { createDriverRequestSchema, driverResponseSchema } from "@fleetsettle/shared/schemas";
import { z } from "zod";

const driverIdParams = z.object({ id: z.string().uuid() });
const listDriversResponseSchema = z.array(driverResponseSchema);

/** F-1.6 / UC-04. */
export const createDriverRoute = createRoute({
  method: "post",
  path: "/",
  request: {
    body: { content: { "application/json": { schema: createDriverRequestSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: driverResponseSchema } },
      description: "The driver",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot add a driver" },
  },
});

export const getDriverRoute = createRoute({
  method: "get",
  path: "/{id}",
  request: { params: driverIdParams },
  responses: {
    200: {
      content: { "application/json": { schema: driverResponseSchema } },
      description: "The driver",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read drivers" },
    // Cross-tenant is 404, never 403 (CLAUDE.md → Tenancy).
    404: { description: "No such driver in this business" },
  },
});

export const listDriversRoute = createRoute({
  method: "get",
  path: "/",
  responses: {
    200: {
      content: { "application/json": { schema: listDriversResponseSchema } },
      description: "Every driver in this business",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read drivers" },
  },
});
