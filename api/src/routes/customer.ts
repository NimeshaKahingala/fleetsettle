import { OpenAPIHono } from "@hono/zod-openapi";
import { zodValidationHook } from "../errors/openapi-hook.js";
import {
  archiveCustomerHandler,
  createCustomerHandler,
  getCustomerHandler,
  listCustomerObligationsHandler,
  listCustomerPaymentsHandler,
  listCustomersHandler,
  unarchiveCustomerHandler,
} from "../handlers/customer.js";
import {
  archiveCustomerRoute,
  createCustomerRoute,
  getCustomerRoute,
  listCustomerObligationsRoute,
  listCustomerPaymentsRoute,
  listCustomersRoute,
  unarchiveCustomerRoute,
} from "../route-defs/customer.js";
import type { Env } from "../types.js";

/** Wiring only (IG §3.2 step 7) — mounted behind `dbMiddleware` + `authMiddleware` in index.ts. */
export const customer = new OpenAPIHono<Env>({ defaultHook: zodValidationHook })
  .openapi(createCustomerRoute, createCustomerHandler)
  .openapi(getCustomerRoute, getCustomerHandler)
  .openapi(listCustomersRoute, listCustomersHandler)
  .openapi(listCustomerObligationsRoute, listCustomerObligationsHandler)
  .openapi(listCustomerPaymentsRoute, listCustomerPaymentsHandler)
  .openapi(archiveCustomerRoute, archiveCustomerHandler)
  .openapi(unarchiveCustomerRoute, unarchiveCustomerHandler);
