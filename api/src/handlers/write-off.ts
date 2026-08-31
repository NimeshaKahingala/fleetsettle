import { asBusinessDate, toWire, type Minor } from "@fleetsettle/shared";
import type { RouteHandler } from "@hono/zod-openapi";
import { requireBusinessId, requireCapability, requireUserId } from "../auth/context.js";
import {
  recordWriteOff,
  recordWriteOffRecovery,
  voidWriteOff,
  voidWriteOffRecovery,
} from "../domain/write-off.js";
import { NotFoundError } from "../errors/app-error.js";
import { findCustomerForBusiness } from "../queries/customer.js";
import { findDriverForBusiness } from "../queries/driver.js";
import { findObligationForBusiness } from "../queries/obligation.js";
import { findVehicleForBusiness } from "../queries/vehicle.js";
import {
  findWriteOffForBusiness,
  listWriteOffRecoveriesForWriteOff,
  listWriteOffsForBusiness,
  type WriteOffListFilters,
  type WriteOffListRow,
  type WriteOffRecoveryListRow,
} from "../queries/write-off.js";
import type {
  listWriteOffRecoveriesRoute,
  listWriteOffsRoute,
  recordWriteOffRecoveryRoute,
  recordWriteOffRoute,
  voidWriteOffRecoveryRoute,
  voidWriteOffRoute,
} from "../route-defs/write-off.js";
import type { Env } from "../types.js";
import { assertNotFutureBusinessDate } from "../validation.js";

function toListRow(row: WriteOffListRow) {
  return {
    id: row.id,
    obligationId: row.obligationId,
    partyType: row.partyType,
    partyCustomerId: row.partyCustomerId,
    partyDriverId: row.partyDriverId,
    vehicleId: row.vehicleId,
    amountMinor: toWire(row.amountMinor as Minor),
    reason: row.reason,
    writtenOffOn: row.writtenOffOn,
    voidedAt: row.voidedAt,
    voidedReason: row.voidedReason,
    replacesId: row.replacesId,
  };
}

/**
 * A3/GAP-155: originally `writeOffOrWaiveAboveThreshold` — "same audience
 * as recording one," A3's own rule, correct when creating a write-off was
 * the only "recording" this list served. `recordWriteOffRecoveryHandler`
 * later gave recovery its own, correctly-reasoned `dailyOperations` (money
 * arriving is an ordinary operational entry, INV-15) — but nobody revisited
 * this list, so a manager could call the recovery endpoint and had no route
 * to a write-off id to call it against. `dailyOperations` still satisfies
 * A3's own rule: it is the same gate as recording a *recovery*, the write
 * this list now primarily exists to serve for a manager. Create and void
 * stay `writeOffOrWaiveAboveThreshold` — this only widens who can *see*.
 */
export const listWriteOffsHandler: RouteHandler<typeof listWriteOffsRoute, Env> = async (c) => {
  requireCapability(c, "dailyOperations");
  const businessId = requireBusinessId(c);
  const query = c.req.valid("query");

  const filters: WriteOffListFilters = {
    ...(query.partyType !== undefined ? { partyType: query.partyType } : {}),
    ...(query.partyCustomerId !== undefined ? { partyCustomerId: query.partyCustomerId } : {}),
    ...(query.partyDriverId !== undefined ? { partyDriverId: query.partyDriverId } : {}),
    ...(query.vehicleId !== undefined ? { vehicleId: query.vehicleId } : {}),
    ...(query.from !== undefined ? { from: query.from } : {}),
    ...(query.to !== undefined ? { to: query.to } : {}),
  };

  const rows = await listWriteOffsForBusiness(c.get("reader"), businessId, filters);
  return c.json(rows.map(toListRow), 200);
};

