import { OpenAPIHono } from "@hono/zod-openapi";
import { zodValidationHook } from "../errors/openapi-hook.js";
import {
  archiveVehicleHandler,
  changeVehicleArrangementHandler,
  changeVehicleServiceIntervalHandler,
  createVehicleHandler,
  getVehicleCalendarHandler,
  getVehicleHandler,
  listVehicleDailyLeaseHistoryHandler,
  listVehicleDocumentsHandler,
  listVehicleExpensesHandler,
  listVehicleIncidentsHandler,
  listVehicleLeaseHistoryHandler,
  listVehicleTripsHandler,
  listVehicleUnavailabilityHandler,
  listVehiclesHandler,
  markVehicleUnavailableHandler,
  unarchiveVehicleHandler,
  upsertVehicleDocumentHandler,
  voidVehicleUnavailabilityHandler,
} from "../handlers/vehicle.js";
import {
  archiveVehicleRoute,
  changeVehicleArrangementRoute,
  changeVehicleServiceIntervalRoute,
  createVehicleRoute,
  getVehicleCalendarRoute,
  getVehicleRoute,
  listVehicleDailyLeaseHistoryRoute,
  listVehicleDocumentsRoute,
  listVehicleExpensesRoute,
  listVehicleIncidentsRoute,
  listVehicleLeaseHistoryRoute,
  listVehicleTripsRoute,
  listVehicleUnavailabilityRoute,
  listVehiclesRoute,
  markVehicleUnavailableRoute,
  unarchiveVehicleRoute,
  upsertVehicleDocumentRoute,
  voidVehicleUnavailabilityRoute,
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
  .openapi(changeVehicleServiceIntervalRoute, changeVehicleServiceIntervalHandler)
  .openapi(archiveVehicleRoute, archiveVehicleHandler)
  .openapi(unarchiveVehicleRoute, unarchiveVehicleHandler)
  .openapi(markVehicleUnavailableRoute, markVehicleUnavailableHandler)
  .openapi(listVehicleUnavailabilityRoute, listVehicleUnavailabilityHandler)
  .openapi(voidVehicleUnavailabilityRoute, voidVehicleUnavailabilityHandler);
