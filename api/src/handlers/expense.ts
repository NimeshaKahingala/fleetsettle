import { asBusinessDate, businessToday, toWire, type Minor } from "@fleetsettle/shared";
import type { RouteHandler } from "@hono/zod-openapi";
import {
  requireBusinessId,
  requireBusinessTimezone,
  requireCapability,
  requireUserId,
} from "../auth/context.js";
import { createExpense, resolveBorneByDefault, voidExpense } from "../domain/expense.js";
import { NotFoundError } from "../errors/app-error.js";
import { findCustomerForBusiness } from "../queries/customer.js";
import { findVehicleWithOldestUnconfirmedDay } from "../queries/day-record.js";
import { findDriverForBusiness } from "../queries/driver.js";
import {
  listExpensesForBusiness,
  type BusinessExpenseRow,
  type ExpenseFilters,
} from "../queries/expense.js";
import { findIncidentForBusiness } from "../queries/incident.js";
import { findBusinessMemberUserId } from "../queries/partner.js";
import { findTripForBusiness } from "../queries/trip.js";
import { findVehicleForBusiness } from "../queries/vehicle.js";
import type {
  createExpenseRoute,
  expensePrefillVehicleRoute,
  listExpensesRoute,
  resolveBorneByRoute,
  voidExpenseRoute,
} from "../route-defs/expense.js";
import type { Env } from "../types.js";

/** F-3.1/F-3.2/F-3.3. `dailyOperations` (STAFF) — the same capability expenses are already grouped under (`auth/policy.ts`). */
export const createExpenseHandler: RouteHandler<typeof createExpenseRoute, Env> = async (c) => {
  requireCapability(c, "dailyOperations");
  const businessId = requireBusinessId(c);
  const userId = requireUserId(c);
  const body = c.req.valid("json");
  const reader = c.get("reader");
  const spentOn = asBusinessDate(body.spentOn);

  if (body.vehicleId !== undefined) {
    const vehicle = await findVehicleForBusiness(reader, businessId, body.vehicleId);
    if (!vehicle) throw new NotFoundError("No such vehicle in this business");
  }

  if (body.tripId !== undefined) {
    const trip = await findTripForBusiness(reader, businessId, body.tripId);
    if (!trip) throw new NotFoundError("No such trip in this business");
  }

  if (body.incidentId !== undefined) {
    const incidentRow = await findIncidentForBusiness(reader, businessId, body.incidentId);
    if (!incidentRow) throw new NotFoundError("No such incident in this business");
  }

  if (body.borneByDriverId !== undefined) {
    const driver = await findDriverForBusiness(reader, businessId, body.borneByDriverId);
    if (!driver) throw new NotFoundError("No such driver in this business");
  }
  if (body.borneByCustomerId !== undefined) {
    const customer = await findCustomerForBusiness(reader, businessId, body.borneByCustomerId);
    if (!customer) throw new NotFoundError("No such customer in this business");
  }

  // GAP-207/NM-5: paidByUserId names whose pocket the cash came from
  // (W-48's paid_by half) and was trusted from the request body outright —
  // the same class of hole GAP-93 already closed for a payment's own
  // partner party.
  if (body.paidByUserId !== undefined) {
    const member = await findBusinessMemberUserId(reader, businessId, body.paidByUserId);
    if (!member) throw new NotFoundError("No such active member in this business");
  }

  const resolved =
    body.borneBy !== undefined
      ? {
          borneBy: body.borneBy,
          ...(body.borneByDriverId !== undefined ? { borneByDriverId: body.borneByDriverId } : {}),
          ...(body.borneByCustomerId !== undefined
            ? { borneByCustomerId: body.borneByCustomerId }
            : {}),
        }
      : body.vehicleId !== undefined
        ? await resolveBorneByDefault(reader, body.vehicleId, body.category, spentOn)
        : { borneBy: "us" as const };

  const { expenseId, odometerReadingId } = await createExpense(c.get("writer"), {
    ...(body.vehicleId !== undefined ? { vehicleId: body.vehicleId } : {}),
    ...(body.tripId !== undefined ? { tripId: body.tripId } : {}),
    ...(body.incidentId !== undefined ? { incidentId: body.incidentId } : {}),
    businessId,
    category: body.category,
    amountMinor: body.amountMinor,
    spentOn,
    ...resolved,
    paidByUserId: body.paidByUserId ?? userId,
    actorUserId: userId,
    ...(body.litres !== undefined ? { litres: body.litres } : {}),
    ...(body.odometerReadingKm !== undefined ? { odometerReadingKm: body.odometerReadingKm } : {}),
    ...(body.odometerSource !== undefined ? { odometerSource: body.odometerSource } : {}),
    ...(body.note !== undefined ? { note: body.note } : {}),
    ...(body.replacesId !== undefined ? { replacesId: body.replacesId } : {}),
  });

  return c.json(
    {
      id: expenseId,
      vehicleId: body.vehicleId ?? null,
      tripId: body.tripId ?? null,
      incidentId: body.incidentId ?? null,
      category: body.category,
      amountMinor: toWire(body.amountMinor),
      spentOn: body.spentOn,
      borneBy: resolved.borneBy,
      borneByDriverId: resolved.borneByDriverId ?? null,
      borneByCustomerId: resolved.borneByCustomerId ?? null,
      paidByUserId: body.paidByUserId ?? userId,
      litres: body.litres ?? null,
      odometerReadingId,
      note: body.note ?? null,
      replacesId: body.replacesId ?? null,
    },
    201,
  );
};

