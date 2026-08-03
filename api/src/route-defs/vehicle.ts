import { createRoute } from "@hono/zod-openapi";
import {
  businessDateSchema,
  createVehicleRequestSchema,
  listExpensesResponseSchema,
  listVehicleDocumentsResponseSchema,
  listVehiclesResponseSchema,
  upsertVehicleDocumentRequestSchema,
  vehicleCalendarResponseSchema,
  vehicleDailyLeaseHistoryResponseSchema,
  vehicleDocumentResponseSchema,
  vehicleLeaseHistoryResponseSchema,
  vehicleResponseSchema,
} from "@fleetsettle/shared/schemas";
import { z } from "zod";

const vehicleIdParams = z.object({ id: z.string().uuid() });
const vehicleCalendarQuery = z.object({ from: businessDateSchema, to: businessDateSchema });

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
