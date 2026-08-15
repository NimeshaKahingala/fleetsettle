import { asBusinessDate, toWire } from "@fleetsettle/shared";
import type { RouteHandler } from "@hono/zod-openapi";
import { requireBusinessId, requireCapability, requireUserId } from "../auth/context.js";
import { recordPostClosureCharge } from "../domain/post-closure-charge.js";
import { NotFoundError, ValidationError } from "../errors/app-error.js";
import { findCustomerForBusiness } from "../queries/customer.js";
import { findDriverForBusiness } from "../queries/driver.js";
import { findLeaseForBusiness } from "../queries/lease.js";
import { findTripForBusiness } from "../queries/trip.js";
import { findVehicleForBusiness } from "../queries/vehicle.js";
import type { recordPostClosureChargeRoute } from "../route-defs/post-closure-charge.js";
import type { Env } from "../types.js";

/** F-8.4/UC-91/W-29. `dailyOperations` (STAFF) — "Manager," the same actor UC-91 names. */
export const recordPostClosureChargeHandler: RouteHandler<
  typeof recordPostClosureChargeRoute,
  Env
> = async (c) => {
  requireCapability(c, "dailyOperations");
  const businessId = requireBusinessId(c);
  const userId = requireUserId(c);
  const body = c.req.valid("json");
  const reader = c.get("reader");

  let sourceVehicleId: string | undefined;
  if (body.sourceType === "lease") {
    const lease = await findLeaseForBusiness(reader, businessId, body.sourceId);
    if (!lease) throw new NotFoundError("No such lease in this business");
    sourceVehicleId = lease.vehicleId;
  } else {
    const trip = await findTripForBusiness(reader, businessId, body.sourceId);
    if (!trip) throw new NotFoundError("No such trip in this business");
    sourceVehicleId = trip.vehicleId;
  }
  if (body.partyCustomerId !== undefined) {
    const customer = await findCustomerForBusiness(reader, businessId, body.partyCustomerId);
    if (!customer) throw new NotFoundError("No such customer in this business");
  }
  if (body.partyDriverId !== undefined) {
    const driver = await findDriverForBusiness(reader, businessId, body.partyDriverId);
    if (!driver) throw new NotFoundError("No such driver in this business");
  }
  if (body.vehicleId !== undefined) {
    // GAP-59/GAP-123: every sibling id on this handler is proven against the
    // business first — vehicleId was the one exception, an unvalidated FK
    // that let another business's vehicle id land in this business's
    // obligation. Existence first (404, matching the siblings), then
    // consistency with the lease/trip actually named (400) — the same
    // inconsistent-claim shape migration 0016's composite FK closed for
    // expense, handled here at the handler since post_closure_charge writes
    // an obligation, not a table of its own (D-14).
    const vehicle = await findVehicleForBusiness(reader, businessId, body.vehicleId);
    if (!vehicle) throw new NotFoundError("No such vehicle in this business");
    if (body.vehicleId !== sourceVehicleId) {
      throw new ValidationError("vehicleId does not match the vehicle on the named lease or trip");
    }
  }

  const { obligationId, status, deductedFromFeeOffsetId } = await recordPostClosureCharge(
    c.get("writer"),
    {
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
      ...(body.deductFromFee !== undefined ? { deductFromFee: body.deductFromFee } : {}),
      userId,
      ...(body.replacesId !== undefined ? { replacesId: body.replacesId } : {}),
    },
  );

  return c.json(
    {
      obligationId,
      partyType: body.partyType,
      amountMinor: toWire(body.amountMinor),
      dueOn: body.dueOn,
      // GAP-5b: no longer a hardcoded "pending" — a party already carrying
      // credit can land this charge as part_paid or paid on the spot, and
      // reporting "pending" regardless would be exactly the confident-
      // wrong-number W-56 exists to prevent.
      status,
      replacesId: body.replacesId ?? null,
      deductedFromFeeOffsetId,
    },
    201,
  );
};
