import { createRoute } from "@hono/zod-openapi";
import {
  createVehicleRequestSchema,
  listVehiclesResponseSchema,
  upsertVehicleDocumentRequestSchema,
  vehicleDocumentResponseSchema,
  vehicleResponseSchema,
} from "@fleetsettle/shared/schemas";
import { z } from "zod";

const vehicleIdParams = z.object({ id: z.string().uuid() });

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
