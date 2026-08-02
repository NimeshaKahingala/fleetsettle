import { OpenAPIHono } from "@hono/zod-openapi";
import { zodValidationHook } from "../errors/openapi-hook.js";
import {
  bookTripHandler,
  cancelTripHandler,
  closeTripHandler,
  getTripHandler,
} from "../handlers/trip.js";
import {
  bookTripRoute,
  cancelTripRoute,
  closeTripRoute,
  getTripRoute,
} from "../route-defs/trip.js";
import type { Env } from "../types.js";

/** Wiring only (IG §3.2 step 7) — mounted behind `dbMiddleware` + `authMiddleware` in index.ts. */
export const trip = new OpenAPIHono<Env>({ defaultHook: zodValidationHook })
  .openapi(bookTripRoute, bookTripHandler)
  .openapi(getTripRoute, getTripHandler)
  .openapi(closeTripRoute, closeTripHandler)
  .openapi(cancelTripRoute, cancelTripHandler);
