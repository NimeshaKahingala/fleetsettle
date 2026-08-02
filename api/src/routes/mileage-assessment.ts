import { OpenAPIHono } from "@hono/zod-openapi";
import { zodValidationHook } from "../errors/openapi-hook.js";
import { recordOdometerReadingHandler } from "../handlers/mileage-assessment.js";
import { recordOdometerReadingRoute } from "../route-defs/mileage-assessment.js";
import type { Env } from "../types.js";

/** Wiring only (IG §3.2 step 7) — mounted behind `dbMiddleware` + `authMiddleware` in index.ts. */
export const mileageAssessment = new OpenAPIHono<Env>({ defaultHook: zodValidationHook }).openapi(
  recordOdometerReadingRoute,
  recordOdometerReadingHandler,
);
