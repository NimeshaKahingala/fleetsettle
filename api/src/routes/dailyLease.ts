import { OpenAPIHono } from "@hono/zod-openapi";
import { zodValidationHook } from "../errors/openapi-hook.js";
import {
  changeDailyLeaseDriverHandler,
  changeDailyLeaseRateHandler,
  createLeaseDayExceptionHandler,
  endDailyLeaseHandler,
  getDailyLeaseHandler,
  listActiveDailyLeasesHandler,
  listLeaseDayExceptionsHandler,
  startDailyLeaseHandler,
  voidLeaseDayExceptionHandler,
} from "../handlers/dailyLease.js";
import {
  changeDailyLeaseDriverRoute,
  changeDailyLeaseRateRoute,
  createLeaseDayExceptionRoute,
  endDailyLeaseRoute,
  getDailyLeaseRoute,
  listActiveDailyLeasesRoute,
  listLeaseDayExceptionsRoute,
  startDailyLeaseRoute,
  voidLeaseDayExceptionRoute,
} from "../route-defs/dailyLease.js";
import type { Env } from "../types.js";

/** Wiring only (IG §3.2 step 7) — mounted behind `dbMiddleware` + `authMiddleware` in index.ts. */
export const dailyLease = new OpenAPIHono<Env>({ defaultHook: zodValidationHook })
  .openapi(startDailyLeaseRoute, startDailyLeaseHandler)
  .openapi(getDailyLeaseRoute, getDailyLeaseHandler)
  .openapi(listActiveDailyLeasesRoute, listActiveDailyLeasesHandler)
  .openapi(changeDailyLeaseDriverRoute, changeDailyLeaseDriverHandler)
  .openapi(changeDailyLeaseRateRoute, changeDailyLeaseRateHandler)
  .openapi(endDailyLeaseRoute, endDailyLeaseHandler)
  .openapi(createLeaseDayExceptionRoute, createLeaseDayExceptionHandler)
  .openapi(listLeaseDayExceptionsRoute, listLeaseDayExceptionsHandler)
  .openapi(voidLeaseDayExceptionRoute, voidLeaseDayExceptionHandler);
