import { businessToday, newId, toWire, type Minor } from "@fleetsettle/shared";
import type { RouteHandler } from "@hono/zod-openapi";
import {
  requireBusinessId,
  requireBusinessTimezone,
  requireCapability,
  requireUserId,
} from "../auth/context.js";
import { deriveTripStatus } from "../domain/trip.js";
import {
  archiveVehicle,
  changeVehicleArrangement,
  createVehicle,
  markVehicleUnavailable,
  unarchiveVehicle,
  voidVehicleUnavailability,
} from "../domain/vehicles.js";
import { NotFoundError } from "../errors/app-error.js";
import { listDailyLeasesForVehicle } from "../queries/dailyLease.js";
import { listExpensesForVehicle } from "../queries/expense.js";
import { listIncidentsForVehicle } from "../queries/incident.js";
import { listLeasesForVehicle } from "../queries/lease.js";
import { listTripsForVehicle } from "../queries/trip.js";
import {
  findVehicleCalendar,
  findVehicleForBusiness,
  listVehicleDocumentsForVehicle,
  listVehiclesForBusiness,
  listVehicleUnavailabilityForVehicle,
  upsertVehicleDocument,
  type VehicleRow,
} from "../queries/vehicle.js";
import type {
  archiveVehicleRoute,
  changeVehicleArrangementRoute,
  createVehicleRoute,
  getVehicleCalendarRoute,
  getVehicleRoute,
  listVehicleDailyLeaseHistoryRoute,
  listVehicleDocumentsRoute,
  listVehicleExpensesRoute,
  listVehicleIncidentsRoute,
  listVehicleLeaseHistoryRoute,
  listVehicleTripsRoute,
  listVehicleUnavailabilityRoute,
  listVehiclesRoute,
  markVehicleUnavailableRoute,
  unarchiveVehicleRoute,
  upsertVehicleDocumentRoute,
  voidVehicleUnavailabilityRoute,
} from "../route-defs/vehicle.js";
import { incidentToResponse } from "./incident.js";
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

/** GAP-36/A9b item 2. `manageEntities` — same gate as `createVehicleRoute`. */
export const archiveVehicleHandler: RouteHandler<typeof archiveVehicleRoute, Env> = async (c) => {
  requireCapability(c, "manageEntities");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");
  const reader = c.get("reader");

  const row = await findVehicleForBusiness(reader, businessId, id);
  if (!row) throw new NotFoundError();

  await archiveVehicle(c.get("writer"), id);
  return c.json(toResponse({ ...row, lifecycle: "archived" }), 200);
};

/** "Unarchive" alternate — same `manageEntities` gate. */
export const unarchiveVehicleHandler: RouteHandler<typeof unarchiveVehicleRoute, Env> = async (
  c,
) => {
  requireCapability(c, "manageEntities");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");
  const reader = c.get("reader");

  const row = await findVehicleForBusiness(reader, businessId, id);
  if (!row) throw new NotFoundError();

  await unarchiveVehicle(c.get("writer"), id);
  return c.json(toResponse({ ...row, lifecycle: "active" }), 200);
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
      dayRecordState: day.dayRecordState,
    })),
    200,
  );
};

interface UnavailabilityLike {
  id: string;
  vehicleId: string;
  reason: "service" | "sale_preparation" | "other";
  unavailableFrom: string;
  unavailableTo: string | null;
  note: string | null;
}

function unavailabilityToResponse(row: UnavailabilityLike) {
  return {
    id: row.id,
    vehicleId: row.vehicleId,
    reason: row.reason,
    unavailableFrom: row.unavailableFrom,
    unavailableTo: row.unavailableTo,
    note: row.note,
  };
}

/** F-1.10/GAP-26. `dailyOperations` — an operational, day-to-day fact about the vehicle, the same gate `listVehicleIncidentsHandler` uses. */
export const markVehicleUnavailableHandler: RouteHandler<
  typeof markVehicleUnavailableRoute,
  Env
