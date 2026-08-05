import { OpenAPIHono } from "@hono/zod-openapi";
import { zodValidationHook } from "../errors/openapi-hook.js";
import {
  commitOpeningBalanceHandler,
  getOpeningBalanceHandler,
  saveOpeningBalanceHandler,
} from "../handlers/opening-balance.js";
import {
  commitOpeningBalanceRoute,
  getOpeningBalanceRoute,
  saveOpeningBalanceRoute,
} from "../route-defs/opening-balance.js";
import type { Env } from "../types.js";

/** Wiring only (IG §3.2 step 7) — mounted behind `dbMiddleware` + `authMiddleware` in index.ts. */
export const openingBalance = new OpenAPIHono<Env>({ defaultHook: zodValidationHook })
  .openapi(saveOpeningBalanceRoute, saveOpeningBalanceHandler)
  .openapi(getOpeningBalanceRoute, getOpeningBalanceHandler)
  .openapi(commitOpeningBalanceRoute, commitOpeningBalanceHandler);
