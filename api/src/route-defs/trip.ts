import { createRoute } from "@hono/zod-openapi";
import {
  bookTripRequestSchema,
  cancelledTripResponseSchema,
  cancelTripRequestSchema,
  closedTripResponseSchema,
  closeTripRequestSchema,
  inProgressTripsResponseSchema,
  listExpensesResponseSchema,
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
 *
 * GAP-23/A6 made this period-dependent for the first time: when there is a
 * customer and an agreed amount, booking also posts a `trip_fare`
 * obligation, which needs an open accounting period the same way any other
 * money write does — PERIOD_CLOSED is a new failure mode on an
 * already-shipped endpoint, not a hypothetical one.
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
    409: {
      description:
        "This vehicle is already allocated for one or more of these dates (VEHICLE_DOUBLE_BOOKED), or PERIOD_CLOSED (GAP-23)",
    },
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
 * ST-5/GAP-7: the confirm half of "it expires or is confirmed" — `hold` →
 * `booked`. No body: nothing about the trip changes except its own status,
 * the daily lease's day records finally pausing, and — only now — a
 * `trip_fare` obligation if there is a customer and a nonzero agreed amount.
 */
export const confirmTripHoldRoute = createRoute({
  method: "post",
  path: "/{id}/confirm",
  request: { params: tripIdParams },
  responses: {
    200: {
      content: { "application/json": { schema: tripResponseSchema } },
      description: "The confirmed trip, now booked",
    },
    400: { description: "This trip is not a hold" },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot confirm a trip" },
    404: { description: "No such trip in this business" },
    409: { description: "PERIOD_CLOSED — no accounting period covers today yet" },
  },
});

/**
 * Web-P7: every cost logged against this trip so far — the open-trip
 * screen's own "Costs so far" (UI §7.5), read fresh rather than waiting for
 * `POST /{id}/close`'s own P&L, which only exists once the trip is already
 * closed.
 */
export const listTripExpensesRoute = createRoute({
  method: "get",
  path: "/{id}/expense",
  request: { params: tripIdParams },
  responses: {
    200: {
      content: { "application/json": { schema: listExpensesResponseSchema } },
      description: "Every cost logged against this trip so far, newest first, voided ones included",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read trip costs" },
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
    400: {
      description:
        "The trip is cancelled, is still a hold (GAP-7 — confirm it first), or the request is malformed",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot close a trip" },
    404: { description: "No such trip in this business" },
    409: { description: "An advance against this trip is not yet reconciled (INV-17)" },
  },
});

/**
 * F-5.5/UC-45: cancellation never blocks — an open advance is given a
 * disposition here, not left implied. GAP-23/A6: also voids any
 * `trip_fare` obligation this booking raised, which is why a trip booked
 * in a now-closed accounting period 409s PERIOD_CLOSED on cancel — voiding
 * a receivable changes that closed month's own figures (A9a/migration
 * 0008), the same rule any other void obeys.
 */
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
    409: {
      description:
        "An advance against this trip needs a disposition (INV-17), or PERIOD_CLOSED (GAP-23)",
    },
  },
});
