import { OpenAPIHono } from "@hono/zod-openapi";
import { zodValidationHook } from "../errors/openapi-hook.js";
import { getDepositReleasesHandler, getPaperworkWarningsHandler } from "../handlers/home.js";
import { getDepositReleasesRoute, getPaperworkWarningsRoute } from "../route-defs/home.js";
import type { Env } from "../types.js";

/** Wiring only (IG §3.2 step 7) — mounted behind `dbMiddleware` + `authMiddleware` in index.ts. */
export const home = new OpenAPIHono<Env>({ defaultHook: zodValidationHook })
  .openapi(getPaperworkWarningsRoute, getPaperworkWarningsHandler)
  .openapi(getDepositReleasesRoute, getDepositReleasesHandler);
