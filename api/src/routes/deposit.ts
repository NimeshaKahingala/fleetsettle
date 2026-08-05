import { OpenAPIHono } from "@hono/zod-openapi";
import { zodValidationHook } from "../errors/openapi-hook.js";
import { recordDepositMovementHandler, takeDriverDepositHandler } from "../handlers/deposit.js";
import { recordDepositMovementRoute, takeDriverDepositRoute } from "../route-defs/deposit.js";
import type { Env } from "../types.js";

/** Wiring only (IG §3.2 step 7) — mounted behind `dbMiddleware` + `authMiddleware` in index.ts. */
export const deposit = new OpenAPIHono<Env>({ defaultHook: zodValidationHook })
  .openapi(takeDriverDepositRoute, takeDriverDepositHandler)
  .openapi(recordDepositMovementRoute, recordDepositMovementHandler);
