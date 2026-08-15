import { OpenAPIHono } from "@hono/zod-openapi";
import { zodValidationHook } from "../errors/openapi-hook.js";
import {
  archiveDriverHandler,
  createDriverHandler,
  getDriverBalancesHandler,
  getDriverHandler,
  getDriverHistoryHandler,
  inviteDriverLinkHandler,
  listDriversHandler,
  unarchiveDriverHandler,
  unlinkDriverHandler,
} from "../handlers/driver.js";
import {
  archiveDriverRoute,
  createDriverRoute,
  getDriverBalancesRoute,
  getDriverHistoryRoute,
  getDriverRoute,
  inviteDriverLinkRoute,
  listDriversRoute,
  unarchiveDriverRoute,
  unlinkDriverRoute,
} from "../route-defs/driver.js";
import type { Env } from "../types.js";

/** Wiring only (IG §3.2 step 7) — mounted behind `dbMiddleware` + `authMiddleware` in index.ts. */
export const driver = new OpenAPIHono<Env>({ defaultHook: zodValidationHook })
  .openapi(createDriverRoute, createDriverHandler)
  .openapi(getDriverRoute, getDriverHandler)
  .openapi(listDriversRoute, listDriversHandler)
  .openapi(getDriverBalancesRoute, getDriverBalancesHandler)
  .openapi(getDriverHistoryRoute, getDriverHistoryHandler)
  .openapi(inviteDriverLinkRoute, inviteDriverLinkHandler)
  .openapi(unlinkDriverRoute, unlinkDriverHandler)
  .openapi(archiveDriverRoute, archiveDriverHandler)
  .openapi(unarchiveDriverRoute, unarchiveDriverHandler);
