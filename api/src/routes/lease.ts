import { OpenAPIHono } from "@hono/zod-openapi";
import { zodValidationHook } from "../errors/openapi-hook.js";
import {
  closeLeaseHandler,
  closeOutLeaseHandler,
  generateBillingPeriodHandler,
  getLeaseClosureSummaryHandler,
  getLeaseDepositHandler,
  getLeaseHandler,
  listBillingPeriodsHandler,
  listLeaseObligationsHandler,
  renewLeaseHandler,
  settleLeaseDepositHandler,
  startLeaseHandler,
} from "../handlers/lease.js";
import {
  closeLeaseRoute,
  closeOutLeaseRoute,
  generateBillingPeriodRoute,
  getLeaseClosureSummaryRoute,
  getLeaseDepositRoute,
  getLeaseRoute,
  listBillingPeriodsRoute,
  listLeaseObligationsRoute,
  renewLeaseRoute,
  settleLeaseDepositRoute,
  startLeaseRoute,
} from "../route-defs/lease.js";
import type { Env } from "../types.js";

/** Wiring only (IG §3.2 step 7) — mounted behind `dbMiddleware` + `authMiddleware` in index.ts. */
export const lease = new OpenAPIHono<Env>({ defaultHook: zodValidationHook })
  .openapi(startLeaseRoute, startLeaseHandler)
  .openapi(getLeaseRoute, getLeaseHandler)
  .openapi(renewLeaseRoute, renewLeaseHandler)
  .openapi(generateBillingPeriodRoute, generateBillingPeriodHandler)
  .openapi(listBillingPeriodsRoute, listBillingPeriodsHandler)
  .openapi(listLeaseObligationsRoute, listLeaseObligationsHandler)
  .openapi(closeLeaseRoute, closeLeaseHandler)
  .openapi(getLeaseClosureSummaryRoute, getLeaseClosureSummaryHandler)
  .openapi(getLeaseDepositRoute, getLeaseDepositHandler)
  .openapi(settleLeaseDepositRoute, settleLeaseDepositHandler)
  .openapi(closeOutLeaseRoute, closeOutLeaseHandler);
