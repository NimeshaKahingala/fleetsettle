import { OpenAPIHono } from "@hono/zod-openapi";
import { zodValidationHook } from "../errors/openapi-hook.js";
import { redeemInviteHandler } from "../handlers/invite.js";
import { redeemInviteRoute } from "../route-defs/invite.js";
import type { Env } from "../types.js";

/** Wiring only (IG §3.2 step 7) — mounted behind `dbMiddleware` + `verifyTokenMiddleware` in index.ts, the same shape as `routes/business.ts`. */
export const invite = new OpenAPIHono<Env>({ defaultHook: zodValidationHook }).openapi(
  redeemInviteRoute,
  redeemInviteHandler,
);
