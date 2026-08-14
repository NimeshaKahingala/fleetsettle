import { OpenAPIHono } from "@hono/zod-openapi";
import { zodValidationHook } from "../errors/openapi-hook.js";
import {
  archiveVehicleHandler,
  changeVehicleArrangementHandler,
  createVehicleHandler,
  getVehicleCalendarHandler,
  getVehicleHandler,
  listVehicleDailyLeaseHistoryHandler,
  listVehicleDocumentsHandler,
  listVehicleExpensesHandler,
  listVehicleIncidentsHandler,
  listVehicleLeaseHistoryHandler,
  listVehicleTripsHandler,
  listVehiclesHandler,
  unarchiveVehicleHandler,
  upsertVehicleDocumentHandler,
} from "../handlers/vehicle.js";
import {
  archiveVehicleRoute,
  changeVehicleArrangementRoute,
  createVehicleRoute,
  getVehicleCalendarRoute,
  getVehicleRoute,
  listVehicleDailyLeaseHistoryRoute,
  listVehicleDocumentsRoute,
  listVehicleExpensesRoute,
  listVehicleIncidentsRoute,
  listVehicleLeaseHistoryRoute,
  listVehicleTripsRoute,
  listVehiclesRoute,
  unarchiveVehicleRoute,
  upsertVehicleDocumentRoute,
} from "../route-defs/vehicle.js";
import type { Env } from "../types.js";

/** Wiring only (IG §3.2 step 7) — mounted behind `dbMiddleware` + `authMiddleware` in index.ts. */
export const vehicle = new OpenAPIHono<Env>({ defaultHook: zodValidationHook })
  .openapi(createVehicleRoute, createVehicleHandler)
  .openapi(getVehicleRoute, getVehicleHandler)
  .openapi(listVehiclesRoute, listVehiclesHandler)
  .openapi(getVehicleCalendarRoute, getVehicleCalendarHandler)
  .openapi(upsertVehicleDocumentRoute, upsertVehicleDocumentHandler)
  .openapi(listVehicleDocumentsRoute, listVehicleDocumentsHandler)
  .openapi(listVehicleExpensesRoute, listVehicleExpensesHandler)
  .openapi(listVehicleIncidentsRoute, listVehicleIncidentsHandler)
  .openapi(listVehicleLeaseHistoryRoute, listVehicleLeaseHistoryHandler)
  .openapi(listVehicleDailyLeaseHistoryRoute, listVehicleDailyLeaseHistoryHandler)
  .openapi(listVehicleTripsRoute, listVehicleTripsHandler)
  .openapi(changeVehicleArrangementRoute, changeVehicleArrangementHandler)
  .openapi(archiveVehicleRoute, archiveVehicleHandler)
  .openapi(unarchiveVehicleRoute, unarchiveVehicleHandler);