/** F-8.3/UC-90/W-28. `writeOffOrWaiveAboveThreshold` — owners only, the same row UC-90's own actor line names. */
export const recordWriteOffHandler: RouteHandler<typeof recordWriteOffRoute, Env> = async (c) => {
  requireCapability(c, "writeOffOrWaiveAboveThreshold");
  const businessId = requireBusinessId(c);
  const userId = requireUserId(c);
  const body = c.req.valid("json");
  const reader = c.get("reader");

  if (body.obligationId !== undefined) {
    const existing = await findObligationForBusiness(reader, businessId, body.obligationId);
    if (!existing) throw new NotFoundError("No such obligation in this business");
  }
  if (body.partyCustomerId !== undefined) {
    const customer = await findCustomerForBusiness(reader, businessId, body.partyCustomerId);
    if (!customer) throw new NotFoundError("No such customer in this business");
  }
  if (body.partyDriverId !== undefined) {
    const driver = await findDriverForBusiness(reader, businessId, body.partyDriverId);
    if (!driver) throw new NotFoundError("No such driver in this business");
  }
  if (body.vehicleId !== undefined) {
    const vehicle = await findVehicleForBusiness(reader, businessId, body.vehicleId);
    if (!vehicle) throw new NotFoundError("No such vehicle in this business");
  }

  assertNotFutureBusinessDate(c, asBusinessDate(body.writtenOffOn), "writtenOffOn");

  const { writeOffId } = await recordWriteOff(c.get("writer"), {
    businessId,
    ...(body.obligationId !== undefined ? { obligationId: body.obligationId } : {}),
    partyType: body.partyType,
    ...(body.partyCustomerId !== undefined ? { partyCustomerId: body.partyCustomerId } : {}),
    ...(body.partyDriverId !== undefined ? { partyDriverId: body.partyDriverId } : {}),
    ...(body.vehicleId !== undefined ? { vehicleId: body.vehicleId } : {}),
    amountMinor: body.amountMinor,
    reason: body.reason,
    writtenOffOn: asBusinessDate(body.writtenOffOn),
    userId,
    ...(body.replacesId !== undefined ? { replacesId: body.replacesId } : {}),
  });

  return c.json(
    {
      id: writeOffId,
      obligationId: body.obligationId ?? null,
      partyType: body.partyType,
      partyCustomerId: body.partyCustomerId ?? null,
      partyDriverId: body.partyDriverId ?? null,
      vehicleId: body.vehicleId ?? null,
      amountMinor: toWire(body.amountMinor),
      reason: body.reason,
      writtenOffOn: body.writtenOffOn,
      replacesId: body.replacesId ?? null,
    },
    201,
  );
};

/** INV-15. `dailyOperations` (STAFF) — recording money that arrived is an ordinary operational entry, the same group as collections. */
export const recordWriteOffRecoveryHandler: RouteHandler<
  typeof recordWriteOffRecoveryRoute,
  Env
> = async (c) => {
  requireCapability(c, "dailyOperations");
  const businessId = requireBusinessId(c);
  const userId = requireUserId(c);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");

  assertNotFutureBusinessDate(c, asBusinessDate(body.occurredOn), "occurredOn");

  const { recoveryId, paymentId } = await recordWriteOffRecovery(c.get("writer"), {
    businessId,
    writeOffId: id,
    amountMinor: body.amountMinor,
    occurredOn: asBusinessDate(body.occurredOn),
    userId,
    ...(body.replacesId !== undefined ? { replacesId: body.replacesId } : {}),
  });

  return c.json(
    {
      id: recoveryId,
      writeOffId: id,
      paymentId,
      amountMinor: toWire(body.amountMinor),
      replacesId: body.replacesId ?? null,
    },
    201,
  );
};

function toRecoveryListRow(row: WriteOffRecoveryListRow) {
  return {
    id: row.id,
    writeOffId: row.writeOffId,
    paymentId: row.paymentId,
    amountMinor: toWire(row.amountMinor as Minor),
    occurredOn: row.occurredOn,
    voidedAt: row.voidedAt,
    voidedReason: row.voidedReason,
    replacesId: row.replacesId,
  };
}

/** GAP-147: `dailyOperations` — the same gate recording a recovery uses, so a manager can find one to void. */
export const listWriteOffRecoveriesHandler: RouteHandler<
  typeof listWriteOffRecoveriesRoute,
  Env
> = async (c) => {
  requireCapability(c, "dailyOperations");
  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");

  const writeOffRow = await findWriteOffForBusiness(c.get("reader"), businessId, id);
  if (!writeOffRow) throw new NotFoundError("No such write-off in this business");

  const rows = await listWriteOffRecoveriesForWriteOff(c.get("reader"), businessId, id);
  return c.json(rows.map(toRecoveryListRow), 200);
};

/** GAP-12/W-61/INV-36 §3.7. `writeOffOrWaiveAboveThreshold` — the same gate creating one uses. */
export const voidWriteOffHandler: RouteHandler<typeof voidWriteOffRoute, Env> = async (c) => {
  requireCapability(c, "writeOffOrWaiveAboveThreshold");
  const businessId = requireBusinessId(c);
  const userId = requireUserId(c);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");

  const result = await voidWriteOff(c.get("writer"), {
    businessId,
    writeOffId: id,
    reason: body.reason,
    userId,
  });

  return c.json(result, 200);
};

/** GAP-12/W-61/INV-36 §3.8. `dailyOperations` — the same gate recording one uses. */
export const voidWriteOffRecoveryHandler: RouteHandler<
  typeof voidWriteOffRecoveryRoute,
  Env
> = async (c) => {
  requireCapability(c, "dailyOperations");
  const businessId = requireBusinessId(c);
  const userId = requireUserId(c);
  const { recoveryId } = c.req.valid("param");
  const body = c.req.valid("json");

  const result = await voidWriteOffRecovery(c.get("writer"), {
    businessId,
    recoveryId,
    reason: body.reason,
    userId,
  });

  return c.json(result, 200);
};
