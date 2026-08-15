import { createRoute } from "@hono/zod-openapi";
import {
  businessDateSchema,
  changeVehicleArrangementRequestSchema,
  changeVehicleServiceIntervalRequestSchema,
  createVehicleRequestSchema,
  listExpensesResponseSchema,
  listIncidentsResponseSchema,
  listVehicleDocumentsResponseSchema,
  listVehiclesResponseSchema,
  markVehicleUnavailableRequestSchema,
  upsertVehicleDocumentRequestSchema,
  vehicleArrangementResponseSchema,
  vehicleCalendarResponseSchema,
  vehicleDailyLeaseHistoryResponseSchema,
  vehicleDocumentResponseSchema,
  vehicleLeaseHistoryResponseSchema,
  vehicleResponseSchema,
  vehicleTripHistoryResponseSchema,
  vehicleUnavailabilityListResponseSchema,
  vehicleUnavailabilityResponseSchema,
  voidRequestSchema,
  voidedResponseSchema,
} from "@fleetsettle/shared/schemas";
import { z } from "zod";

const vehicleIdParams = z.object({ id: z.string().uuid() });
const vehicleCalendarQuery = z.object({ from: businessDateSchema, to: businessDateSchema });
const vehicleUnavailabilityIdParams = z.object({
  id: z.string().uuid(),
  unavailabilityId: z.string().uuid(),
});

