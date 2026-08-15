import { OpenAPIHono } from "@hono/zod-openapi";
import { zodValidationHook } from "../errors/openapi-hook.js";
import { voidObligationHandler } from "../handlers/obligation.js";
import { voidObligationRoute } from "../route-defs/obligation.js";
import type { Env } from "../types.js";

/** Wiring only (IG §3.2 step 7) — mounted behind `dbMiddleware` + `authMiddleware` in index.ts. */
export const obligation = new OpenAPIHono<Env>({ defaultHook: zodValidationHook }).openapi(
  voidObligationRoute,
  voidObligationHandler,
);
