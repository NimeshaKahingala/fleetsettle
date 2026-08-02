import { asBusinessDate, toWire } from "@fleetsettle/shared";
import type { RouteHandler } from "@hono/zod-openapi";
import { requireBusinessId, requireCapability, requireUserId } from "../auth/context.js";
import { createExpense, resolveBorneByDefault, voidExpense } from "../domain/expense.js";
import { NotFoundError } from "../errors/app-error.js";
import { findCustomerForBusiness } from "../queries/customer.js";
import { findDriverForBusiness } from "../queries/driver.js";
import { findIncidentForBusiness } from "../queries/incident.js";
import { findTripForBusiness } from "../queries/trip.js";
import { findVehicleForBusiness } from "../queries/vehicle.js";
import type { createExpenseRoute, voidExpenseRoute } from "../route-defs/expense.js";
import type { Env } from "../types.js";

/** F-3.1/F-3.2/F-3.3. `dailyOperations` (STAFF) — the same capability expenses are already grouped under (`auth/policy.ts`). */
export const createExpenseHandler: RouteHandler<typeof createExpenseRoute, Env> = async (c) => {
  requireCapability(c, "dailyOperations");
  const businessId = requireBusinessId(c);
  const userId = requireUserId(c);
  const body = c.req.valid("json");
  const reader = c.get("reader");

  let arrangement: "A" | "B" | "C" | null = null;
  if (body.vehicleId !== undefined) {
    const vehicle = await findVehicleForBusiness(reader, businessId, body.vehicleId);
    if (!vehicle) throw new NotFoundError("No such vehicle in this business");
    arrangement = vehicle.arrangement;
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
        ? await resolveBorneByDefault(reader, body.vehicleId, body.category, arrangement)
        : { borneBy: "us" as const };

  const { expenseId } = await createExpense(c.get("writer"), {
    ...(body.vehicleId !== undefined ? { vehicleId: body.vehicleId } : {}),
    ...(body.tripId !== undefined ? { tripId: body.tripId } : {}),
    ...(body.incidentId !== undefined ? { incidentId: body.incidentId } : {}),
    businessId,
    category: body.category,
    amountMinor: body.amountMinor,
    spentOn: asBusinessDate(body.spentOn),
    ...resolved,
    paidByUserId: body.paidByUserId ?? userId,
    ...(body.litres !== undefined ? { litres: body.litres } : {}),
    ...(body.note !== undefined ? { note: body.note } : {}),
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
      note: body.note ?? null,
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
