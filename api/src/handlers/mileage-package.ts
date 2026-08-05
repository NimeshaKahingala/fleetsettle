import { newId, toWire, type Minor } from "@fleetsettle/shared";
import type { RouteHandler } from "@hono/zod-openapi";
import { requireBusinessId, requireCapability } from "../auth/context.js";
import { NotFoundError } from "../errors/app-error.js";
import {
  archiveMileagePackageRow,
  findMileagePackageForBusiness,
  insertMileagePackage,
  listMileagePackagesForBusiness,
  type MileagePackageRow,
} from "../queries/mileage-package.js";
import type {
  archiveMileagePackageRoute,
  createMileagePackageRoute,
  listMileagePackagesRoute,
} from "../route-defs/mileage-package.js";
import type { Env } from "../types.js";

function toResponse(row: MileagePackageRow) {
  return {
    id: row.id,
    name: row.name,
    dailyLimitKm: row.dailyLimitKm,
    excessRateMinorPerKm: toWire(row.excessRateMinorPerKm as Minor),
    archivedAt: row.archivedAt,
  };
}

/** F-1.9/UC-18. */
export const createMileagePackageHandler: RouteHandler<
  typeof createMileagePackageRoute,
  Env
> = async (c) => {
  requireCapability(c, "manageEntities");

  const businessId = requireBusinessId(c);
  const body = c.req.valid("json");
  const id = newId();

  await insertMileagePackage(c.get("writer"), {
    id,
    businessId,
    name: body.name,
    dailyLimitKm: body.dailyLimitKm,
    excessRateMinorPerKm: body.excessRateMinorPerKm,
  });

  return c.json(
    {
      id,
      name: body.name,
      dailyLimitKm: body.dailyLimitKm,
      excessRateMinorPerKm: toWire(body.excessRateMinorPerKm),
      archivedAt: null,
    },
    201,
  );
};

/** F-2.1 step 4's chip list. */
export const listMileagePackagesHandler: RouteHandler<
  typeof listMileagePackagesRoute,
  Env
> = async (c) => {
  requireCapability(c, "manageEntities");

  const businessId = requireBusinessId(c);
  const rows = await listMileagePackagesForBusiness(c.get("reader"), businessId);

  return c.json(rows.map(toResponse), 200);
};

/** F-1.9's Accept: archive, never delete. */
export const archiveMileagePackageHandler: RouteHandler<
  typeof archiveMileagePackageRoute,
  Env
> = async (c) => {
  requireCapability(c, "manageEntities");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");

  const row = await findMileagePackageForBusiness(c.get("reader"), businessId, id);
  if (!row) throw new NotFoundError();

  const { archivedAt } = await archiveMileagePackageRow(c.get("writer"), id);

  return c.json({ ...toResponse(row), archivedAt }, 200);
};
