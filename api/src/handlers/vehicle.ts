import { businessToday, newId } from "@fleetsettle/shared";
import type { RouteHandler } from "@hono/zod-openapi";
import { requireBusinessId, requireBusinessTimezone, requireCapability } from "../auth/context.js";
import { createVehicle } from "../domain/vehicles.js";
import { NotFoundError } from "../errors/app-error.js";
import {
  findVehicleForBusiness,
  listVehiclesForBusiness,
  upsertVehicleDocument,
  type VehicleRow,
} from "../queries/vehicle.js";
import type {
  createVehicleRoute,
  getVehicleRoute,
  listVehiclesRoute,
  upsertVehicleDocumentRoute,
} from "../route-defs/vehicle.js";
import type { Env } from "../types.js";

function toResponse(row: VehicleRow) {
  return {
    id: row.id,
    registration: row.registration,
    vehicleType: row.vehicleType,
    lifecycle: row.lifecycle,
    ...(row.arrangement ? { arrangement: row.arrangement } : {}),
  };
}

/** F-1.1 / UC-01. STAFF only (W-3: a driver enters nothing). */
export const createVehicleHandler: RouteHandler<typeof createVehicleRoute, Env> = async (c) => {
  requireCapability(c, "manageEntities");

  const businessId = requireBusinessId(c);
  const today = businessToday(requireBusinessTimezone(c));
  const body = c.req.valid("json");

  const { vehicleId } = await createVehicle(c.get("writer"), {
    businessId,
    registration: body.registration,
    vehicleType: body.vehicleType,
    defaultArrangement: body.defaultArrangement,
    ...(body.insuranceExpiry !== undefined ? { insuranceExpiry: body.insuranceExpiry } : {}),
    ...(body.registrationExpiry !== undefined
      ? { registrationExpiry: body.registrationExpiry }
      : {}),
    today,
  });

  return c.json(
    {
      id: vehicleId,
      registration: body.registration,
      vehicleType: body.vehicleType,
      lifecycle: "active" as const,
      arrangement: body.defaultArrangement,
    },
    201,
  );
};

export const getVehicleHandler: RouteHandler<typeof getVehicleRoute, Env> = async (c) => {
  requireCapability(c, "manageEntities");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");

  const row = await findVehicleForBusiness(c.get("reader"), businessId, id);
  if (!row) throw new NotFoundError();

  return c.json(toResponse(row), 200);
};

export const listVehiclesHandler: RouteHandler<typeof listVehiclesRoute, Env> = async (c) => {
  requireCapability(c, "manageEntities");

  const businessId = requireBusinessId(c);
  const rows = await listVehiclesForBusiness(c.get("reader"), businessId);

  return c.json(rows.map(toResponse), 200);
};

/** F-10.1 / UC-92. */
export const upsertVehicleDocumentHandler: RouteHandler<
  typeof upsertVehicleDocumentRoute,
  Env
> = async (c) => {
  requireCapability(c, "manageEntities");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");

  const vehicleRow = await findVehicleForBusiness(c.get("reader"), businessId, id);
  if (!vehicleRow) throw new NotFoundError();

  await upsertVehicleDocument(c.get("writer"), {
    id: newId(),
    vehicleId: id,
    docType: body.docType,
    expiryDate: body.expiryDate,
    ...(body.reference !== undefined ? { reference: body.reference } : {}),
  });

  return c.json(
    {
      docType: body.docType,
      expiryDate: body.expiryDate,
      ...(body.reference !== undefined ? { reference: body.reference } : {}),
    },
    200,
  );
};
