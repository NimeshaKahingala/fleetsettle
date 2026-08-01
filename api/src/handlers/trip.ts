import { toWire, ZERO, type Minor } from "@fleetsettle/shared";
import type { RouteHandler } from "@hono/zod-openapi";
import { requireBusinessId, requireCapability } from "../auth/context.js";
import { bookTrip } from "../domain/trip.js";
import { findCustomerForBusiness } from "../queries/customer.js";
import { findDriverForBusiness } from "../queries/driver.js";
import { findTripForBusiness, type TripRow } from "../queries/trip.js";
import { findVehicleForBusiness } from "../queries/vehicle.js";
import { NotFoundError } from "../errors/app-error.js";
import type { bookTripRoute, getTripRoute } from "../route-defs/trip.js";
import type { Env } from "../types.js";

function toResponse(row: TripRow) {
  return {
    id: row.id,
    vehicleId: row.vehicleId,
    customerId: row.customerId,
    driverId: row.driverId,
    status: row.status,
    startDate: row.startDate,
    endDate: row.endDate,
    destination: row.destination,
    agreedAmountMinor: toWire(row.agreedAmountMinor as Minor),
    driverFeeMinor: toWire(row.driverFeeMinor as Minor),
  };
}

/** F-5.1 / UC-20. `leaseAndTripLifecycle` (STAFF) — the same capability that gates closing one. */
export const bookTripHandler: RouteHandler<typeof bookTripRoute, Env> = async (c) => {
  requireCapability(c, "leaseAndTripLifecycle");

  const businessId = requireBusinessId(c);
  const body = c.req.valid("json");
  const reader = c.get("reader");

  const vehicle = await findVehicleForBusiness(reader, businessId, body.vehicleId);
  if (!vehicle) throw new NotFoundError("No such vehicle in this business");
  if (body.customerId !== undefined) {
    const customer = await findCustomerForBusiness(reader, businessId, body.customerId);
    if (!customer) throw new NotFoundError("No such customer in this business");
  }
  if (body.driverId !== undefined) {
    const driver = await findDriverForBusiness(reader, businessId, body.driverId);
    if (!driver) throw new NotFoundError("No such driver in this business");
  }

  const agreedAmountMinor = body.agreedAmountMinor ?? ZERO;
  const driverFeeMinor = body.driverFeeMinor ?? ZERO;

  const { tripId } = await bookTrip(c.get("writer"), {
    businessId,
    vehicleId: body.vehicleId,
    ...(body.customerId !== undefined ? { customerId: body.customerId } : {}),
    ...(body.driverId !== undefined ? { driverId: body.driverId } : {}),
    startDate: body.startDate,
    endDate: body.endDate,
    ...(body.destination !== undefined ? { destination: body.destination } : {}),
    agreedAmountMinor,
    driverFeeMinor,
  });

  return c.json(
    toResponse({
      id: tripId,
      vehicleId: body.vehicleId,
      customerId: body.customerId ?? null,
      driverId: body.driverId ?? null,
      status: "booked",
      startDate: body.startDate,
      endDate: body.endDate,
      destination: body.destination ?? null,
      agreedAmountMinor,
      driverFeeMinor,
    }),
    201,
  );
};

export const getTripHandler: RouteHandler<typeof getTripRoute, Env> = async (c) => {
  requireCapability(c, "leaseAndTripLifecycle");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");

  const row = await findTripForBusiness(c.get("reader"), businessId, id);
  if (!row) throw new NotFoundError();

  return c.json(toResponse(row), 200);
};
