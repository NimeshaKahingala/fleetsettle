import { OpenAPIHono } from "@hono/zod-openapi";
import { zodValidationHook } from "../errors/openapi-hook.js";
import {
  confirmDayHandler,
  getDayRecordHandler,
  listUnconfirmedDayRecordsHandler,
} from "../handlers/day-record.js";
import {
  confirmDayRoute,
  getDayRecordRoute,
  listUnconfirmedDayRecordsRoute,
} from "../route-defs/day-record.js";
import type { Env } from "../types.js";

/** Wiring only (IG §3.2 step 7) — mounted behind `dbMiddleware` + `authMiddleware` in index.ts. */
export const dayRecord = new OpenAPIHono<Env>({ defaultHook: zodValidationHook })
  .openapi(confirmDayRoute, confirmDayHandler)
  .openapi(getDayRecordRoute, getDayRecordHandler)
  .openapi(listUnconfirmedDayRecordsRoute, listUnconfirmedDayRecordsHandler);
