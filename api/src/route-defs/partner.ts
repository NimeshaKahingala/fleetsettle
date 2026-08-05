import { createRoute } from "@hono/zod-openapi";
import {
  bankingEventResponseSchema,
  bankingEventsResponseSchema,
  capitalContributionResponseSchema,
  capitalContributionsResponseSchema,
  grantManagementRequestSchema,
  listBankingEventsQuerySchema,
  listCapitalContributionsQuerySchema,
  listManagementFeeAgreementsQuerySchema,
  listOwnershipSharesQuerySchema,
  listPartnerPayoutsQuerySchema,
  managementFeeAgreementResponseSchema,
  managementFeeAgreementsResponseSchema,
  ownershipSharesResponseSchema,
  partnerPayoutResponseSchema,
  partnerPayoutsResponseSchema,
  partnerSummaryResponseSchema,
  recordBankingEventRequestSchema,
  recordCapitalContributionRequestSchema,
  recordPartnerPayoutRequestSchema,
  setOwnershipSharesRequestSchema,
} from "@fleetsettle/shared/schemas";
import { z } from "zod";

const idParams = z.object({ id: z.string().uuid() });
const userIdParams = z.object({ userId: z.string().uuid() });

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

/** A2/GAP-9: the currently active split only — every share row in force today, across every vehicle unless `vehicleId` narrows it. `managePartnerCapital` (OWNERS) — GAP-1 is still open, so this is flat and business-wide, not scoped to vehicles this partner actually owns. */
export const listOwnershipSharesRoute = createRoute({
  method: "get",
  path: "/",
  request: { query: listOwnershipSharesQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: ownershipSharesResponseSchema } },
      description: "The currently active ownership split, one row per owner per vehicle",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read ownership shares" },
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

/** A2/GAP-9/W-52: newest-contributed-first. What a partner *paid* — never render this as, or alongside, what he *owns* (`ownership_share`) without the caller understanding they are two different facts. */
export const listCapitalContributionsRoute = createRoute({
  method: "get",
  path: "/",
  request: { query: listCapitalContributionsQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: capitalContributionsResponseSchema } },
      description: "Capital contributions, newest first",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read capital contributions" },
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

/** A2/GAP-9: **revoked agreements are returned, not filtered out** — F-1.4's own "everything they entered stays." Ordered per vehicle, most recent `effectiveFrom` first, so an active agreement always sorts ahead of one it superseded. */
export const listManagementFeeAgreementsRoute = createRoute({
  method: "get",
  path: "/",
  request: { query: listManagementFeeAgreementsQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: managementFeeAgreementsResponseSchema } },
      description: "Every management agreement, including revoked ones",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read management agreements" },
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

/** A2/GAP-9: newest-banked-first. Never called "deposit" (§1.5). */
export const listBankingEventsRoute = createRoute({
  method: "get",
  path: "/",
  request: { query: listBankingEventsQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: bankingEventsResponseSchema } },
      description: "Banking events, newest first",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read banking events" },
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

/** A2/GAP-9: newest-occurred-first. Never a cost of the vehicle, same as the write above. */
export const listPartnerPayoutsRoute = createRoute({
  method: "get",
  path: "/",
  request: { query: listPartnerPayoutsQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: partnerPayoutsResponseSchema } },
      description: "Payouts and partner settlements, newest first",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read partner payouts" },
  },
});

/** A2/GAP-9/GAP-4/UC-67/W-52/W-53: "one page per partner, four lines" — mounted at its own `/api/partner`, distinct from the five sub-resources above. */
export const getPartnerSummaryRoute = createRoute({
  method: "get",
  path: "/{userId}",
  request: { params: userIdParams },
  responses: {
    200: {
      content: { "application/json": { schema: partnerSummaryResponseSchema } },
      description: "What this partner put in, took out, earned this period, and holds",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read a partner's summary" },
    404: { description: "No such partner in this business, or no open accounting period" },
  },
});
