import { OpenAPIHono } from "@hono/zod-openapi";
import { zodValidationHook } from "../errors/openapi-hook.js";
import {
  closeAccountingPeriodHandler,
  getCloseChecklistHandler,
  listAccountingPeriodsHandler,
} from "../handlers/accounting-period.js";
import {
  closeAccountingPeriodRoute,
  getCloseChecklistRoute,
  listAccountingPeriodsRoute,
} from "../route-defs/accounting-period.js";
import type { Env } from "../types.js";

/** Wiring only (IG §3.2 step 7) — mounted behind `dbMiddleware` + `authMiddleware` in index.ts. */
export const accountingPeriodRoutes = new OpenAPIHono<Env>({ defaultHook: zodValidationHook })
  .openapi(listAccountingPeriodsRoute, listAccountingPeriodsHandler)
  .openapi(getCloseChecklistRoute, getCloseChecklistHandler)
  .openapi(closeAccountingPeriodRoute, closeAccountingPeriodHandler);
