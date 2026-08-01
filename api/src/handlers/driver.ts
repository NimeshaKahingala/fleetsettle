import { newId, toWire, type Minor } from "@fleetsettle/shared";
import type { RouteHandler } from "@hono/zod-openapi";
import { requireBusinessId, requireCapability } from "../auth/context.js";
import { NotFoundError } from "../errors/app-error.js";
import {
  findDriverForBusiness,
  insertDriver,
  listDriversForBusiness,
  type DriverRow,
} from "../queries/driver.js";
import type { createDriverRoute, getDriverRoute, listDriversRoute } from "../route-defs/driver.js";
import type { Env } from "../types.js";

function toResponse(row: DriverRow) {
  return {
    id: row.id,
    name: row.name,
    mobile: row.mobile,
    driverDayFeeMinor:
      row.driverDayFeeMinor !== null ? toWire(row.driverDayFeeMinor as Minor) : null,
    driverTripFeeMinor:
      row.driverTripFeeMinor !== null ? toWire(row.driverTripFeeMinor as Minor) : null,
    licenceExpiry: row.licenceExpiry,
  };
}

/** F-1.6 / UC-04. STAFF only (W-3: a driver enters nothing). */
export const createDriverHandler: RouteHandler<typeof createDriverRoute, Env> = async (c) => {
  requireCapability(c, "manageEntities");

  const businessId = requireBusinessId(c);
  const body = c.req.valid("json");
  const id = newId();

  await insertDriver(c.get("writer"), {
    id,
    businessId,
    name: body.name,
    ...(body.mobile !== undefined ? { mobile: body.mobile } : {}),
    ...(body.driverDayFeeMinor !== undefined ? { driverDayFeeMinor: body.driverDayFeeMinor } : {}),
    ...(body.driverTripFeeMinor !== undefined
      ? { driverTripFeeMinor: body.driverTripFeeMinor }
      : {}),
    ...(body.licenceExpiry !== undefined ? { licenceExpiry: body.licenceExpiry } : {}),
  });

  return c.json(
    {
      id,
      name: body.name,
      mobile: body.mobile ?? null,
      driverDayFeeMinor:
        body.driverDayFeeMinor !== undefined ? toWire(body.driverDayFeeMinor) : null,
      driverTripFeeMinor:
        body.driverTripFeeMinor !== undefined ? toWire(body.driverTripFeeMinor) : null,
      licenceExpiry: body.licenceExpiry ?? null,
    },
    201,
  );
};

export const getDriverHandler: RouteHandler<typeof getDriverRoute, Env> = async (c) => {
  requireCapability(c, "manageEntities");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");

  const row = await findDriverForBusiness(c.get("reader"), businessId, id);
  if (!row) throw new NotFoundError();

  return c.json(toResponse(row), 200);
};

export const listDriversHandler: RouteHandler<typeof listDriversRoute, Env> = async (c) => {
  requireCapability(c, "manageEntities");

  const businessId = requireBusinessId(c);
  const rows = await listDriversForBusiness(c.get("reader"), businessId);

  return c.json(rows.map(toResponse), 200);
};
