import { OpenAPIHono } from "@hono/zod-openapi";
import { zodValidationHook } from "../errors/openapi-hook.js";
import {
  generateBillingPeriodHandler,
  getLeaseHandler,
  listBillingPeriodsHandler,
  renewLeaseHandler,
  startLeaseHandler,
} from "../handlers/lease.js";
import {
  generateBillingPeriodRoute,
  getLeaseRoute,
  listBillingPeriodsRoute,
  renewLeaseRoute,
  startLeaseRoute,
} from "../route-defs/lease.js";
import type { Env } from "../types.js";

/** Wiring only (IG §3.2 step 7) — mounted behind `dbMiddleware` + `authMiddleware` in index.ts. */
export const lease = new OpenAPIHono<Env>({ defaultHook: zodValidationHook })
  .openapi(startLeaseRoute, startLeaseHandler)
  .openapi(getLeaseRoute, getLeaseHandler)
  .openapi(renewLeaseRoute, renewLeaseHandler)
  .openapi(generateBillingPeriodRoute, generateBillingPeriodHandler)
  .openapi(listBillingPeriodsRoute, listBillingPeriodsHandler);
