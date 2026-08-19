import { OpenAPIHono } from "@hono/zod-openapi";
import { zodValidationHook } from "../errors/openapi-hook.js";
import { getSessionHandler } from "../handlers/session.js";
import { getSessionRoute } from "../route-defs/session.js";
import type { Env } from "../types.js";

/** Wiring only — mounted behind `dbMiddleware` + `verifyTokenMiddleware` in index.ts, alongside `/api/business` and `/api/invite/*` (IG §7.5). */
export const session = new OpenAPIHono<Env>({ defaultHook: zodValidationHook }).openapi(
  getSessionRoute,
  getSessionHandler,
);
