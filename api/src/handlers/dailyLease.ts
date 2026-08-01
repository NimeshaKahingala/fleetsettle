import { toWire, type Minor } from "@fleetsettle/shared";
import type { RouteHandler } from "@hono/zod-openapi";
import { requireBusinessId, requireCapability } from "../auth/context.js";
import { startDailyLease } from "../domain/dailyLease.js";
import { NotFoundError } from "../errors/app-error.js";
import {
  findCurrentDailyLeaseRate,
  findDailyLeaseForBusiness,
  type DailyLeaseRow,
} from "../queries/dailyLease.js";
import { findDriverForBusiness } from "../queries/driver.js";
import { findVehicleForBusiness } from "../queries/vehicle.js";
import type { getDailyLeaseRoute, startDailyLeaseRoute } from "../route-defs/dailyLease.js";
import type { Env } from "../types.js";

function toResponse(row: DailyLeaseRow, dailyLeaseAmountMinor: bigint) {
  return {
    id: row.id,
    vehicleId: row.vehicleId,
    driverId: row.driverId,
    patternType: row.patternType,
    patternWeekdays: row.patternWeekdays,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    dailyLeaseAmountMinor: toWire(dailyLeaseAmountMinor as Minor),
  };
}

/** F-1.7 / UC-05. `leaseAndTripLifecycle` (STAFF). */
export const startDailyLeaseHandler: RouteHandler<typeof startDailyLeaseRoute, Env> = async (c) => {
  requireCapability(c, "leaseAndTripLifecycle");

  const businessId = requireBusinessId(c);
  const body = c.req.valid("json");
  const reader = c.get("reader");

  const vehicle = await findVehicleForBusiness(reader, businessId, body.vehicleId);
  if (!vehicle) throw new NotFoundError("No such vehicle in this business");
  const driver = await findDriverForBusiness(reader, businessId, body.driverId);
  if (!driver) throw new NotFoundError("No such driver in this business");

  const { dailyLeaseId } = await startDailyLease(c.get("writer"), {
    businessId,
    vehicleId: body.vehicleId,
    driverId: body.driverId,
    patternType: body.patternType,
    ...(body.patternWeekdays !== undefined ? { patternWeekdays: body.patternWeekdays } : {}),
    effectiveFrom: body.effectiveFrom,
    ...(body.effectiveTo !== undefined ? { effectiveTo: body.effectiveTo } : {}),
    dailyLeaseAmountMinor: body.dailyLeaseAmountMinor,
  });

  return c.json(
    toResponse(
      {
        id: dailyLeaseId,
        vehicleId: body.vehicleId,
        driverId: body.driverId,
        patternType: body.patternType,
        patternWeekdays: body.patternWeekdays ?? null,
        effectiveFrom: body.effectiveFrom,
        effectiveTo: body.effectiveTo ?? null,
      },
      body.dailyLeaseAmountMinor,
    ),
    201,
  );
};

export const getDailyLeaseHandler: RouteHandler<typeof getDailyLeaseRoute, Env> = async (c) => {
  requireCapability(c, "leaseAndTripLifecycle");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");

  const row = await findDailyLeaseForBusiness(c.get("reader"), businessId, id);
  if (!row) throw new NotFoundError();
  const rate = await findCurrentDailyLeaseRate(c.get("reader"), id);
  if (!rate) throw new NotFoundError();

  return c.json(toResponse(row, rate.dailyLeaseAmountMinor), 200);
};
