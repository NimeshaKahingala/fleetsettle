import { createRoute } from "@hono/zod-openapi";
import {
  ageingResponseSchema,
  businessDateSchema,
  cashPositionResponseSchema,
  fuelEfficiencyResponseSchema,
  goodwillResponseSchema,
  lostDaysResponseSchema,
  overheadsResponseSchema,
  rankedTripsResponseSchema,
  receivablesResponseSchema,
  utilisationResponseSchema,
  vehicleMonthResponseSchema,
  vehicleYearResponseSchema,
} from "@fleetsettle/shared/schemas";
import { z } from "zod";

const vehicleMonthQuery = z.object({
  periodId: z.string().uuid(),
  vehicleId: z.string().uuid().optional(),
});

const overheadsQuery = z.object({ periodId: z.string().uuid() });

/** GAP-92: `from` after `to` produced a confident empty result on every report below rather than a 400 — utilisation went further and divided by a negative `inclusiveDays`. */
const dateOrderRefinement: { message: string; path: string[] } = {
  message: "from must not be after to",
  path: ["to"],
};

const vehicleWindowQuery = z
  .object({
    vehicleId: z.string().uuid(),
    from: businessDateSchema,
    to: businessDateSchema,
  })
  .refine((v) => v.from <= v.to, dateOrderRefinement);

const windowQuery = z
  .object({ from: businessDateSchema, to: businessDateSchema })
  .refine((v) => v.from <= v.to, dateOrderRefinement);

const vehicleYearQuery = z
  .object({
    vehicleId: z.string().uuid().optional(),
    from: businessDateSchema,
    to: businessDateSchema,
  })
  .refine((v) => v.from <= v.to, dateOrderRefinement);

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
    403: {
      description:
        "This role cannot read reports, or (GAP-1/W-59) a manager named a vehicle not shared with him for this period",
    },
    404: { description: "No such accounting period, or no such vehicle, in this business" },
  },
});

/** GAP-41/UC-66/W-32: this period's costs with no vehicle — its own block beneath vehicle totals, never spread across vehicles. */
export const getOverheadsReportRoute = createRoute({
  method: "get",
  path: "/overheads",
  request: { query: overheadsQuery },
  responses: {
    200: {
      content: { "application/json": { schema: overheadsResponseSchema } },
      description: "This period's costs recorded with no vehicle",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read reports" },
    404: { description: "No such accounting period in this business" },
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
    400: { description: "from is after to (GAP-92)" },
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

/** UC-75/DM §15: what each partner is holding, what is banked by destination, what is out with drivers as advances, and deposits held as a liability beside all of it (GAP-70). */
export const getCashPositionReportRoute = createRoute({
  method: "get",
  path: "/cash-position",
  responses: {
    200: {
      content: { "application/json": { schema: cashPositionResponseSchema } },
      description:
        "Cash held per partner, banked by destination, out with drivers as advances, and deposits held as a liability",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read reports" },
  },
});

/** UC-76/DM §15: the report UC-06 calls the driver's only protection — per driver, grouped three ways (weekday, month, reason — GAP-71), valued at the daily lease amount. */
export const getLostDaysReportRoute = createRoute({
  method: "get",
  path: "/lost-days",
  request: { query: windowQuery },
  responses: {
    200: {
      content: { "application/json": { schema: lostDaysResponseSchema } },
      description: "Lost days per driver, by weekday, by month and by reason",
    },
    400: { description: "from is after to (GAP-92)" },
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
    400: { description: "from is after to (GAP-92)" },
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
    400: { description: "from is after to (GAP-92)" },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read owner-only reports" },
    404: { description: "No such vehicle in this business" },
  },
});

/** GAP-18/UC-73: "as UC-70, with overheads (UC-66) beneath vehicle profit" — owners only (UC-73's own "Sees" line), never degrades (same basis as UC-70). */
export const getVehicleYearReportRoute = createRoute({
  method: "get",
  path: "/vehicle-year",
  request: { query: vehicleYearQuery },
  responses: {
    200: {
      content: { "application/json": { schema: vehicleYearResponseSchema } },
      description:
        "Earned, costs, profit and each owner's share per vehicle, plus overheads, for the window",
    },
    400: { description: "from is after to (GAP-92)" },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read owner-only reports" },
    404: { description: "No such vehicle in this business" },
  },
});

/**
 * GAP-18/UC-99 (CSV half — the PDF half is GAP-136, phase 2): "a year of
 * transactions to CSV" — owners only, W-49 checked at the same capability
 * gate every other report uses. No JSON body: `getAttachmentRoute`'s own
 * precedent for a non-JSON 200 (declared with a `description`, no `content`
 * schema) is what this follows for a raw `text/csv` response.
 */
export const exportTransactionsCsvRoute = createRoute({
  method: "get",
  path: "/export",
  request: { query: windowQuery },
  responses: {
    200: { description: "A year of transactions as `text/csv`, oldest first" },
    400: { description: "from is after to (GAP-92)" },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot export" },
  },
});
