import { OpenAPIHono } from "@hono/zod-openapi";
import { zodValidationHook } from "../errors/openapi-hook.js";
import {
  getPartnerSummaryHandler,
  grantManagementHandler,
  listBankingEventsHandler,
  listCapitalContributionsHandler,
  listManagementFeeAgreementsHandler,
  listOwnershipSharesHandler,
  listPartnerPayoutsHandler,
  recordBankingEventHandler,
  recordCapitalContributionHandler,
  recordPartnerPayoutHandler,
  revokeManagementHandler,
  setOwnershipSharesHandler,
} from "../handlers/partner.js";
import {
  getPartnerSummaryRoute,
  grantManagementRoute,
  listBankingEventsRoute,
  listCapitalContributionsRoute,
  listManagementFeeAgreementsRoute,
  listOwnershipSharesRoute,
  listPartnerPayoutsRoute,
  recordBankingEventRoute,
  recordCapitalContributionRoute,
  recordPartnerPayoutRoute,
  revokeManagementRoute,
  setOwnershipSharesRoute,
} from "../route-defs/partner.js";
import type { Env } from "../types.js";

/** Wiring only (IG §3.2 step 7) — each mounted at its own top-level path in index.ts, the same flat-per-resource convention advance/deposit/offset already use despite all being "driver money." */
export const ownershipShare = new OpenAPIHono<Env>({ defaultHook: zodValidationHook })
  .openapi(setOwnershipSharesRoute, setOwnershipSharesHandler)
  .openapi(listOwnershipSharesRoute, listOwnershipSharesHandler);

export const capitalContribution = new OpenAPIHono<Env>({ defaultHook: zodValidationHook })
  .openapi(recordCapitalContributionRoute, recordCapitalContributionHandler)
  .openapi(listCapitalContributionsRoute, listCapitalContributionsHandler);

export const managementFeeAgreement = new OpenAPIHono<Env>({ defaultHook: zodValidationHook })
  .openapi(grantManagementRoute, grantManagementHandler)
  .openapi(revokeManagementRoute, revokeManagementHandler)
  .openapi(listManagementFeeAgreementsRoute, listManagementFeeAgreementsHandler);

export const bankingEvent = new OpenAPIHono<Env>({ defaultHook: zodValidationHook })
  .openapi(recordBankingEventRoute, recordBankingEventHandler)
  .openapi(listBankingEventsRoute, listBankingEventsHandler);

export const partnerPayout = new OpenAPIHono<Env>({ defaultHook: zodValidationHook })
  .openapi(recordPartnerPayoutRoute, recordPartnerPayoutHandler)
  .openapi(listPartnerPayoutsRoute, listPartnerPayoutsHandler);

/** A2/GAP-9/GAP-4/UC-67: the composed one-page-per-partner summary, mounted at `/api/partner` — distinct from the five sub-resources above. */
export const partner = new OpenAPIHono<Env>({ defaultHook: zodValidationHook }).openapi(
  getPartnerSummaryRoute,
  getPartnerSummaryHandler,
);
