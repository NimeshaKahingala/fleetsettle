import { createRoute } from "@hono/zod-openapi";
import {
  bankingEventResponseSchema,
  capitalContributionResponseSchema,
  grantManagementRequestSchema,
  managementFeeAgreementResponseSchema,
  ownershipSharesResponseSchema,
  partnerPayoutResponseSchema,
  recordBankingEventRequestSchema,
  recordCapitalContributionRequestSchema,
  recordPartnerPayoutRequestSchema,
  setOwnershipSharesRequestSchema,
} from "@fleetsettle/shared/schemas";
import { z } from "zod";

const idParams = z.object({ id: z.string().uuid() });

/** F-1.3/UC-02/INV-16. Shares not totalling 100% are refused — the deferred trigger, not a pre-check. */
export const setOwnershipSharesRoute = createRoute({
  method: "post",
  path: "/",
  request: {
    body: { content: { "application/json": { schema: setOwnershipSharesRequestSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: ownershipSharesResponseSchema } },
      description: "The ownership shares recorded for this vehicle and date",
    },
    400: { description: "Shares for this vehicle and date do not total 100% (INV-16)" },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot record ownership shares" },
    404: { description: "No such vehicle or partner in this business" },
  },
});

/** F-1.3/UC-02/W-52: what a partner paid, distinct from what he owns. */
export const recordCapitalContributionRoute = createRoute({
  method: "post",
  path: "/",
  request: {
    body: { content: { "application/json": { schema: recordCapitalContributionRequestSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: capitalContributionResponseSchema } },
      description: "The capital contribution",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot record a capital contribution" },
    404: { description: "No such vehicle or partner in this business" },
    409: { description: "That accounting period is closed" },
  },
});

/** F-1.4/UC-03/W-53: sharing a vehicle with a manager, with an optional monthly fee. */
export const grantManagementRoute = createRoute({
  method: "post",
  path: "/",
  request: {
    body: { content: { "application/json": { schema: grantManagementRequestSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: managementFeeAgreementResponseSchema } },
      description: "The management agreement",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot share a vehicle with a manager" },
    404: { description: "No such vehicle or manager in this business" },
    409: {
      description:
        "This vehicle already has a management agreement with this manager over one or more of these dates",
    },
  },
});

/** F-1.4: "Revoke — access ends, everything they entered stays" — sets `effective_to`, never deletes the row. */
export const revokeManagementRoute = createRoute({
  method: "post",
  path: "/{id}/revoke",
  request: { params: idParams },
  responses: {
    200: {
      content: { "application/json": { schema: managementFeeAgreementResponseSchema } },
      description: "The revoked management agreement",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot revoke a management agreement" },
    404: { description: "No such management agreement in this business" },
  },
});

/** F-7.4/UC-65/INV-23. A pooled shortfall attaches to the banking event itself, never guessed onto a receipt. */
export const recordBankingEventRoute = createRoute({
  method: "post",
  path: "/",
  request: {
    body: { content: { "application/json": { schema: recordBankingEventRequestSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: bankingEventResponseSchema } },
      description: "The banking event",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot record a banking event" },
    404: { description: "No such partner in this business" },
    409: { description: "That accounting period is closed" },
  },
});

/** F-7.2/UC-63: never a cost of the vehicle. */
export const recordPartnerPayoutRoute = createRoute({
  method: "post",
  path: "/",
  request: {
    body: { content: { "application/json": { schema: recordPartnerPayoutRequestSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: partnerPayoutResponseSchema } },
      description: "The partner payout",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot record a partner payout" },
    404: { description: "No such partner in this business" },
    409: { description: "That accounting period is closed" },
  },
});
