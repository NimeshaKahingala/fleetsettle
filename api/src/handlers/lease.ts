import { newId, toWire, type Minor } from "@fleetsettle/shared";
import type { RouteHandler } from "@hono/zod-openapi";
import { requireBusinessId, requireCapability } from "../auth/context.js";
import { NotFoundError } from "../errors/app-error.js";
import { findCustomerForBusiness } from "../queries/customer.js";
import { findLeaseForBusiness, insertLease, type LeaseRow } from "../queries/lease.js";
import { findVehicleForBusiness } from "../queries/vehicle.js";
import type { getLeaseRoute, startLeaseRoute } from "../route-defs/lease.js";
import type { Env } from "../types.js";

function toResponse(row: LeaseRow) {
  return {
    id: row.id,
    vehicleId: row.vehicleId,
    customerId: row.customerId,
    status: row.status,
    startDate: row.startDate,
    endDate: row.endDate,
    billingDay: row.billingDay,
    rentAmountMinor: toWire(row.rentAmountMinor as Minor),
    mileageDailyLimitKm: row.mileageDailyLimitKm,
    mileageExcessRateMinor:
      row.mileageExcessRateMinor !== null ? toWire(row.mileageExcessRateMinor as Minor) : null,
    reminderDaysBefore: row.reminderDaysBefore,
  };
}

/** F-2.1 / UC-10. `leaseAndTripLifecycle` (STAFF) — the same capability that gates closing one. */
export const startLeaseHandler: RouteHandler<typeof startLeaseRoute, Env> = async (c) => {
  requireCapability(c, "leaseAndTripLifecycle");

  const businessId = requireBusinessId(c);
  const body = c.req.valid("json");
  const reader = c.get("reader");

  const vehicle = await findVehicleForBusiness(reader, businessId, body.vehicleId);
  if (!vehicle) throw new NotFoundError("No such vehicle in this business");
  const customer = await findCustomerForBusiness(reader, businessId, body.customerId);
  if (!customer) throw new NotFoundError("No such customer in this business");

  const id = newId();
  await insertLease(c.get("writer"), {
    id,
    businessId,
    vehicleId: body.vehicleId,
    customerId: body.customerId,
    status: "active",
    startDate: body.startDate,
    ...(body.endDate !== undefined ? { endDate: body.endDate } : {}),
    billingDay: body.billingDay,
    rentAmountMinor: body.rentAmountMinor,
    ...(body.mileageDailyLimitKm !== undefined
      ? { mileageDailyLimitKm: body.mileageDailyLimitKm }
      : {}),
    ...(body.mileageExcessRateMinor !== undefined
      ? { mileageExcessRateMinor: body.mileageExcessRateMinor }
      : {}),
    ...(body.reminderDaysBefore !== undefined
      ? { reminderDaysBefore: body.reminderDaysBefore }
      : {}),
  });

  return c.json(
    toResponse({
      id,
      vehicleId: body.vehicleId,
      customerId: body.customerId,
      status: "active",
      startDate: body.startDate,
      endDate: body.endDate ?? null,
      billingDay: body.billingDay,
      rentAmountMinor: body.rentAmountMinor,
      mileageDailyLimitKm: body.mileageDailyLimitKm ?? null,
      mileageExcessRateMinor: body.mileageExcessRateMinor ?? null,
      reminderDaysBefore: body.reminderDaysBefore ?? 3,
    }),
    201,
  );
};

export const getLeaseHandler: RouteHandler<typeof getLeaseRoute, Env> = async (c) => {
  requireCapability(c, "leaseAndTripLifecycle");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");

  const row = await findLeaseForBusiness(c.get("reader"), businessId, id);
  if (!row) throw new NotFoundError();

  return c.json(toResponse(row), 200);
};
