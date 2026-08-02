import { OpenAPIHono } from "@hono/zod-openapi";
import { zodValidationHook } from "../errors/openapi-hook.js";
import { getDriverViewHandler } from "../handlers/driver-view.js";
import { getDriverViewRoute } from "../route-defs/driver-view.js";
import type { Env } from "../types.js";

/** Wiring only (IG §3.2 step 7) — mounted behind `dbMiddleware` + `authMiddleware` in index.ts. */
export const driverView = new OpenAPIHono<Env>({ defaultHook: zodValidationHook }).openapi(
  getDriverViewRoute,
  getDriverViewHandler,
);
