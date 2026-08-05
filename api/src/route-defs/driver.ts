import { createRoute } from "@hono/zod-openapi";
import {
  businessDateSchema,
  createDriverRequestSchema,
  driverBalancesResponseSchema,
  driverResponseSchema,
  driverViewResponseSchema,
} from "@fleetsettle/shared/schemas";
import { z } from "zod";

const driverIdParams = z.object({ id: z.string().uuid() });
const listDriversResponseSchema = z.array(driverResponseSchema);
const driverHistoryQuery = z.object({ from: businessDateSchema, to: businessDateSchema });

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

/** W-2/INV-3: two figures, never netted — the net a manager sees is computed and displayed, never stored or returned as its own field. */
export const getDriverBalancesRoute = createRoute({
  method: "get",
  path: "/{id}/balances",
  request: { params: driverIdParams },
  responses: {
    200: {
      content: { "application/json": { schema: driverBalancesResponseSchema } },
      description: "What this driver owes, and is owed, as two separate figures",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read driver balances" },
    404: { description: "No such driver in this business" },
  },
});

/**
 * A5/GAP-24/GAP-29: the staff-facing twin of `GET /api/driver-view` —
 * same shape (both balances, days including excused ones, closed trips
 * and fees, advances, offsets, held deposit), keyed by an explicit,
 * business-scoped `{id}` instead of the caller's own identity. INV-25
 * only forbids a `driverId` slot on the *linked driver's own* route; this
 * is a genuinely separate route with a genuinely different gate.
 */
export const getDriverHistoryRoute = createRoute({
  method: "get",
  path: "/{id}/view",
  request: { params: driverIdParams, query: driverHistoryQuery },
  responses: {
    200: {
      content: { "application/json": { schema: driverViewResponseSchema } },
      description: "This driver's two balances, days, trips, advances, offsets and deposit",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read a driver's history" },
    // Cross-tenant is 404, never 403 (CLAUDE.md → Tenancy).
    404: { description: "No such driver in this business" },
  },
});
