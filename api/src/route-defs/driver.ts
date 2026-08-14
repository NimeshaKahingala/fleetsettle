import { createRoute } from "@hono/zod-openapi";
import {
  archiveDriverRequestSchema,
  businessDateSchema,
  createDriverRequestSchema,
  driverBalancesResponseSchema,
  driverLinkInviteResponseSchema,
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

/** F-1.8/W-42/A11: `manageEntities` — the same gate as F-1.6 (add a driver), since F-1.8's own actor is "Manager" and this never touches `business_member`. Generates the code that lets this driver's own account reach `GET /api/driver-view` (INV-25 unaffected — that route still takes no `driverId`). */
export const inviteDriverLinkRoute = createRoute({
  method: "post",
  path: "/{id}/link-invite",
  request: { params: driverIdParams },
  responses: {
    201: {
      content: { "application/json": { schema: driverLinkInviteResponseSchema } },
      description: "The plaintext code — shown once, never retrievable again",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot link a driver's account" },
    404: { description: "No such driver in this business" },
  },
});

/** F-1.8's "Unlink" alternate: "his access ends, his record and history are untouched." */
export const unlinkDriverRoute = createRoute({
  method: "post",
  path: "/{id}/unlink",
  request: { params: driverIdParams },
  responses: {
    200: {
      content: { "application/json": { schema: driverResponseSchema } },
      description: "The driver, no longer linked to any account",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot unlink a driver's account" },
    404: { description: "No such driver in this business" },
  },
});

/** F-1.11/UC-100/W-60/INV-35: refused (409) while any due, payable, held deposit or unreconciled advance is still open — the refusal names every open figure separately. */
export const archiveDriverRoute = createRoute({
  method: "post",
  path: "/{id}/archive",
  request: {
    params: driverIdParams,
    body: { content: { "application/json": { schema: archiveDriverRequestSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: driverResponseSchema } },
      description: "The driver, archived",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot archive a driver" },
    404: { description: "No such driver in this business" },
    409: { description: "Already archived, or still carrying open money (INV-35)" },
  },
});

/** F-1.11's "Unarchive" alternate: back in every picker, history untouched either way. */
export const unarchiveDriverRoute = createRoute({
  method: "post",
  path: "/{id}/unarchive",
  request: { params: driverIdParams },
  responses: {
    200: {
      content: { "application/json": { schema: driverResponseSchema } },
      description: "The driver, no longer archived",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot unarchive a driver" },
    404: { description: "No such driver in this business" },
  },
});
