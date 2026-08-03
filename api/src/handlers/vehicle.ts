import { businessToday, newId, toWire, type Minor } from "@fleetsettle/shared";
import type { RouteHandler } from "@hono/zod-openapi";
import { requireBusinessId, requireBusinessTimezone, requireCapability } from "../auth/context.js";
import { createVehicle } from "../domain/vehicles.js";
import { NotFoundError } from "../errors/app-error.js";
import { listDailyLeasesForVehicle } from "../queries/dailyLease.js";
import { listExpensesForVehicle } from "../queries/expense.js";
import { listLeasesForVehicle } from "../queries/lease.js";
import {
  findVehicleCalendar,
  findVehicleForBusiness,
  listVehicleDocumentsForVehicle,
  listVehiclesForBusiness,
  upsertVehicleDocument,
  type VehicleRow,
} from "../queries/vehicle.js";
import type {
  createVehicleRoute,
  getVehicleCalendarRoute,
  getVehicleRoute,
  listVehicleDailyLeaseHistoryRoute,
  listVehicleDocumentsRoute,
  listVehicleExpensesRoute,
  listVehicleLeaseHistoryRoute,
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

/** UC-95: "is the vehicle free on the 12th" — read-only, `dailyOperations` (the same capability booking a trip or confirming a day needs). */
export const getVehicleCalendarHandler: RouteHandler<typeof getVehicleCalendarRoute, Env> = async (
  c,
) => {
  requireCapability(c, "dailyOperations");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");
  const { from, to } = c.req.valid("query");

  const vehicleRow = await findVehicleForBusiness(c.get("reader"), businessId, id);
  if (!vehicleRow) throw new NotFoundError();

  const days = await findVehicleCalendar(c.get("reader"), businessId, id, from, to);
  return c.json(
    days.map((day) => ({
      businessDate: day.businessDate,
      arrangement: day.arrangement,
      sourceType: day.sourceType,
      sourceId: day.sourceId,
      isHold: day.isHold,
    })),
    200,
  );
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

/** Vehicle overview's paperwork tab (Web-P5). */
export const listVehicleDocumentsHandler: RouteHandler<
  typeof listVehicleDocumentsRoute,
  Env
> = async (c) => {
  requireCapability(c, "manageEntities");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");

  const vehicleRow = await findVehicleForBusiness(c.get("reader"), businessId, id);
  if (!vehicleRow) throw new NotFoundError();

  const rows = await listVehicleDocumentsForVehicle(c.get("reader"), id);
  return c.json(
    rows.map((row) => ({
      docType: row.docType,
      expiryDate: row.expiryDate,
      ...(row.reference !== null ? { reference: row.reference } : {}),
    })),
    200,
  );
};

/** Vehicle overview's costs tab (Web-P5). */
export const listVehicleExpensesHandler: RouteHandler<
  typeof listVehicleExpensesRoute,
  Env
> = async (c) => {
  requireCapability(c, "manageEntities");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");

  const vehicleRow = await findVehicleForBusiness(c.get("reader"), businessId, id);
  if (!vehicleRow) throw new NotFoundError();

  const rows = await listExpensesForVehicle(c.get("reader"), businessId, id);
  return c.json(
    rows.map((row) => ({
      id: row.id,
      vehicleId: id,
      tripId: row.tripId,
      incidentId: row.incidentId,
      category: row.category,
      amountMinor: toWire(row.amountMinor as Minor),
      spentOn: row.spentOn,
      borneBy: row.borneBy,
      borneByDriverId: row.borneByDriverId,
      borneByCustomerId: row.borneByCustomerId,
      paidByUserId: row.paidByUserId,
      litres: row.litres,
      note: row.note,
      voidedAt: row.voidedAt,
      voidedReason: row.voidedReason,
    })),
    200,
  );
};

/** Vehicle overview's history tab (Web-P5): arrangement-A periods. */
export const listVehicleLeaseHistoryHandler: RouteHandler<
  typeof listVehicleLeaseHistoryRoute,
  Env
> = async (c) => {
  requireCapability(c, "manageEntities");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");

  const vehicleRow = await findVehicleForBusiness(c.get("reader"), businessId, id);
  if (!vehicleRow) throw new NotFoundError();

  const rows = await listLeasesForVehicle(c.get("reader"), businessId, id);
  return c.json(
    rows.map((row) => ({
      id: row.id,
      status: row.status,
      startDate: row.startDate,
      endDate: row.endDate,
      rentAmountMinor: toWire(row.rentAmountMinor as Minor),
      customerId: row.customerId,
      customerName: row.customerName,
    })),
    200,
  );
};

/** Vehicle overview's history tab (Web-P5): arrangement-B periods. */
export const listVehicleDailyLeaseHistoryHandler: RouteHandler<
  typeof listVehicleDailyLeaseHistoryRoute,
  Env
> = async (c) => {
  requireCapability(c, "manageEntities");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");

  const vehicleRow = await findVehicleForBusiness(c.get("reader"), businessId, id);
  if (!vehicleRow) throw new NotFoundError();

  const rows = await listDailyLeasesForVehicle(c.get("reader"), businessId, id);
  return c.json(
    rows.map((row) => ({
      id: row.id,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      dailyLeaseAmountMinor: toWire(row.dailyLeaseAmountMinor as Minor),
      driverId: row.driverId,
      driverName: row.driverName,
    })),
    200,
  );
};
