import { newId, toWire, type Minor } from "@fleetsettle/shared";
import type { RouteHandler } from "@hono/zod-openapi";
import { requireBusinessId, requireCapability, requireUserId } from "../auth/context.js";
import { archiveDriver, unarchiveDriver } from "../domain/party-archive.js";
import { getDriverOwnView } from "../domain/driver-view.js";
import { inviteDriverLink } from "../domain/membership.js";
import { NotFoundError } from "../errors/app-error.js";
import {
  findDriverForBusiness,
  insertDriver,
  listDriversForBusiness,
  unlinkDriver,
  type DriverRow,
} from "../queries/driver.js";
import { sumOutstandingByDirectionForDriver } from "../queries/obligation.js";
import type {
  archiveDriverRoute,
  createDriverRoute,
  getDriverBalancesRoute,
  getDriverHistoryRoute,
  getDriverRoute,
  inviteDriverLinkRoute,
  listDriversRoute,
  unarchiveDriverRoute,
  unlinkDriverRoute,
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
    archivedAt: row.voidedAt,
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
      archivedAt: null,
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

/**
 * F-1.8/W-42/A11. `manageEntities` (STAFF), not `manageMembers` — F-1.8's own
 * actor is "Manager", the same as F-1.6 (add a driver), and unlike F-1.4
 * this never touches `business_member` or grants access to the business
 * itself: it only lets an existing driver record see its own read-only
 * money, the same boundary `manageEntities` already gates for the rest of
 * the driver record.
 */
export const inviteDriverLinkHandler: RouteHandler<typeof inviteDriverLinkRoute, Env> = async (
  c,
) => {
  requireCapability(c, "manageEntities");

  const businessId = requireBusinessId(c);
  const userId = requireUserId(c);
  const { id } = c.req.valid("param");

  const driver = await findDriverForBusiness(c.get("reader"), businessId, id);
  if (!driver) throw new NotFoundError();

  const issued = await inviteDriverLink(c.get("writer"), {
    businessId,
    driverId: id,
    createdBy: userId,
  });
  return c.json(issued, 201);
};

/** F-1.8's "Unlink" alternate — same `manageEntities` gate as linking. */
export const unlinkDriverHandler: RouteHandler<typeof unlinkDriverRoute, Env> = async (c) => {
  requireCapability(c, "manageEntities");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");

  const row = await findDriverForBusiness(c.get("reader"), businessId, id);
  if (!row) throw new NotFoundError();

  await unlinkDriver(c.get("writer"), id);
  return c.json(toResponse(row), 200);
};

/** F-1.11/UC-100/W-60/GAP-36. `manageEntities` — same gate as F-1.6 (add a driver). */
export const archiveDriverHandler: RouteHandler<typeof archiveDriverRoute, Env> = async (c) => {
  requireCapability(c, "manageEntities");

  const businessId = requireBusinessId(c);
  const userId = requireUserId(c);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const reader = c.get("reader");

  const row = await findDriverForBusiness(reader, businessId, id);
  if (!row) throw new NotFoundError();

  const { voidedAt } = await archiveDriver(reader, c.get("writer"), {
    businessId,
    partyId: id,
    reason: body.reason,
    userId,
  });

  return c.json({ ...toResponse(row), archivedAt: voidedAt }, 200);
};

/** F-1.11's "Unarchive" alternate — same `manageEntities` gate. */
export const unarchiveDriverHandler: RouteHandler<typeof unarchiveDriverRoute, Env> = async (c) => {
  requireCapability(c, "manageEntities");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");
  const reader = c.get("reader");

  const row = await findDriverForBusiness(reader, businessId, id);
  if (!row) throw new NotFoundError();

  await unarchiveDriver(reader, c.get("writer"), businessId, id);
  return c.json({ ...toResponse(row), archivedAt: null }, 200);
};
