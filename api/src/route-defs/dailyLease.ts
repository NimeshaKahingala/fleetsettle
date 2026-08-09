import { createRoute } from "@hono/zod-openapi";
import {
  activeDailyLeasesResponseSchema,
  dailyLeaseResponseSchema,
  startDailyLeaseRequestSchema,
} from "@fleetsettle/shared/schemas";
import { z } from "zod";

const dailyLeaseIdParams = z.object({ id: z.string().uuid() });

/** Home item 3 (UI §3.2): every active daily lease, so the caller can render a day card per vehicle without a follow-up lookup. */
export const listActiveDailyLeasesRoute = createRoute({
  method: "get",
  path: "/",
  responses: {
    200: {
      content: { "application/json": { schema: activeDailyLeasesResponseSchema } },
      description: "Every daily lease still running",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read daily leases" },
  },
});

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
    // DM §7's exclusion constraint, or GAP-84/F1's arrangement guard.
    409: {
      description:
        "This vehicle already has a daily lease over one or more of these dates, or is not configured for arrangement B (GAP-84)",
    },
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
