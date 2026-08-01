import { createRoute } from "@hono/zod-openapi";
import { bookTripRequestSchema, tripResponseSchema } from "@fleetsettle/shared/schemas";
import { z } from "zod";

const tripIdParams = z.object({ id: z.string().uuid() });

/**
 * F-5.1 / UC-20 — starting arrangement C, the one arrangement whose calendar
 * is always fully materialised at booking (DM §4.1), so INV-1 is enforced
 * immediately here, unlike lease/daily-lease (see route-defs/lease.ts,
 * route-defs/dailyLease.ts). Does not touch `day_record` — P3's table.
 */
export const bookTripRoute = createRoute({
  method: "post",
  path: "/",
  request: {
    body: { content: { "application/json": { schema: bookTripRequestSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: tripResponseSchema } },
      description: "The trip",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot book a trip" },
    404: { description: "No such vehicle, customer or driver in this business" },
    // INV-1 (UC-20): the vehicle is already allocated for one or more of these dates.
    409: { description: "This vehicle is already allocated for one or more of these dates" },
  },
});

export const getTripRoute = createRoute({
  method: "get",
  path: "/{id}",
  request: { params: tripIdParams },
  responses: {
    200: {
      content: { "application/json": { schema: tripResponseSchema } },
      description: "The trip",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read trips" },
    404: { description: "No such trip in this business" },
  },
});
