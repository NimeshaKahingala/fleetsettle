import { toWire, type Minor } from "@fleetsettle/shared";
import type { RouteHandler } from "@hono/zod-openapi";
import { requireBusinessId, requireCapability, requireUserId } from "../auth/context.js";
import { assessMileage, type AssessedMileage } from "../domain/mileage.js";
import { NotFoundError } from "../errors/app-error.js";
import { findLeaseForBusiness } from "../queries/lease.js";
import type { recordOdometerReadingRoute } from "../route-defs/mileage-assessment.js";
import type { Env } from "../types.js";

function toResponse(result: AssessedMileage) {
  return {
    id: result.assessment.id,
    leaseId: result.assessment.leaseId,
    drivenKm: result.assessment.drivenKm,
    combinedAllowanceKm: result.assessment.combinedAllowanceKm,
    excessKm: result.assessment.excessKm,
    excessAmountMinor: toWire(result.assessment.excessAmountMinor as Minor),
    isEstimated: result.assessment.isEstimated,
    status: result.assessment.status,
    splits: result.splits.map((split) => ({
      billingPeriodId: split.billingPeriodId,
      apportionedKm: split.apportionedKm,
      apportionedExcessMinor: toWire(split.apportionedExcessMinor as Minor),
    })),
    obligationId: result.obligationId,
    autoWaived: result.autoWaived,
  };
}

/** F-2.3/UC-14, one transaction (domain/mileage.ts) — this is only validation and translation to the wire shape. */
export const recordOdometerReadingHandler: RouteHandler<
  typeof recordOdometerReadingRoute,
  Env
> = async (c) => {
  requireCapability(c, "dailyOperations");
  const userId = requireUserId(c);

  const businessId = requireBusinessId(c);
  const body = c.req.valid("json");

  const lease = await findLeaseForBusiness(c.get("reader"), businessId, body.leaseId);
  if (!lease) throw new NotFoundError("No such lease in this business");

  const result = await assessMileage(c.get("writer"), {
    businessId,
    leaseId: body.leaseId,
    readingKm: body.readingKm,
    readOn: body.readOn,
    source: body.source,
    userId,
  });

  return c.json(toResponse(result), result.created ? 201 : 200);
};
