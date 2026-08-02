import { asBusinessDate, toWire } from "@fleetsettle/shared";
import type { RouteHandler } from "@hono/zod-openapi";
import { requireBusinessId, requireCapability, requireUserId } from "../auth/context.js";
import { recordWriteOff, recordWriteOffRecovery } from "../domain/write-off.js";
import { NotFoundError } from "../errors/app-error.js";
import { findCustomerForBusiness } from "../queries/customer.js";
import { findDriverForBusiness } from "../queries/driver.js";
import { findObligationForBusiness } from "../queries/obligation.js";
import type { recordWriteOffRecoveryRoute, recordWriteOffRoute } from "../route-defs/write-off.js";
import type { Env } from "../types.js";

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

  const { recoveryId, paymentId } = await recordWriteOffRecovery(c.get("writer"), {
    businessId,
    writeOffId: id,
    amountMinor: body.amountMinor,
    occurredOn: asBusinessDate(body.occurredOn),
    userId,
  });

  return c.json(
    {
      id: recoveryId,
      writeOffId: id,
      paymentId,
      amountMinor: toWire(body.amountMinor),
    },
    201,
  );
};
