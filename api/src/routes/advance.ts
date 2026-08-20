import { OpenAPIHono } from "@hono/zod-openapi";
import { zodValidationHook } from "../errors/openapi-hook.js";
import {
  issueAdvanceHandler,
  listAdvanceSettlementsHandler,
  settleAdvanceHandler,
  voidAdvanceHandler,
  voidAdvanceSettlementHandler,
} from "../handlers/advance.js";
import {
  issueAdvanceRoute,
  listAdvanceSettlementsRoute,
  settleAdvanceRoute,
  voidAdvanceRoute,
  voidAdvanceSettlementRoute,
} from "../route-defs/advance.js";
import type { Env } from "../types.js";

/** Wiring only (IG §3.2 step 7) — mounted behind `dbMiddleware` + `authMiddleware` in index.ts. */
export const advance = new OpenAPIHono<Env>({ defaultHook: zodValidationHook })
  .openapi(issueAdvanceRoute, issueAdvanceHandler)
  .openapi(settleAdvanceRoute, settleAdvanceHandler)
  .openapi(listAdvanceSettlementsRoute, listAdvanceSettlementsHandler)
  .openapi(voidAdvanceSettlementRoute, voidAdvanceSettlementHandler)
  .openapi(voidAdvanceRoute, voidAdvanceHandler);