/** F-1.1 / UC-01. */
export const createVehicleRoute = createRoute({
  method: "post",
  path: "/",
  request: {
    body: { content: { "application/json": { schema: createVehicleRequestSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: vehicleResponseSchema } },
      description: "The vehicle and its opening arrangement",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot add a vehicle" },
    // DM §4's UNIQUE(business_id, registration) — the same registration twice.
    409: { description: "A vehicle with this registration already exists" },
  },
});

/** Vehicle overview (P2 frontend). */
export const getVehicleRoute = createRoute({
  method: "get",
  path: "/{id}",
  request: { params: vehicleIdParams },
  responses: {
    200: {
      content: { "application/json": { schema: vehicleResponseSchema } },
      description: "The vehicle",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read vehicles" },
    // Cross-tenant is 404, never 403 (CLAUDE.md → Tenancy).
    404: { description: "No such vehicle in this business" },
  },
});

/** Vehicle list (P2 frontend). */
export const listVehiclesRoute = createRoute({
  method: "get",
  path: "/",
  responses: {
    200: {
      content: { "application/json": { schema: listVehiclesResponseSchema } },
      description: "Every vehicle in this business",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read vehicles" },
  },
});

/**
 * UC-95: "is the vehicle free on the 12th" — a single indexed range scan
 * over `vehicle_day_allocation` (DM §2), never a generate_series/day_record
 * merge. An absent date in the response is simply not scheduled.
 */
export const getVehicleCalendarRoute = createRoute({
  method: "get",
  path: "/{id}/calendar",
  request: { params: vehicleIdParams, query: vehicleCalendarQuery },
  responses: {
    200: {
      content: { "application/json": { schema: vehicleCalendarResponseSchema } },
      description: "Every occupied day for this vehicle in the given range",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read the vehicle calendar" },
    404: { description: "No such vehicle in this business" },
  },
});

/** F-10.1 / UC-92: upsert one document type's expiry — a renewal, never a new row. */
export const upsertVehicleDocumentRoute = createRoute({
  method: "put",
  path: "/{id}/document",
  request: {
    params: vehicleIdParams,
    body: { content: { "application/json": { schema: upsertVehicleDocumentRequestSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: vehicleDocumentResponseSchema } },
      description: "The upserted document",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot update vehicle paperwork" },
    404: { description: "No such vehicle in this business" },
  },
});

/** Vehicle overview's paperwork tab (Web-P5). */
export const listVehicleDocumentsRoute = createRoute({
  method: "get",
  path: "/{id}/document",
  request: { params: vehicleIdParams },
  responses: {
    200: {
      content: { "application/json": { schema: listVehicleDocumentsResponseSchema } },
      description: "Every document type this vehicle has a date set for",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read vehicle paperwork" },
    404: { description: "No such vehicle in this business" },
  },
});

/** Vehicle overview's costs tab (Web-P5). */
export const listVehicleExpensesRoute = createRoute({
  method: "get",
  path: "/{id}/expense",
  request: { params: vehicleIdParams },
  responses: {
    200: {
      content: { "application/json": { schema: listExpensesResponseSchema } },
      description: "Every expense logged against this vehicle, newest first, voided ones included",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read vehicle costs" },
    404: { description: "No such vehicle in this business" },
  },
});

/** Vehicle overview's history tab (Web-P5): arrangement-A periods. */
export const listVehicleLeaseHistoryRoute = createRoute({
  method: "get",
  path: "/{id}/lease",
  request: { params: vehicleIdParams },
  responses: {
    200: {
      content: { "application/json": { schema: vehicleLeaseHistoryResponseSchema } },
      description: "Every lease this vehicle has had, most recent first",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read vehicle history" },
    404: { description: "No such vehicle in this business" },
  },
});

/** Vehicle overview's own Incidents section (Web-P8a): every incident this vehicle has had, open and closed, newest first — `dailyOperations`, the same capability every other incident endpoint already uses (this is operational content, not vehicle master-data, unlike this file's other reads). */
export const listVehicleIncidentsRoute = createRoute({
  method: "get",
  path: "/{id}/incident",
  request: { params: vehicleIdParams },
  responses: {
    200: {
      content: { "application/json": { schema: listIncidentsResponseSchema } },
      description: "Every incident this vehicle has had, newest first",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read incidents" },
    404: { description: "No such vehicle in this business" },
  },
});

/** Vehicle overview's history tab (Web-P5): arrangement-B periods. */
export const listVehicleDailyLeaseHistoryRoute = createRoute({
  method: "get",
  path: "/{id}/daily-lease",
  request: { params: vehicleIdParams },
  responses: {
    200: {
      content: { "application/json": { schema: vehicleDailyLeaseHistoryResponseSchema } },
      description: "Every daily lease this vehicle has had, most recent first",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read vehicle history" },
    404: { description: "No such vehicle in this business" },
  },
});

/**
 * F-1.2/UC-94/GAP-54: "pick the new arrangement and an effective date."
 * `manageEntities` — this file's own default gate, the same one `createVehicleRoute`
 * uses; F-1.2's actor is "Owner or manager," the operational/setup group.
 */
export const changeVehicleArrangementRoute = createRoute({
  method: "post",
  path: "/{id}/arrangement",
  request: {
    params: vehicleIdParams,
    body: { content: { "application/json": { schema: changeVehicleArrangementRequestSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: vehicleArrangementResponseSchema } },
      description: "The new arrangement, open from effectiveFrom",
    },
    400: {
      description:
        "Already configured for this arrangement, or effectiveFrom is not after the current arrangement's (or its daily lease's) own start date",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot change a vehicle's arrangement" },
    404: { description: "No such vehicle in this business" },
    409: {
      description:
        "This vehicle has a lease that is not yet closed, or an open trip covering the effective date",
    },
  },
});

/** GAP-36/A9b item 2, ST-1: `active → archived`, "kept for history, no new allocations." `manageEntities` — the same gate `createVehicleRoute` uses. */
export const archiveVehicleRoute = createRoute({
  method: "post",
  path: "/{id}/archive",
  request: { params: vehicleIdParams },
  responses: {
    200: {
      content: { "application/json": { schema: vehicleResponseSchema } },
      description: "The vehicle, archived",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot archive a vehicle" },
    404: { description: "No such vehicle in this business" },
  },
});

/**
 * F-3.5/UC-13/GAP-68: "editable on the vehicle's own page." `null` clears
 * it — and clearing is exactly how a manager turns the prompt back off.
 */
export const changeVehicleServiceIntervalRoute = createRoute({
  method: "patch",
  path: "/{id}/service-interval",
  request: {
    params: vehicleIdParams,
    body: {
      content: { "application/json": { schema: changeVehicleServiceIntervalRequestSchema } },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: vehicleResponseSchema } },
      description: "The vehicle, with its service interval set (or cleared)",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot change a vehicle's service interval" },
    404: { description: "No such vehicle in this business" },
  },
});

/** The same "Unarchive" alternate F-1.11 offers a driver or customer — a vehicle archived by mistake, or one coming back into service. */
export const unarchiveVehicleRoute = createRoute({
  method: "post",
  path: "/{id}/unarchive",
  request: { params: vehicleIdParams },
  responses: {
    200: {
      content: { "application/json": { schema: vehicleResponseSchema } },
      description: "The vehicle, no longer archived",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot unarchive a vehicle" },
    404: { description: "No such vehicle in this business" },
  },
});

/** GAP-77/UC-71: an arrangement-C vehicle's own trip history — every status, most recent first. `dailyOperations`, matching `listVehicleIncidentsRoute` — operational content, not vehicle master-data. */
export const listVehicleTripsRoute = createRoute({
  method: "get",
  path: "/{id}/trip",
  request: { params: vehicleIdParams },
  responses: {
    200: {
      content: { "application/json": { schema: vehicleTripHistoryResponseSchema } },
      description: "Every trip this vehicle has had, newest first",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read trips" },
    404: { description: "No such vehicle in this business" },
  },
});

/**
 * F-1.10/GAP-26: mark a vehicle off the road — routine service, sale
 * preparation, or an owner's own use. Works regardless of the vehicle's
 * current arrangement, and deliberately does not duplicate an incident's
 * own `off_road_from`/`off_road_to` (§9.1).
 */
export const markVehicleUnavailableRoute = createRoute({
  method: "post",
  path: "/{id}/unavailability",
  request: {
    params: vehicleIdParams,
    body: { content: { "application/json": { schema: markVehicleUnavailableRequestSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: vehicleUnavailabilityResponseSchema } },
      description: "The outage",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot mark a vehicle off the road" },
    404: { description: "No such vehicle in this business" },
    409: { description: "This vehicle already has a live outage over one or more of these dates" },
  },
});

/** F-1.5's own calendar (UI §7.6): every live outage overlapping the given range, so a free-looking day can still say why it isn't. */
export const listVehicleUnavailabilityRoute = createRoute({
  method: "get",
  path: "/{id}/unavailability",
  request: { params: vehicleIdParams, query: vehicleCalendarQuery },
  responses: {
    200: {
      content: { "application/json": { schema: vehicleUnavailabilityListResponseSchema } },
      description: "Every live outage overlapping the given range",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read this vehicle's outages" },
    404: { description: "No such vehicle in this business" },
  },
});

/** F-1.10/GAP-26: correct or end an outage — voided, never deleted (W-58). No separate "end early" endpoint: the row that guessed wrong is voided, and a fresh one covers the corrected range if one is still needed. */
export const voidVehicleUnavailabilityRoute = createRoute({
  method: "post",
  path: "/{id}/unavailability/{unavailabilityId}/void",
  request: {
    params: vehicleUnavailabilityIdParams,
    body: { content: { "application/json": { schema: voidRequestSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: voidedResponseSchema } },
      description: "The outage, voided",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot manage this vehicle's outages" },
    404: { description: "No such outage on this vehicle" },
    409: { description: "This outage has already been undone" },
  },
});
