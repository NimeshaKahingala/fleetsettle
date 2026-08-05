import { OpenAPIHono } from "@hono/zod-openapi";
import { zodValidationHook } from "../errors/openapi-hook.js";
import { getAuditLogHandler } from "../handlers/audit-log.js";
import { getAuditLogRoute } from "../route-defs/audit-log.js";
import type { Env } from "../types.js";

/** Wiring only (IG §3.2 step 7) — mounted behind `dbMiddleware` + `authMiddleware` in index.ts. */
export const auditLogRoutes = new OpenAPIHono<Env>({ defaultHook: zodValidationHook }).openapi(
  getAuditLogRoute,
  getAuditLogHandler,
);
