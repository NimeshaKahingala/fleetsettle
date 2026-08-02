import { OpenAPIHono } from "@hono/zod-openapi";
import { zodValidationHook } from "../errors/openapi-hook.js";
import {
  grantManagementHandler,
  recordBankingEventHandler,
  recordCapitalContributionHandler,
  recordPartnerPayoutHandler,
  revokeManagementHandler,
  setOwnershipSharesHandler,
} from "../handlers/partner.js";
import {
  grantManagementRoute,
  recordBankingEventRoute,
  recordCapitalContributionRoute,
  recordPartnerPayoutRoute,
  revokeManagementRoute,
  setOwnershipSharesRoute,
} from "../route-defs/partner.js";
import type { Env } from "../types.js";

/** Wiring only (IG §3.2 step 7) — each mounted at its own top-level path in index.ts, the same flat-per-resource convention advance/deposit/offset already use despite all being "driver money." */
export const ownershipShare = new OpenAPIHono<Env>({ defaultHook: zodValidationHook }).openapi(
  setOwnershipSharesRoute,
  setOwnershipSharesHandler,
);

export const capitalContribution = new OpenAPIHono<Env>({
  defaultHook: zodValidationHook,
}).openapi(recordCapitalContributionRoute, recordCapitalContributionHandler);

export const managementFeeAgreement = new OpenAPIHono<Env>({ defaultHook: zodValidationHook })
  .openapi(grantManagementRoute, grantManagementHandler)
  .openapi(revokeManagementRoute, revokeManagementHandler);

export const bankingEvent = new OpenAPIHono<Env>({ defaultHook: zodValidationHook }).openapi(
  recordBankingEventRoute,
  recordBankingEventHandler,
);

export const partnerPayout = new OpenAPIHono<Env>({ defaultHook: zodValidationHook }).openapi(
  recordPartnerPayoutRoute,
  recordPartnerPayoutHandler,
);
