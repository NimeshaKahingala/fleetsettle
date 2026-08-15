import { OpenAPIHono } from "@hono/zod-openapi";
import { zodValidationHook } from "../errors/openapi-hook.js";
import { createOffsetHandler, voidOffsetHandler } from "../handlers/offset.js";
import { createOffsetRoute, voidOffsetRoute } from "../route-defs/offset.js";
import type { Env } from "../types.js";

/** Wiring only (IG §3.2 step 7) — mounted behind `dbMiddleware` + `authMiddleware` in index.ts. */
export const offset = new OpenAPIHono<Env>({ defaultHook: zodValidationHook })
  .openapi(createOffsetRoute, createOffsetHandler)
  .openapi(voidOffsetRoute, voidOffsetHandler);
