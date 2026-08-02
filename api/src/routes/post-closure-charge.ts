import { OpenAPIHono } from "@hono/zod-openapi";
import { zodValidationHook } from "../errors/openapi-hook.js";
import { recordPostClosureChargeHandler } from "../handlers/post-closure-charge.js";
import { recordPostClosureChargeRoute } from "../route-defs/post-closure-charge.js";
import type { Env } from "../types.js";

/** Wiring only (IG §3.2 step 7) — mounted behind `dbMiddleware` + `authMiddleware` in index.ts. */
export const postClosureCharge = new OpenAPIHono<Env>({ defaultHook: zodValidationHook }).openapi(
  recordPostClosureChargeRoute,
  recordPostClosureChargeHandler,
);
