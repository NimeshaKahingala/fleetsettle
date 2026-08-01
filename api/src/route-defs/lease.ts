import { createRoute } from "@hono/zod-openapi";
import { leaseResponseSchema, startLeaseRequestSchema } from "@fleetsettle/shared/schemas";
import { z } from "zod";

const leaseIdParams = z.object({ id: z.string().uuid() });

/**
 * F-2.1 / UC-10 — starting arrangement A. Writes only the `lease` row itself
 * (DM §6): the vehicle_day_allocation calendar for arrangement A is
 * materialised on a rolling horizon by the same cron that rolls billing
 * periods (DM §4.1), which is P13's territory, not this endpoint's — so
 * INV-1 is not yet enforced for a lease the way it is for a trip (below).
 * Recorded here rather than silently skipped.
 */
export const startLeaseRoute = createRoute({
  method: "post",
  path: "/",
  request: {
    body: { content: { "application/json": { schema: startLeaseRequestSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: leaseResponseSchema } },
      description: "The lease",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot start a lease" },
    404: { description: "No such vehicle or customer in this business" },
  },
});

export const getLeaseRoute = createRoute({
  method: "get",
  path: "/{id}",
  request: { params: leaseIdParams },
  responses: {
    200: {
      content: { "application/json": { schema: leaseResponseSchema } },
      description: "The lease",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read leases" },
    404: { description: "No such lease in this business" },
  },
});
