import { OpenAPIHono } from "@hono/zod-openapi";
import { zodValidationHook } from "../errors/openapi-hook.js";
import {
  createExpenseHandler,
  expensePrefillVehicleHandler,
  listExpensesHandler,
  resolveBorneByHandler,
  voidExpenseHandler,
} from "../handlers/expense.js";
import {
  createExpenseRoute,
  expensePrefillVehicleRoute,
  listExpensesRoute,
  resolveBorneByRoute,
  voidExpenseRoute,
} from "../route-defs/expense.js";
import type { Env } from "../types.js";

/** Wiring only (IG §3.2 step 7) — mounted behind `dbMiddleware` + `authMiddleware` in index.ts. */
export const expense = new OpenAPIHono<Env>({ defaultHook: zodValidationHook })
  .openapi(createExpenseRoute, createExpenseHandler)
  .openapi(listExpensesRoute, listExpensesHandler)
  .openapi(voidExpenseRoute, voidExpenseHandler)
  .openapi(resolveBorneByRoute, resolveBorneByHandler)
  .openapi(expensePrefillVehicleRoute, expensePrefillVehicleHandler);
