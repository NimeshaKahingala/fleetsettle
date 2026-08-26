import { createRoute } from "@hono/zod-openapi";
import {
  createMileagePackageRequestSchema,
  listMileagePackagesResponseSchema,
  mileagePackageResponseSchema,
} from "@fleetsettle/shared/schemas";
import { z } from "zod";

const mileagePackageIdParams = z.object({ id: z.string().uuid() });

/** F-1.9/UC-18. */
export const createMileagePackageRoute = createRoute({
  method: "post",
  path: "/",
  request: {
    body: { content: { "application/json": { schema: createMileagePackageRequestSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: mileagePackageResponseSchema } },
      description: "The saved package",
    },
    // GAP-180/B24b: a negative `dailyLimitKm` is refused by the schema, so
    // the runtime 400s here too.
    400: { description: "The request body failed validation" },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot manage mileage packages" },
  },
});

/** F-2.1 step 4's chip list. */
export const listMileagePackagesRoute = createRoute({
  method: "get",
  path: "/",
  responses: {
    200: {
      content: { "application/json": { schema: listMileagePackagesResponseSchema } },
      description: "Every mileage package in this business, active and archived",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read mileage packages" },
  },
});

/** F-1.9's Accept: archive, never delete — a lease already using this package keeps its own copy. */
export const archiveMileagePackageRoute = createRoute({
  method: "post",
  path: "/{id}/archive",
  request: { params: mileagePackageIdParams },
  responses: {
    200: {
      content: { "application/json": { schema: mileagePackageResponseSchema } },
      description: "The now-archived package",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot manage mileage packages" },
    404: { description: "No such mileage package in this business" },
  },
});
