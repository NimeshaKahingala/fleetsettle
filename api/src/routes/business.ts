import { OpenAPIHono } from "@hono/zod-openapi";
import { zodValidationHook } from "../errors/openapi-hook.js";
import { createBusinessHandler } from "../handlers/business.js";
import { createBusinessRoute } from "../route-defs/business.js";
import type { Env } from "../types.js";

/** Wiring only (IG §3.2 step 7) — mounted behind `dbMiddleware` + `verifyTokenMiddleware` in index.ts, never `authMiddleware` (F-0.1: there is no business yet). */
export const business = new OpenAPIHono<Env>({ defaultHook: zodValidationHook }).openapi(
  createBusinessRoute,
  createBusinessHandler,
);
