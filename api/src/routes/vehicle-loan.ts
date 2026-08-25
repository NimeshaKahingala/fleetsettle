import { OpenAPIHono } from "@hono/zod-openapi";
import { zodValidationHook } from "../errors/openapi-hook.js";
import {
  getVehicleLoanHandler,
  listLoanPaymentsHandler,
  recordLoanPaymentHandler,
  recordVehicleLoanHandler,
  settleVehicleLoanHandler,
  voidLoanPaymentHandler,
} from "../handlers/vehicle-loan.js";
import {
  getVehicleLoanRoute,
  listLoanPaymentsRoute,
  recordLoanPaymentRoute,
  recordVehicleLoanRoute,
  settleVehicleLoanRoute,
  voidLoanPaymentRoute,
} from "../route-defs/vehicle-loan.js";
import type { Env } from "../types.js";

/** Wiring only (IG §3.2 step 7) — mounted behind `dbMiddleware` + `authMiddleware` in index.ts. */
export const vehicleLoan = new OpenAPIHono<Env>({ defaultHook: zodValidationHook })
  .openapi(recordVehicleLoanRoute, recordVehicleLoanHandler)
  .openapi(getVehicleLoanRoute, getVehicleLoanHandler)
  .openapi(recordLoanPaymentRoute, recordLoanPaymentHandler)
  .openapi(listLoanPaymentsRoute, listLoanPaymentsHandler)
  .openapi(settleVehicleLoanRoute, settleVehicleLoanHandler)
  .openapi(voidLoanPaymentRoute, voidLoanPaymentHandler);
