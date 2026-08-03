import { createRoute } from "@hono/zod-openapi";
import {
  bookTripRequestSchema,
  cancelledTripResponseSchema,
  cancelTripRequestSchema,
  closedTripResponseSchema,
  closeTripRequestSchema,
  inProgressTripsResponseSchema,
  tripResponseSchema,
} from "@fleetsettle/shared/schemas";
import { z } from "zod";

const tripIdParams = z.object({ id: z.string().uuid() });

/** Home item 7 (UI §3.2): every trip still open (booked, not yet closed or cancelled). */
export const listInProgressTripsRoute = createRoute({
  method: "get",
  path: "/",
  responses: {
    200: {
      content: { "application/json": { schema: inProgressTripsResponseSchema } },
      description: "Trips still in progress",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read trips" },
  },
});

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

/**
 * F-5.4/UC-44/W-41. INV-17 blocks this while a driver advance against the
 * trip is unreconciled — the one place friction is correct, since it is
 * what keeps trip profit from becoming fiction.
 */
export const closeTripRoute = createRoute({
  method: "post",
  path: "/{id}/close",
  request: {
    params: tripIdParams,
    body: { content: { "application/json": { schema: closeTripRequestSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: closedTripResponseSchema } },
      description: "The closed trip, with its P&L",
    },
    400: { description: "The trip is cancelled, or the request is malformed" },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot close a trip" },
    404: { description: "No such trip in this business" },
    409: { description: "An advance against this trip is not yet reconciled (INV-17)" },
  },
});

/** F-5.5/UC-45: cancellation never blocks — an open advance is given a disposition here, not left implied. */
export const cancelTripRoute = createRoute({
  method: "post",
  path: "/{id}/cancel",
  request: {
    params: tripIdParams,
    body: { content: { "application/json": { schema: cancelTripRequestSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: cancelledTripResponseSchema } },
      description: "The cancelled trip",
    },
    400: { description: "The trip is already closed, or the request is malformed" },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot cancel a trip" },
    404: { description: "No such trip in this business" },
    409: { description: "An advance against this trip needs a disposition (INV-17)" },
  },
});
