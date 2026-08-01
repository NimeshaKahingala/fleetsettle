import { createRoute } from "@hono/zod-openapi";
import { confirmDayRequestSchema, dayRecordResponseSchema } from "@fleetsettle/shared/schemas";
import { z } from "zod";

const dayRecordParams = z.object({
  dailyLeaseId: z.string().uuid(),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * F-4.2/F-4.3/F-4.6, one transaction: `day_record`, its `obligation`, and —
 * when anything was received — a `payment` and its `payment_allocation`
 * (domain/confirmDay.ts). Idempotent on `(daily_lease_id, business_date)`: a
 * day already confirmed returns 200 unchanged rather than 201, the "second
 * tap changes nothing" half of the Done bar.
 */
export const confirmDayRoute = createRoute({
  method: "post",
  path: "/confirm",
  request: {
    body: { content: { "application/json": { schema: confirmDayRequestSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: dayRecordResponseSchema } },
      description: "The day, confirmed",
    },
    200: {
      content: { "application/json": { schema: dayRecordResponseSchema } },
      description: "Already confirmed — idempotent no-op, unchanged",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot confirm a day" },
    404: { description: "No such daily lease in this business" },
    // INV-10: the trigger is the truth — no application pre-check (CLAUDE.md → Writes).
    409: { description: "That accounting period is closed" },
  },
});

/** F-4.1: whether today (or any given business date) is already confirmed — a 404 means "not yet", not "gone". */
export const getDayRecordRoute = createRoute({
  method: "get",
  path: "/{dailyLeaseId}/{businessDate}",
  request: { params: dayRecordParams },
  responses: {
    200: {
      content: { "application/json": { schema: dayRecordResponseSchema } },
      description: "The day record",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read day records" },
    404: { description: "No such daily lease in this business, or this date is not yet confirmed" },
  },
});
