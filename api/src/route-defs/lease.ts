import { createRoute } from "@hono/zod-openapi";
import {
  billingPeriodResponseSchema,
  leaseResponseSchema,
  renewLeaseRequestSchema,
  startLeaseRequestSchema,
} from "@fleetsettle/shared/schemas";
import { z } from "zod";

const leaseIdParams = z.object({ id: z.string().uuid() });

/**
 * F-2.1 / UC-10 — starting arrangement A. One transaction: the `lease`
 * itself, the handover odometer reading (INV-19, when a mileage limit is
 * set) and the first `billing_period` it generates, with the rent due that
 * raises (domain/lease.ts). The vehicle_day_allocation calendar for
 * arrangement A is still materialised on a rolling horizon by P13's cron
 * (DM §4.1), not this endpoint — so INV-1 is not yet enforced for a lease
 * the way it is for a trip (below). Recorded here rather than silently
 * skipped.
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
    409: { description: "That accounting period is closed" },
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

/** F-2.5 / UC-17: same customer, new agreed amount from a date. Old periods keep their old figure. */
export const renewLeaseRoute = createRoute({
  method: "patch",
  path: "/{id}/renew",
  request: {
    params: leaseIdParams,
    body: { content: { "application/json": { schema: renewLeaseRequestSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: leaseResponseSchema } },
      description: "The lease, with its renewed terms",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot renew a lease" },
    404: { description: "No such lease in this business" },
  },
});

/**
 * F-2.1's invisible step, made callable: the next `billing_period` for this
 * lease, plus the rent due it raises. Idempotent on `(lease_id, seq)` — this
 * is the exact function P13's cron will call on a schedule; until that cron
 * exists, tapping this is how a second and later period gets generated.
 */
export const generateBillingPeriodRoute = createRoute({
  method: "post",
  path: "/{id}/billing-period",
  request: { params: leaseIdParams },
  responses: {
    201: {
      content: { "application/json": { schema: billingPeriodResponseSchema } },
      description: "The next billing period for this lease",
    },
    200: {
      content: { "application/json": { schema: billingPeriodResponseSchema } },
      description: "Already generated — the idempotent replay (same seq, no new due)",
    },
    400: { description: "This lease is not active — no further billing periods generate" },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot generate a billing period" },
    404: { description: "No such lease in this business" },
    409: { description: "That accounting period is closed" },
  },
});

export const listBillingPeriodsRoute = createRoute({
  method: "get",
  path: "/{id}/billing-period",
  request: { params: leaseIdParams },
  responses: {
    200: {
      content: { "application/json": { schema: z.array(billingPeriodResponseSchema) } },
      description: "Every billing period generated for this lease so far, oldest first",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read billing periods" },
    404: { description: "No such lease in this business" },
  },
});
