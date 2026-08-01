import { asBusinessDate, toWire, type Minor } from "@fleetsettle/shared";
import type { RouteHandler } from "@hono/zod-openapi";
import { requireBusinessId, requireCapability, requireUserId } from "../auth/context.js";
import { recordDepositMovement, takeDriverDeposit } from "../domain/deposit.js";
import { NotFoundError } from "../errors/app-error.js";
import { findDriverForBusiness } from "../queries/driver.js";
import type { DepositRow } from "../queries/driver-money.js";
import type { recordDepositMovementRoute, takeDriverDepositRoute } from "../route-defs/deposit.js";
import type { Env } from "../types.js";

/** `row.partyDriverId` is passed alongside rather than read off `row` — every deposit this API creates is `party_type='driver'`, but the column itself stays nullable for the `party_type='customer'` deposits DM §10.4 also allows. */
function toResponse(row: DepositRow, partyDriverId: string, heldMinor: bigint) {
  return {
    id: row.id,
    partyDriverId,
    status: row.status,
    heldMinor: toWire(heldMinor as Minor),
  };
}

/** F-6.7/UC-58/W-8. `dailyOperations` (STAFF). */
export const takeDriverDepositHandler: RouteHandler<typeof takeDriverDepositRoute, Env> = async (
  c,
) => {
  requireCapability(c, "dailyOperations");
  const businessId = requireBusinessId(c);
  const userId = requireUserId(c);
  const body = c.req.valid("json");
  const reader = c.get("reader");

  const driver = await findDriverForBusiness(reader, businessId, body.driverId);
  if (!driver) throw new NotFoundError("No such driver in this business");

  const { depositId } = await takeDriverDeposit(c.get("writer"), {
    businessId,
    driverId: body.driverId,
    amountMinor: body.amountMinor,
    occurredOn: asBusinessDate(body.occurredOn),
    userId,
  });

  return c.json(
    toResponse(
      { id: depositId, businessId, partyDriverId: body.driverId, status: "held" },
      body.driverId,
      body.amountMinor,
    ),
    201,
  );
};

export const recordDepositMovementHandler: RouteHandler<
  typeof recordDepositMovementRoute,
  Env
> = async (c) => {
  requireCapability(c, "dailyOperations");
  const businessId = requireBusinessId(c);
  const userId = requireUserId(c);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");

  const result = await recordDepositMovement(c.get("writer"), {
    businessId,
    depositId: id,
    movementType: body.movementType,
    amountMinor: body.amountMinor,
    occurredOn: asBusinessDate(body.occurredOn),
    ...(body.reason !== undefined ? { reason: body.reason } : {}),
    userId,
  });

  if (result.deposit.partyDriverId === null) {
    throw new Error(
      "deposit has no party_driver_id — every deposit this API creates is a driver's",
    );
  }
  return c.json(toResponse(result.deposit, result.deposit.partyDriverId, result.heldMinor), 200);
};
