import { OpenAPIHono } from "@hono/zod-openapi";
import { zodValidationHook } from "../errors/openapi-hook.js";
import { recordPaymentHandler } from "../handlers/payment.js";
import { recordPaymentRoute } from "../route-defs/payment.js";
import type { Env } from "../types.js";

/** Wiring only (IG §3.2 step 7) — mounted behind `dbMiddleware` + `authMiddleware` in index.ts. */
export const payment = new OpenAPIHono<Env>({ defaultHook: zodValidationHook }).openapi(
  recordPaymentRoute,
  recordPaymentHandler,
);
