import { OpenAPIHono } from "@hono/zod-openapi";
import { zodValidationHook } from "../errors/openapi-hook.js";
import {
  confirmDayHandler,
  confirmDaysBulkHandler,
  getDayRecordHandler,
  listUnconfirmedDayRecordsHandler,
} from "../handlers/day-record.js";
import {
  confirmDaysBulkRoute,
  confirmDayRoute,
  getDayRecordRoute,
  listUnconfirmedDayRecordsRoute,
} from "../route-defs/day-record.js";
import type { Env } from "../types.js";

/**
 * Wiring only (IG §3.2 step 7) — mounted behind `dbMiddleware` +
 * `authMiddleware` in index.ts. `confirmDaysBulkRoute`'s literal
 * `/confirm-week` segment is registered ahead of `getDayRecordRoute`'s
 * `/{businessDate}` wildcard at the same position — Hono's router matches
 * a static segment before a param one regardless of call order, but the
 * order here still reads as "the more specific route first".
 */
export const dayRecord = new OpenAPIHono<Env>({ defaultHook: zodValidationHook })
  .openapi(confirmDayRoute, confirmDayHandler)
  .openapi(confirmDaysBulkRoute, confirmDaysBulkHandler)
  .openapi(getDayRecordRoute, getDayRecordHandler)
  .openapi(listUnconfirmedDayRecordsRoute, listUnconfirmedDayRecordsHandler);
