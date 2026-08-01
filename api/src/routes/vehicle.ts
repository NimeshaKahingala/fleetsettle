import { OpenAPIHono } from "@hono/zod-openapi";
import { zodValidationHook } from "../errors/openapi-hook.js";
import {
  createVehicleHandler,
  getVehicleHandler,
  listVehiclesHandler,
  upsertVehicleDocumentHandler,
} from "../handlers/vehicle.js";
import {
  createVehicleRoute,
  getVehicleRoute,
  listVehiclesRoute,
  upsertVehicleDocumentRoute,
} from "../route-defs/vehicle.js";
import type { Env } from "../types.js";

/** Wiring only (IG §3.2 step 7) — mounted behind `dbMiddleware` + `authMiddleware` in index.ts. */
export const vehicle = new OpenAPIHono<Env>({ defaultHook: zodValidationHook })
  .openapi(createVehicleRoute, createVehicleHandler)
  .openapi(getVehicleRoute, getVehicleHandler)
  .openapi(listVehiclesRoute, listVehiclesHandler)
  .openapi(upsertVehicleDocumentRoute, upsertVehicleDocumentHandler);
