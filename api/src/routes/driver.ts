import { OpenAPIHono } from "@hono/zod-openapi";
import { zodValidationHook } from "../errors/openapi-hook.js";
import {
  createDriverHandler,
  getDriverBalancesHandler,
  getDriverHandler,
  getDriverHistoryHandler,
  listDriversHandler,
} from "../handlers/driver.js";
import {
  createDriverRoute,
  getDriverBalancesRoute,
  getDriverHistoryRoute,
  getDriverRoute,
  listDriversRoute,
} from "../route-defs/driver.js";
import type { Env } from "../types.js";

/** Wiring only (IG §3.2 step 7) — mounted behind `dbMiddleware` + `authMiddleware` in index.ts. */
export const driver = new OpenAPIHono<Env>({ defaultHook: zodValidationHook })
  .openapi(createDriverRoute, createDriverHandler)
  .openapi(getDriverRoute, getDriverHandler)
  .openapi(listDriversRoute, listDriversHandler)
  .openapi(getDriverBalancesRoute, getDriverBalancesHandler)
  .openapi(getDriverHistoryRoute, getDriverHistoryHandler);
