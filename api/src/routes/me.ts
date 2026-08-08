import { OpenAPIHono } from "@hono/zod-openapi";
import { zodValidationHook } from "../errors/openapi-hook.js";
import { getMeHandler } from "../handlers/me.js";
import { getMeRoute } from "../route-defs/me.js";
import type { Env } from "../types.js";

/**
 * B0b: promoted from a plain Hono route to a route-def, so `meResponseSchema`
 * lives in `@fleetsettle/shared` instead of `FirstRunGate`'s own local
 * interface — the one documented exception that stopped holding once B3 and
 * B4 both needed the same shape too. Wiring only (IG §3.2 step 7), mounted
 * behind `dbMiddleware` + `authMiddleware` in index.ts.
 */
export const me = new OpenAPIHono<Env>({ defaultHook: zodValidationHook }).openapi(
  getMeRoute,
  getMeHandler,
);
