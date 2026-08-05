import { asBusinessDate, toWire } from "@fleetsettle/shared";
import type { RouteHandler } from "@hono/zod-openapi";
import { requireBusinessId, requireCapability } from "../auth/context.js";
import { recordPostClosureCharge } from "../domain/post-closure-charge.js";
import { NotFoundError } from "../errors/app-error.js";
import { findCustomerForBusiness } from "../queries/customer.js";
import { findDriverForBusiness } from "../queries/driver.js";
import { findLeaseForBusiness } from "../queries/lease.js";
import { findTripForBusiness } from "../queries/trip.js";
import type { recordPostClosureChargeRoute } from "../route-defs/post-closure-charge.js";
import type { Env } from "../types.js";

/** F-8.4/UC-91/W-29. `dailyOperations` (STAFF) — "Manager," the same actor UC-91 names. */
export const recordPostClosureChargeHandler: RouteHandler<
  typeof recordPostClosureChargeRoute,
  Env
> = async (c) => {
  requireCapability(c, "dailyOperations");
  const businessId = requireBusinessId(c);
  const body = c.req.valid("json");
  const reader = c.get("reader");

  if (body.sourceType === "lease") {
    const lease = await findLeaseForBusiness(reader, businessId, body.sourceId);
    if (!lease) throw new NotFoundError("No such lease in this business");
  } else {
    const trip = await findTripForBusiness(reader, businessId, body.sourceId);
    if (!trip) throw new NotFoundError("No such trip in this business");
  }
  if (body.partyCustomerId !== undefined) {
    const customer = await findCustomerForBusiness(reader, businessId, body.partyCustomerId);
    if (!customer) throw new NotFoundError("No such customer in this business");
  }
  if (body.partyDriverId !== undefined) {
    const driver = await findDriverForBusiness(reader, businessId, body.partyDriverId);
    if (!driver) throw new NotFoundError("No such driver in this business");
  }

  const { obligationId } = await recordPostClosureCharge(c.get("writer"), {
    businessId,
    partyType: body.partyType,
    ...(body.partyCustomerId !== undefined ? { partyCustomerId: body.partyCustomerId } : {}),
    ...(body.partyDriverId !== undefined ? { partyDriverId: body.partyDriverId } : {}),
    ...(body.vehicleId !== undefined ? { vehicleId: body.vehicleId } : {}),
    sourceType: body.sourceType,
    sourceId: body.sourceId,
    amountMinor: body.amountMinor,
    dueOn: asBusinessDate(body.dueOn),
    ...(body.note !== undefined ? { note: body.note } : {}),
  });

  return c.json(
    {
      obligationId,
      partyType: body.partyType,
      amountMinor: toWire(body.amountMinor),
      dueOn: body.dueOn,
      status: "pending" as const,
    },
    201,
  );
};
