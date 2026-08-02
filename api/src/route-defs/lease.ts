import { createRoute } from "@hono/zod-openapi";
import {
  billingPeriodResponseSchema,
  closeLeaseRequestSchema,
  closeLeaseResponseSchema,
  leaseClosureSummaryResponseSchema,
  leaseResponseSchema,
  renewLeaseRequestSchema,
  settleLeaseDepositRequestSchema,
  settleLeaseDepositResponseSchema,
  startLeaseRequestSchema,
  startLeaseResponseSchema,
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
      content: { "application/json": { schema: startLeaseResponseSchema } },
      description: "The lease, plus the deposit taken at handover if one was",
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

/**
 * F-2.6/UC-16 steps 1–3 — "stop the clock," decide the final period's
 * charge, and (optionally) take the closing odometer reading. Only an
 * `active` lease can be closed; every period after this stops generating by
 * construction (`generateNextBillingPeriodTx`'s own guard).
 */
export const closeLeaseRoute = createRoute({
  method: "post",
  path: "/{id}/close",
  request: {
    params: leaseIdParams,
    body: { content: { "application/json": { schema: closeLeaseRequestSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: closeLeaseResponseSchema } },
      description: "The final period's own figures, after the chosen treatment",
    },
    400: { description: "This lease is not active, or no billing period covers the closing date" },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot close a lease" },
    404: { description: "No such lease in this business" },
    409: { description: "That accounting period is closed" },
  },
});

/** F-2.6 step 4/INV-18: everything outstanding, shown before anything is released. */
export const getLeaseClosureSummaryRoute = createRoute({
  method: "get",
  path: "/{id}/closure-summary",
  request: { params: leaseIdParams },
  responses: {
    200: {
      content: { "application/json": { schema: leaseClosureSummaryResponseSchema } },
      description: "Every unpaid amount owed by this lease's customer, plus any open incident",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read a closure summary" },
    404: { description: "No such lease in this business" },
  },
});

/** F-2.6 step 6/W-29/W-44: refund in full, retain a portion, or hold for the configured window. */
export const settleLeaseDepositRoute = createRoute({
  method: "post",
  path: "/{id}/settle-deposit",
  request: {
    params: leaseIdParams,
    body: { content: { "application/json": { schema: settleLeaseDepositRequestSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: settleLeaseDepositResponseSchema } },
      description: "The deposit's new status and its held balance",
    },
    400: { description: "The lease has not been stopped yet, or this deposit is not held" },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot settle a deposit" },
    404: { description: "No such lease in this business, or no deposit was taken on it" },
    409: { description: "That accounting period is closed" },
  },
});

/** F-2.6 step 7: the vehicle is marked available — its future occupancy beyond the closing date is freed. */
export const closeOutLeaseRoute = createRoute({
  method: "post",
  path: "/{id}/close-out",
  request: { params: leaseIdParams },
  responses: {
    200: {
      content: { "application/json": { schema: leaseResponseSchema } },
      description: "The lease, now closed",
    },
    400: { description: "The lease has not been stopped yet (step 1)" },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot close out a lease" },
    404: { description: "No such lease in this business" },
  },
});
