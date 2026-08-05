import { createRoute } from "@hono/zod-openapi";
import {
  depositReleasesResponseSchema,
  paperworkWarningsResponseSchema,
} from "@fleetsettle/shared/schemas";

/** F-10.1/UC-92: vehicle paperwork and driver licences expiring inside the warning window, already-expired included. */
export const getPaperworkWarningsRoute = createRoute({
  method: "get",
  path: "/paperwork-warnings",
  responses: {
    200: {
      content: { "application/json": { schema: paperworkWarningsResponseSchema } },
      description: "Vehicle documents and driver licences due to expire or already expired",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read the home screen" },
  },
});

/** F-2.7/UC-16 step 6, W-29: deposits whose hold window has reached its release date. */
export const getDepositReleasesRoute = createRoute({
  method: "get",
  path: "/deposit-releases",
  responses: {
    200: {
      content: { "application/json": { schema: depositReleasesResponseSchema } },
      description: "Held deposits whose hold window has reached its release date",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read the home screen" },
  },
});
