import { OpenAPIHono } from "@hono/zod-openapi";
import { zodValidationHook } from "../errors/openapi-hook.js";
import { recordWriteOffHandler, recordWriteOffRecoveryHandler } from "../handlers/write-off.js";
import { recordWriteOffRecoveryRoute, recordWriteOffRoute } from "../route-defs/write-off.js";
import type { Env } from "../types.js";

/** Wiring only (IG §3.2 step 7) — mounted behind `dbMiddleware` + `authMiddleware` in index.ts. */
export const writeOff = new OpenAPIHono<Env>({ defaultHook: zodValidationHook })
  .openapi(recordWriteOffRoute, recordWriteOffHandler)
  .openapi(recordWriteOffRecoveryRoute, recordWriteOffRecoveryHandler);
