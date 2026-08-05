import { OpenAPIHono } from "@hono/zod-openapi";
import { zodValidationHook } from "../errors/openapi-hook.js";
import {
  createCustomerHandler,
  getCustomerHandler,
  listCustomersHandler,
} from "../handlers/customer.js";
import {
  createCustomerRoute,
  getCustomerRoute,
  listCustomersRoute,
} from "../route-defs/customer.js";
import type { Env } from "../types.js";

/** Wiring only (IG §3.2 step 7) — mounted behind `dbMiddleware` + `authMiddleware` in index.ts. */
export const customer = new OpenAPIHono<Env>({ defaultHook: zodValidationHook })
  .openapi(createCustomerRoute, createCustomerHandler)
  .openapi(getCustomerRoute, getCustomerHandler)
  .openapi(listCustomersRoute, listCustomersHandler);
