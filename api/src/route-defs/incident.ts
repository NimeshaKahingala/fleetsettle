import { createRoute } from "@hono/zod-openapi";
import {
  incidentDetailResponseSchema,
  incidentRecoveryResponseSchema,
  insuranceClaimResponseSchema,
  listExpensesResponseSchema,
  openIncidentRequestSchema,
  recordCustomerContributionRequestSchema,
  recordOffRoadRequestSchema,
  recordOffRoadResponseSchema,
  recordRecoveryReceivedRequestSchema,
  settledInsuranceClaimResponseSchema,
  settleInsuranceClaimRequestSchema,
  submitInsuranceClaimRequestSchema,
} from "@fleetsettle/shared/schemas";
import { z } from "zod";

const incidentIdParams = z.object({ id: z.string().uuid() });
const recoveryParams = z.object({ id: z.string().uuid(), recoveryId: z.string().uuid() });
const claimParams = z.object({ id: z.string().uuid(), claimId: z.string().uuid() });

/** F-3.4 step 1/UC-12: the container, opened with its minimal fields — everything after is a separate edit (§6.6), not a wizard. */
export const openIncidentRoute = createRoute({
  method: "post",
  path: "/",
  request: {
    body: { content: { "application/json": { schema: openIncidentRequestSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: incidentDetailResponseSchema } },
      description: "The incident",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot report an incident" },
    404: { description: "No such vehicle or lease in this business" },
  },
});

/** F-3.4 step 6/UC-12: "total repair cost, total recovered, still expected, and net cost to you." */
export const getIncidentRoute = createRoute({
  method: "get",
  path: "/{id}",
  request: { params: incidentIdParams },
  responses: {
    200: {
      content: { "application/json": { schema: incidentDetailResponseSchema } },
      description: "The incident, with its bottom line",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read incidents" },
    404: { description: "No such incident in this business" },
  },
});

/** Web-P8a's incident screen, step 3: every repair cost logged against this incident so far, newest first, voided ones included. */
export const listIncidentExpensesRoute = createRoute({
  method: "get",
  path: "/{id}/expense",
  request: { params: incidentIdParams },
  responses: {
    200: {
      content: { "application/json": { schema: listExpensesResponseSchema } },
      description:
        "Every cost logged against this incident so far, newest first, voided ones included",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read incident costs" },
    404: { description: "No such incident in this business" },
  },
});

/** F-3.4 step 2/W-9: the off-road window and the rent treatment, entered together, "for this incident only." */
export const recordOffRoadRoute = createRoute({
  method: "post",
  path: "/{id}/off-road",
  request: {
    params: incidentIdParams,
    body: { content: { "application/json": { schema: recordOffRoadRequestSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: recordOffRoadResponseSchema } },
      description: "The incident, and any lease extension or rent adjustment it produced",
    },
    400: { description: "This lease has no end date to extend, or the off-road window is invalid" },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot record an incident's off-road period" },
    404: { description: "No such incident in this business" },
    409: { description: "PERIOD_CLOSED" },
  },
});

/** F-3.4 step 4/W-10: negotiated after the repair cost is known — an agreed amount plus a note. */
export const recordCustomerContributionRoute = createRoute({
  method: "post",
  path: "/{id}/customer-contribution",
  request: {
    params: incidentIdParams,
    body: { content: { "application/json": { schema: recordCustomerContributionRequestSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: incidentRecoveryResponseSchema } },
      description: "The customer's recovery row, agreed but not yet received",
    },
    400: { description: "This incident has no lease, so there is no customer to bill" },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot record a customer contribution" },
    404: { description: "No such incident in this business" },
    409: { description: "PERIOD_CLOSED" },
  },
});

/** F-3.4 steps 4/5: the money actually arriving, against the customer's own recovery row. */
export const recordRecoveryReceivedRoute = createRoute({
  method: "post",
  path: "/{id}/recovery/{recoveryId}/receive",
  request: {
    params: recoveryParams,
    body: { content: { "application/json": { schema: recordRecoveryReceivedRequestSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: incidentRecoveryResponseSchema } },
      description: "The recovery row, now (partly or fully) received",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot record a recovery as received" },
    404: { description: "No such recovery in this business" },
    409: {
      description: "PERIOD_CLOSED — a customer-sourced recovery also posts a payment (D-9/GAP-10)",
    },
  },
});

/** F-3.4 step 5/W-11: hidden unless enabled — major damage only. Writes the claim and its paired recovery row together. */
export const submitInsuranceClaimRoute = createRoute({
  method: "post",
  path: "/{id}/insurance-claim",
  request: {
    params: incidentIdParams,
    body: { content: { "application/json": { schema: submitInsuranceClaimRequestSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: insuranceClaimResponseSchema } },
      description: "The submitted claim",
    },
    400: { description: "The excess borne cannot exceed the amount claimed" },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot submit an insurance claim" },
    404: { description: "No such incident in this business" },
    409: { description: "An insurance claim already exists for this incident, or PERIOD_CLOSED" },
  },
});

/** F-3.4 step 5, later — updates the claim and its paired recovery row together, often after the claim's own posted period has closed (§7.2). */
export const settleInsuranceClaimRoute = createRoute({
  method: "post",
  path: "/{id}/insurance-claim/{claimId}/settle",
  request: {
    params: claimParams,
    body: { content: { "application/json": { schema: settleInsuranceClaimRequestSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: settledInsuranceClaimResponseSchema } },
      description: "The settled claim, and its paired recovery row",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot settle an insurance claim" },
    404: { description: "No such insurance claim in this business" },
  },
});

/** F-3.4: closed manually — no automatic status transition is attempted (deferred simplification, see domain/incident.ts). */
export const closeIncidentRoute = createRoute({
  method: "post",
  path: "/{id}/close",
  request: { params: incidentIdParams },
  responses: {
    200: {
      content: { "application/json": { schema: incidentDetailResponseSchema } },
      description: "The closed incident",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot close an incident" },
    404: { description: "No such incident in this business" },
  },
});
