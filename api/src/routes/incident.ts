import { OpenAPIHono } from "@hono/zod-openapi";
import { zodValidationHook } from "../errors/openapi-hook.js";
import {
  closeIncidentHandler,
  getIncidentHandler,
  listIncidentExpensesHandler,
  openIncidentHandler,
  recordCustomerContributionHandler,
  recordOffRoadHandler,
  recordRecoveryReceivedHandler,
  settleInsuranceClaimHandler,
  submitInsuranceClaimHandler,
} from "../handlers/incident.js";
import {
  closeIncidentRoute,
  getIncidentRoute,
  listIncidentExpensesRoute,
  openIncidentRoute,
  recordCustomerContributionRoute,
  recordOffRoadRoute,
  recordRecoveryReceivedRoute,
  settleInsuranceClaimRoute,
  submitInsuranceClaimRoute,
} from "../route-defs/incident.js";
import type { Env } from "../types.js";

/** Wiring only (IG §3.2 step 7) — mounted behind `dbMiddleware` + `authMiddleware` in index.ts. */
export const incident = new OpenAPIHono<Env>({ defaultHook: zodValidationHook })
  .openapi(openIncidentRoute, openIncidentHandler)
  .openapi(getIncidentRoute, getIncidentHandler)
  .openapi(listIncidentExpensesRoute, listIncidentExpensesHandler)
  .openapi(recordOffRoadRoute, recordOffRoadHandler)
  .openapi(recordCustomerContributionRoute, recordCustomerContributionHandler)
  .openapi(recordRecoveryReceivedRoute, recordRecoveryReceivedHandler)
  .openapi(submitInsuranceClaimRoute, submitInsuranceClaimHandler)
  .openapi(settleInsuranceClaimRoute, settleInsuranceClaimHandler)
  .openapi(closeIncidentRoute, closeIncidentHandler);