/** F-8.5/UC-96. `dailyOperations` (STAFF) — same actor as F-3.1 itself ("Manager"). */
export const voidExpenseHandler: RouteHandler<typeof voidExpenseRoute, Env> = async (c) => {
  requireCapability(c, "dailyOperations");
  const businessId = requireBusinessId(c);
  const userId = requireUserId(c);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");

  const result = await voidExpense(c.get("writer"), {
    businessId,
    expenseId: id,
    reason: body.reason,
    userId,
  });

  return c.json(result, 200);
};

function toListRow(row: BusinessExpenseRow) {
  return {
    id: row.id,
    vehicleId: row.vehicleId,
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
    odometerReadingId: row.odometerReadingId,
    note: row.note,
    voidedAt: row.voidedAt,
    voidedReason: row.voidedReason,
    replacesId: row.replacesId,
  } as const;
}

/** Web-P8b's costs list (F-3.1). `dailyOperations` (STAFF) — same gate as create. */
export const listExpensesHandler: RouteHandler<typeof listExpensesRoute, Env> = async (c) => {
  requireCapability(c, "dailyOperations");
  const businessId = requireBusinessId(c);
  const query = c.req.valid("query");

  const filters: ExpenseFilters = {
    ...(query.vehicleId !== undefined ? { vehicleId: query.vehicleId } : {}),
    ...(query.tripId !== undefined ? { tripId: query.tripId } : {}),
    ...(query.incidentId !== undefined ? { incidentId: query.incidentId } : {}),
    ...(query.category !== undefined ? { category: query.category } : {}),
    ...(query.from !== undefined ? { from: query.from } : {}),
    ...(query.to !== undefined ? { to: query.to } : {}),
  };

  const rows = await listExpensesForBusiness(c.get("reader"), businessId, filters);
  return c.json(rows.map(toListRow), 200);
};

/** GAP-32/§6.7. `dailyOperations` (STAFF) — same gate as create, the flow this preview feeds. */
export const resolveBorneByHandler: RouteHandler<typeof resolveBorneByRoute, Env> = async (c) => {
  requireCapability(c, "dailyOperations");
  const businessId = requireBusinessId(c);
  const { vehicleId, category, spentOn } = c.req.valid("query");
  const reader = c.get("reader");

  const vehicle = await findVehicleForBusiness(reader, businessId, vehicleId);
  if (!vehicle) throw new NotFoundError("No such vehicle in this business");

  const resolved = await resolveBorneByDefault(
    reader,
    vehicleId,
    category,
    asBusinessDate(spentOn),
  );

  return c.json(
    {
      borneBy: resolved.borneBy,
      borneByDriverId: resolved.borneByDriverId ?? null,
      borneByCustomerId: resolved.borneByCustomerId ?? null,
    },
    200,
  );
};

/** GAP-34/U-3. `dailyOperations` (STAFF) — same gate as create, the flow this prefill feeds. */
export const expensePrefillVehicleHandler: RouteHandler<
  typeof expensePrefillVehicleRoute,
  Env
> = async (c) => {
  requireCapability(c, "dailyOperations");
  const businessId = requireBusinessId(c);
  const today = businessToday(requireBusinessTimezone(c));

  const pending = await findVehicleWithOldestUnconfirmedDay(c.get("reader"), businessId, today);

  return c.json({ vehicleId: pending?.vehicleId ?? null }, 200);
};
