import { OpenAPIHono } from "@hono/zod-openapi";
import { zodValidationHook } from "../errors/openapi-hook.js";
import {
  createAdjustmentHandler,
  listAdjustmentsHandler,
  voidAdjustmentHandler,
} from "../handlers/adjustment.js";
import {
  createAdjustmentRoute,
  listAdjustmentsRoute,
  voidAdjustmentRoute,
} from "../route-defs/adjustment.js";
import type { Env } from "../types.js";

/** Wiring only (IG §3.2 step 7) — mounted behind `dbMiddleware` + `authMiddleware` in index.ts. */
export const adjustment = new OpenAPIHono<Env>({ defaultHook: zodValidationHook })
  .openapi(createAdjustmentRoute, createAdjustmentHandler)
  .openapi(listAdjustmentsRoute, listAdjustmentsHandler)
  .openapi(voidAdjustmentRoute, voidAdjustmentHandler);
