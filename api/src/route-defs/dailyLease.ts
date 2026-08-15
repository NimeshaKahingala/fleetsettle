import { createRoute } from "@hono/zod-openapi";
import {
  activeDailyLeasesResponseSchema,
  changeDailyLeaseDriverRequestSchema,
  createLeaseDayExceptionRequestSchema,
  dailyLeaseResponseSchema,
  leaseDayExceptionResponseSchema,
  leaseDayExceptionsResponseSchema,
  startDailyLeaseRequestSchema,
  voidRequestSchema,
  voidedResponseSchema,
} from "@fleetsettle/shared/schemas";
import { z } from "zod";

const dailyLeaseIdParams = z.object({ id: z.string().uuid() });
const leaseDayExceptionParams = z.object({ id: z.string().uuid(), exceptionId: z.string().uuid() });

/** Home item 3 (UI §3.2): every active daily lease, so the caller can render a day card per vehicle without a follow-up lookup. */
export const listActiveDailyLeasesRoute = createRoute({
  method: "get",
  path: "/",
  responses: {
    200: {
      content: { "application/json": { schema: activeDailyLeasesResponseSchema } },
      description: "Every daily lease still running",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read daily leases" },
  },
});

/**
 * F-1.7 / UC-05 — starting arrangement B. Writes `daily_lease` and its first
 * `daily_lease_rate` only (domain/dailyLease.ts) — DM §4.1 attributes the
 * vehicle_day_allocation/day_record calendar entirely to `generate-day-cards`,
 * a rolling-horizon cron job (P13), not this setup step.
 */
export const startDailyLeaseRoute = createRoute({
  method: "post",
  path: "/",
  request: {
    body: { content: { "application/json": { schema: startDailyLeaseRequestSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: dailyLeaseResponseSchema } },
      description: "The daily lease and its rate",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot set up a daily lease" },
    404: { description: "No such vehicle or driver in this business" },
    // DM §7's exclusion constraint, or GAP-84/F1's arrangement guard.
    409: {
      description:
        "This vehicle already has a daily lease over one or more of these dates, or is not configured for arrangement B (GAP-84)",
    },
  },
});

export const getDailyLeaseRoute = createRoute({
  method: "get",
  path: "/{id}",
  request: { params: dailyLeaseIdParams },
  responses: {
    200: {
      content: { "application/json": { schema: dailyLeaseResponseSchema } },
      description: "The daily lease",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read daily leases" },
    404: { description: "No such daily lease in this business" },
  },
});

/**
 * F-4.7/UC-36/GAP-62: "new driver from a date; previous assignment ends."
 * The current row closes and a new one opens carrying its pattern and rate
 * forward — never an overwrite (CLAUDE.md → Writes).
 */
export const changeDailyLeaseDriverRoute = createRoute({
  method: "post",
  path: "/{id}/change-driver",
  request: {
    params: dailyLeaseIdParams,
    body: { content: { "application/json": { schema: changeDailyLeaseDriverRequestSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: dailyLeaseResponseSchema } },
      description: "The new daily lease, open from effectiveFrom",
    },
    400: {
      description:
        "This daily lease has already ended, or effectiveFrom is not after its own start date",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot change a daily lease's driver" },
    404: { description: "No such daily lease or driver in this business" },
    409: { description: "The new date range overlaps another daily lease on this vehicle" },
  },
});

/**
 * F-1.7/GAP-20: skip an individual date — it behaves exactly like an
 * off-pattern one, no `day_record` ever generated for it. A card already
 * generated ahead of it is voided in the same transaction; one already
 * confirmed refuses (LEASE_DAY_ALREADY_CONFIRMED).
 */
export const createLeaseDayExceptionRoute = createRoute({
  method: "post",
  path: "/{id}/exception",
  request: {
    params: dailyLeaseIdParams,
    body: { content: { "application/json": { schema: createLeaseDayExceptionRequestSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: leaseDayExceptionResponseSchema } },
      description: "The exception",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot manage this daily lease" },
    404: { description: "No such daily lease in this business" },
    409: {
      description:
        "That accounting period is closed (PERIOD_CLOSED), this date is already skipped (LEASE_DAY_ALREADY_EXCEPTED), or this day has already been confirmed and cannot be skipped retroactively (LEASE_DAY_ALREADY_CONFIRMED)",
    },
  },
});

/** F-1.7/GAP-20: every date currently skipped on this lease. */
export const listLeaseDayExceptionsRoute = createRoute({
  method: "get",
  path: "/{id}/exception",
  request: { params: dailyLeaseIdParams },
  responses: {
    200: {
      content: { "application/json": { schema: leaseDayExceptionsResponseSchema } },
      description: "Every date currently skipped on this lease",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read this daily lease" },
    404: { description: "No such daily lease in this business" },
  },
});

/** F-1.7/GAP-20: un-skip — voids the exception, never deletes it (W-58). */
export const voidLeaseDayExceptionRoute = createRoute({
  method: "post",
  path: "/{id}/exception/{exceptionId}/void",
  request: {
    params: leaseDayExceptionParams,
    body: { content: { "application/json": { schema: voidRequestSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: voidedResponseSchema } },
      description: "The exception, voided",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot manage this daily lease" },
    404: { description: "No such exception on this daily lease" },
    409: { description: "This exception has already been undone" },
  },
});
