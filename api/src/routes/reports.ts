import { OpenAPIHono } from "@hono/zod-openapi";
import { zodValidationHook } from "../errors/openapi-hook.js";
import {
  getAgeingReportHandler,
  getCashPositionReportHandler,
  getFuelEfficiencyReportHandler,
  getGoodwillReportHandler,
  getLostDaysReportHandler,
  getOverheadsReportHandler,
  getReceivablesReportHandler,
  getTripRankingReportHandler,
  getUtilisationReportHandler,
  getVehicleMonthReportHandler,
} from "../handlers/reports.js";
import {
  getAgeingReportRoute,
  getCashPositionReportRoute,
  getFuelEfficiencyReportRoute,
  getGoodwillReportRoute,
  getLostDaysReportRoute,
  getOverheadsReportRoute,
  getReceivablesReportRoute,
  getTripRankingReportRoute,
  getUtilisationReportRoute,
  getVehicleMonthReportRoute,
} from "../route-defs/reports.js";
import type { Env } from "../types.js";

/** Wiring only (IG §3.2 step 7) — mounted behind `dbMiddleware` + `authMiddleware` in index.ts. */
export const reports = new OpenAPIHono<Env>({ defaultHook: zodValidationHook })
  .openapi(getVehicleMonthReportRoute, getVehicleMonthReportHandler)
  .openapi(getOverheadsReportRoute, getOverheadsReportHandler)
  .openapi(getTripRankingReportRoute, getTripRankingReportHandler)
  .openapi(getFuelEfficiencyReportRoute, getFuelEfficiencyReportHandler)
  .openapi(getReceivablesReportRoute, getReceivablesReportHandler)
  .openapi(getAgeingReportRoute, getAgeingReportHandler)
  .openapi(getCashPositionReportRoute, getCashPositionReportHandler)
  .openapi(getLostDaysReportRoute, getLostDaysReportHandler)
  .openapi(getGoodwillReportRoute, getGoodwillReportHandler)
  .openapi(getUtilisationReportRoute, getUtilisationReportHandler);
