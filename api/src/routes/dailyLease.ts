import { OpenAPIHono } from "@hono/zod-openapi";
import { zodValidationHook } from "../errors/openapi-hook.js";
import {
  changeDailyLeaseDriverHandler,
  getDailyLeaseHandler,
  listActiveDailyLeasesHandler,
  startDailyLeaseHandler,
} from "../handlers/dailyLease.js";
import {
  changeDailyLeaseDriverRoute,
  getDailyLeaseRoute,
  listActiveDailyLeasesRoute,
  startDailyLeaseRoute,
} from "../route-defs/dailyLease.js";
import type { Env } from "../types.js";

/** Wiring only (IG §3.2 step 7) — mounted behind `dbMiddleware` + `authMiddleware` in index.ts. */
export const dailyLease = new OpenAPIHono<Env>({ defaultHook: zodValidationHook })
  .openapi(startDailyLeaseRoute, startDailyLeaseHandler)
  .openapi(getDailyLeaseRoute, getDailyLeaseHandler)
  .openapi(listActiveDailyLeasesRoute, listActiveDailyLeasesHandler)
  .openapi(changeDailyLeaseDriverRoute, changeDailyLeaseDriverHandler);