> = async (c) => {
  requireCapability(c, "dailyOperations");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");

  const row = await markVehicleUnavailable(c.get("writer"), {
    businessId,
    vehicleId: id,
    reason: body.reason,
    unavailableFrom: body.unavailableFrom,
    ...(body.unavailableTo !== undefined ? { unavailableTo: body.unavailableTo } : {}),
    ...(body.note !== undefined ? { note: body.note } : {}),
    userId: requireUserId(c),
  });

  return c.json(unavailabilityToResponse(row), 201);
};

/** F-1.5's own calendar. Same gate as reading it. */
export const listVehicleUnavailabilityHandler: RouteHandler<
  typeof listVehicleUnavailabilityRoute,
  Env
> = async (c) => {
  requireCapability(c, "dailyOperations");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");
  const { from, to } = c.req.valid("query");
  const reader = c.get("reader");

  const vehicleRow = await findVehicleForBusiness(reader, businessId, id);
  if (!vehicleRow) throw new NotFoundError();

  const rows = await listVehicleUnavailabilityForVehicle(reader, id, from, to);
  return c.json(rows.map(unavailabilityToResponse), 200);
};

/** F-1.10/GAP-26: correct or end an outage. Same gate as creating one. */
export const voidVehicleUnavailabilityHandler: RouteHandler<
  typeof voidVehicleUnavailabilityRoute,
  Env
> = async (c) => {
  requireCapability(c, "dailyOperations");

  const businessId = requireBusinessId(c);
  const { id, unavailabilityId } = c.req.valid("param");
  const body = c.req.valid("json");

  const voided = await voidVehicleUnavailability(c.get("writer"), {
    businessId,
    vehicleId: id,
    unavailabilityId,
    reason: body.reason,
    userId: requireUserId(c),
  });

  return c.json({ id: unavailabilityId, voidedAt: voided.voidedAt }, 200);
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

/** F-1.2/UC-94/GAP-54. `manageEntities` — the same gate `createVehicleHandler` uses. */
export const changeVehicleArrangementHandler: RouteHandler<
  typeof changeVehicleArrangementRoute,
  Env
> = async (c) => {
  requireCapability(c, "manageEntities");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");

  const vehicleRow = await findVehicleForBusiness(c.get("reader"), businessId, id);
  if (!vehicleRow) throw new NotFoundError();

  const result = await changeVehicleArrangement(c.get("writer"), {
    vehicleId: id,
    arrangement: body.arrangement,
    effectiveFrom: body.effectiveFrom,
    userId: requireUserId(c),
  });

  return c.json(result, 201);
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

/** Vehicle overview's own Incidents section (Web-P8a). `dailyOperations` — matches every other incident endpoint's own gate, not this file's `manageEntities`. */
export const listVehicleIncidentsHandler: RouteHandler<
  typeof listVehicleIncidentsRoute,
  Env
> = async (c) => {
  requireCapability(c, "dailyOperations");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");

  const vehicleRow = await findVehicleForBusiness(c.get("reader"), businessId, id);
  if (!vehicleRow) throw new NotFoundError();

  const rows = await listIncidentsForVehicle(c.get("reader"), businessId, id);
  return c.json(rows.map(incidentToResponse), 200);
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

/** GAP-77/UC-71: an arrangement-C vehicle's own trip history. `dailyOperations` — matches `listVehicleIncidentsHandler`'s own gate, not this file's `manageEntities`. */
export const listVehicleTripsHandler: RouteHandler<typeof listVehicleTripsRoute, Env> = async (
  c,
) => {
  requireCapability(c, "dailyOperations");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");

  const vehicleRow = await findVehicleForBusiness(c.get("reader"), businessId, id);
  if (!vehicleRow) throw new NotFoundError();

  const today = businessToday(requireBusinessTimezone(c));
  const rows = await listTripsForVehicle(c.get("reader"), businessId, id);
  return c.json(
    rows.map((row) => ({
      id: row.id,
      status: deriveTripStatus(row, today),
      startDate: row.startDate,
      endDate: row.endDate,
      destination: row.destination,
      customerId: row.customerId,
      customerName: row.customerName,
      driverId: row.driverId,
      driverName: row.driverName,
      agreedAmountMinor: toWire(row.agreedAmountMinor as Minor),
    })),
    200,
  );
};
