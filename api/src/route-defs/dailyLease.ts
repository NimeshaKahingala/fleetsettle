import { createRoute } from "@hono/zod-openapi";
import {
  dailyLeaseResponseSchema,
  startDailyLeaseRequestSchema,
} from "@fleetsettle/shared/schemas";
import { z } from "zod";

const dailyLeaseIdParams = z.object({ id: z.string().uuid() });

/**
 * F-1.7 / UC-05 — starting arrangement B. Writes `daily_lease` and its first
 * `daily_lease_rate` only (domain/dailyLease.ts) — DM §4.1 attributes the
 * vehicle_day_allocation/day_record calendar entirely to `generate-day-cards`,
 * a rolling-horizon cron job (P13), not this setup step.
 */
export const startDailyLeaseRoute = createRoute({
  method: "post",
  path: "/",
  request: {
    body: { content: { "application/json": { schema: startDailyLeaseRequestSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: dailyLeaseResponseSchema } },
      description: "The daily lease and its rate",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot set up a daily lease" },
    404: { description: "No such vehicle or driver in this business" },
    // DM §7's exclusion constraint — an overlapping daily lease already exists for this vehicle.
    409: { description: "This vehicle already has a daily lease over one or more of these dates" },
  },
});

export const getDailyLeaseRoute = createRoute({
  method: "get",
  path: "/{id}",
  request: { params: dailyLeaseIdParams },
  responses: {
    200: {
      content: { "application/json": { schema: dailyLeaseResponseSchema } },
      description: "The daily lease",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read daily leases" },
    404: { description: "No such daily lease in this business" },
  },
});
