import { createRoute } from "@hono/zod-openapi";
import {
  ageingResponseSchema,
  businessDateSchema,
  cashPositionResponseSchema,
  fuelEfficiencyResponseSchema,
  goodwillResponseSchema,
  lostDaysResponseSchema,
  rankedTripsResponseSchema,
  receivablesResponseSchema,
  utilisationResponseSchema,
  vehicleMonthResponseSchema,
} from "@fleetsettle/shared/schemas";
import { z } from "zod";

const vehicleMonthQuery = z.object({
  periodId: z.string().uuid(),
  vehicleId: z.string().uuid().optional(),
});

const vehicleWindowQuery = z.object({
  vehicleId: z.string().uuid(),
  from: businessDateSchema,
  to: businessDateSchema,
});

const windowQuery = z.object({ from: businessDateSchema, to: businessDateSchema });

const asOfQuery = z.object({ asOfDate: businessDateSchema });

/** UC-70/DM §15: one row per vehicle for the given period — "combined" is the caller summing this array. */
export const getVehicleMonthReportRoute = createRoute({
  method: "get",
  path: "/vehicle-month",
  request: { query: vehicleMonthQuery },
  responses: {
    200: {
      content: { "application/json": { schema: vehicleMonthResponseSchema } },
      description: "Earned, costs, profit and each owner's share, per vehicle",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read reports" },
    404: { description: "No such accounting period, or no such vehicle, in this business" },
  },
});

/** UC-71: trips ranked by profit; profit-per-km is `null` for any trip with no closing odometer. */
export const getTripRankingReportRoute = createRoute({
  method: "get",
  path: "/trips",
  responses: {
    200: {
      content: { "application/json": { schema: rankedTripsResponseSchema } },
      description: "Every closed trip, ranked by profit",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read reports" },
  },
});

/** UC-72: kilometres per litre over time, only fuel *you* bought (W-20). */
export const getFuelEfficiencyReportRoute = createRoute({
  method: "get",
  path: "/fuel-efficiency",
  request: { query: vehicleWindowQuery },
  responses: {
    200: {
      content: { "application/json": { schema: fuelEfficiencyResponseSchema } },
      description: "Fuel fills and, where a pair of readings allows it, km/l",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read reports" },
    404: { description: "No such vehicle in this business" },
  },
});

/** UC-74/DM §15: who owes us, one row per party, largest outstanding first. */
export const getReceivablesReportRoute = createRoute({
  method: "get",
  path: "/receivables",
  responses: {
    200: {
      content: { "application/json": { schema: receivablesResponseSchema } },
      description: "Every party with an outstanding, non-written-off balance",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read reports" },
  },
});

/** UC-78/DM §15: the receivables list, bucketed by age from each obligation's own effective due date. */
export const getAgeingReportRoute = createRoute({
  method: "get",
  path: "/ageing",
  request: { query: asOfQuery },
  responses: {
    200: {
      content: { "application/json": { schema: ageingResponseSchema } },
      description: "Outstanding balances bucketed by age as of the given business date",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read reports" },
  },
});

/** UC-75/DM §15: what each partner is holding, plus deposits held as a liability beside it. */
export const getCashPositionReportRoute = createRoute({
  method: "get",
  path: "/cash-position",
  responses: {
    200: {
      content: { "application/json": { schema: cashPositionResponseSchema } },
      description: "Cash held per partner, and deposits held as a liability",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read reports" },
  },
});

/** UC-76/DM §15: the report UC-06 calls the driver's only protection. */
export const getLostDaysReportRoute = createRoute({
  method: "get",
  path: "/lost-days",
  request: { query: windowQuery },
  responses: {
    200: {
      content: { "application/json": { schema: lostDaysResponseSchema } },
      description: "Lost days per driver per weekday, valued at the daily lease amount",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read reports" },
  },
});

/** UC-77: every waiver/auto-waiver/goodwill adjustment given in the window — owners only, never pooled with a write-off (W-28). */
export const getGoodwillReportRoute = createRoute({
  method: "get",
  path: "/goodwill",
  request: { query: windowQuery },
  responses: {
    200: {
      content: { "application/json": { schema: goodwillResponseSchema } },
      description: "Total waivers and goodwill adjustments given in the window",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read owner-only reports" },
  },
});

/** UC-79: day-based utilisation for one vehicle — owners only; day counts always compute (W-56). */
export const getUtilisationReportRoute = createRoute({
  method: "get",
  path: "/utilisation",
  request: { query: vehicleWindowQuery },
  responses: {
    200: {
      content: { "application/json": { schema: utilisationResponseSchema } },
      description: "Days earning, idle and off the road for one vehicle in the window",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read owner-only reports" },
    404: { description: "No such vehicle in this business" },
  },
});
