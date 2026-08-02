import { createRoute } from "@hono/zod-openapi";
import { businessDateSchema, driverViewResponseSchema } from "@fleetsettle/shared/schemas";
import { z } from "zod";

const driverViewQuery = z.object({ from: businessDateSchema, to: businessDateSchema });

/** F-6.8/UC-59/W-13, INV-25: the linked driver's own view — `driverId` is resolved from the verified identity, never from a query param (W-49). */
export const getDriverViewRoute = createRoute({
  method: "get",
  path: "/",
  request: { query: driverViewQuery },
  responses: {
    200: {
      content: { "application/json": { schema: driverViewResponseSchema } },
      description: "The caller's own two balances, days, trips, advances, offsets and deposit",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This identity is not a linked driver" },
  },
});
