import { createRoute } from "@hono/zod-openapi";
import {
  mileageAssessmentResponseSchema,
  recordOdometerReadingRequestSchema,
} from "@fleetsettle/shared/schemas";

/**
 * F-2.3/UC-14. Enter a reading + source; which billing period(s) it closes
 * out since the last reading — one, or combined when a boundary reading was
 * missing (INV-26) — is derived, never chosen by the caller.
 */
export const recordOdometerReadingRoute = createRoute({
  method: "post",
  path: "/",
  request: {
    body: { content: { "application/json": { schema: recordOdometerReadingRequestSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: mileageAssessmentResponseSchema } },
      description: "The mileage assessment this reading produced",
    },
    200: {
      content: { "application/json": { schema: mileageAssessmentResponseSchema } },
      description: "Already recorded — the idempotent replay for this lease and date",
    },
    400: { description: "No mileage limit, no prior reading, or the reading moved backwards" },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot record an odometer reading" },
    404: { description: "No such lease in this business" },
    409: { description: "That accounting period is closed" },
  },
});
