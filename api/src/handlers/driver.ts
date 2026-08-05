import { newId, toWire, type Minor } from "@fleetsettle/shared";
import type { RouteHandler } from "@hono/zod-openapi";
import { requireBusinessId, requireCapability } from "../auth/context.js";
import { getDriverOwnView } from "../domain/driver-view.js";
import { NotFoundError } from "../errors/app-error.js";
import {
  findDriverForBusiness,
  insertDriver,
  listDriversForBusiness,
  type DriverRow,
} from "../queries/driver.js";
import { sumOutstandingByDirectionForDriver } from "../queries/obligation.js";
import type {
  createDriverRoute,
  getDriverBalancesRoute,
  getDriverHistoryRoute,
  getDriverRoute,
  listDriversRoute,
} from "../route-defs/driver.js";
import type { Env } from "../types.js";
import { toDriverViewResponse } from "./driver-view.js";

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

/** W-2/INV-3. `dailyOperations` (STAFF) — checking a driver's position is routine, not a setup action. */
export const getDriverBalancesHandler: RouteHandler<typeof getDriverBalancesRoute, Env> = async (
  c,
) => {
  requireCapability(c, "dailyOperations");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");
  const reader = c.get("reader");

  const driver = await findDriverForBusiness(reader, businessId, id);
  if (!driver) throw new NotFoundError();

  const balances = await sumOutstandingByDirectionForDriver(reader, businessId, id);
  return c.json(
    {
      driverId: id,
      owedToUsMinor: toWire(balances.owedToUsMinor as Minor),
      owedByUsMinor: toWire(balances.owedByUsMinor as Minor),
    },
    200,
  );
};

/**
 * A5/GAP-24/GAP-29. `dailyOperations` — the staff-facing twin of
 * `GET /api/driver-view`, same `getDriverOwnView` domain function, keyed
 * by an explicit `{id}` instead of the caller's own identity. This is
 * the W-49 test class's sharpest case: a route that takes a `driverId`
 * and returns a driver's money is exactly what INV-25 forbids on the
 * driver's own route — legitimate here only because the caller is staff
 * and the id is business-scoped, so a linked-driver token must 403
 * outright (proven in the integration tests, not assumed from the
 * capability gate alone).
 */
export const getDriverHistoryHandler: RouteHandler<typeof getDriverHistoryRoute, Env> = async (
  c,
) => {
  requireCapability(c, "dailyOperations");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");
  const { from, to } = c.req.valid("query");
  const reader = c.get("reader");

  const driver = await findDriverForBusiness(reader, businessId, id);
  if (!driver) throw new NotFoundError();

  const view = await getDriverOwnView(reader, businessId, id, from, to);
  return c.json(toDriverViewResponse(view), 200);
};
