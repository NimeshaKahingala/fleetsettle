import { OpenAPIHono } from "@hono/zod-openapi";
import { zodValidationHook } from "../errors/openapi-hook.js";
import {
  decideRequestHandler,
  getAuditLogHandler,
  grantAdminHandler,
  listAdminsHandler,
  listBusinessesHandler,
  listRequestsHandler,
  listUsersHandler,
  revokeAdminHandler,
  setAllowanceHandler,
} from "../handlers/admin.js";
import {
  decideRequestRoute,
  getAuditLogRoute,
  grantAdminRoute,
  listAdminsRoute,
  listBusinessesRoute,
  listRequestsRoute,
  listUsersRoute,
  revokeAdminRoute,
  setAllowanceRoute,
} from "../route-defs/admin.js";
import type { Env } from "../types.js";

/** Wiring only (IG §3.2 step 7) — mounted behind `dbMiddleware` + `platformAdminMiddleware` in index.ts, never `authMiddleware` (IG §7.6). */
export const admin = new OpenAPIHono<Env>({ defaultHook: zodValidationHook })
  .openapi(listRequestsRoute, listRequestsHandler)
  .openapi(decideRequestRoute, decideRequestHandler)
  .openapi(listBusinessesRoute, listBusinessesHandler)
  .openapi(listUsersRoute, listUsersHandler)
  .openapi(setAllowanceRoute, setAllowanceHandler)
  .openapi(listAdminsRoute, listAdminsHandler)
  .openapi(grantAdminRoute, grantAdminHandler)
  .openapi(revokeAdminRoute, revokeAdminHandler)
  .openapi(getAuditLogRoute, getAuditLogHandler);
