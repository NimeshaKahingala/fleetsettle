import { asBusinessDate, toWire, type Minor } from "@fleetsettle/shared";
import type { RouteHandler } from "@hono/zod-openapi";
import { requireBusinessId, requireCapability, requireUserId } from "../auth/context.js";
import {
  recordDepositMovement,
  takeDriverDeposit,
  voidDepositMovement,
} from "../domain/deposit.js";
import { NotFoundError } from "../errors/app-error.js";
import { findDriverForBusiness } from "../queries/driver.js";
import type { DepositRow } from "../queries/driver-money.js";
import type {
  recordDepositMovementRoute,
  takeDriverDepositRoute,
  voidDepositMovementRoute,
} from "../route-defs/deposit.js";
import type { Env } from "../types.js";
import { assertNotFutureBusinessDate } from "../validation.js";

/** `row.partyDriverId` is passed alongside rather than read off `row` — every deposit this API creates is `party_type='driver'`, but the column itself stays nullable for the `party_type='customer'` deposits DM §10.4 also allows. */
function toResponse(
  row: DepositRow,
  partyDriverId: string,
  heldMinor: bigint,
  movementId: string,
  movementReplacesId: string | null,
) {
  return {
    id: row.id,
    partyDriverId,
    status: row.status,
    heldMinor: toWire(heldMinor as Minor),
    movementId,
    movementReplacesId,
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

  assertNotFutureBusinessDate(c, asBusinessDate(body.occurredOn), "occurredOn");

  const { depositId, movementId } = await takeDriverDeposit(c.get("writer"), {
    businessId,
    driverId: body.driverId,
    amountMinor: body.amountMinor,
    occurredOn: asBusinessDate(body.occurredOn),
    userId,
  });

  return c.json(
    toResponse(
      {
        id: depositId,
        businessId,
        partyType: "driver",
        partyCustomerId: null,
        partyDriverId: body.driverId,
        leaseId: null,
        status: "held",
        holdReleaseDate: null,
      },
      body.driverId,
      body.amountMinor,
      movementId,
      null,
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

  assertNotFutureBusinessDate(c, asBusinessDate(body.occurredOn), "occurredOn");

  const result = await recordDepositMovement(c.get("writer"), {
    businessId,
    depositId: id,
    movementType: body.movementType,
    amountMinor: body.amountMinor,
    occurredOn: asBusinessDate(body.occurredOn),
    ...(body.reason !== undefined ? { reason: body.reason } : {}),
    ...(body.obligationId !== undefined ? { obligationId: body.obligationId } : {}),
    userId,
    ...(body.replacesId !== undefined ? { replacesId: body.replacesId } : {}),
  });

  if (result.deposit.partyDriverId === null) {
    throw new Error(
      "deposit has no party_driver_id — every deposit this API creates is a driver's",
    );
  }
  return c.json(
    toResponse(
      result.deposit,
      result.deposit.partyDriverId,
      result.heldMinor,
      result.movementId,
      body.replacesId ?? null,
    ),
    200,
  );
};

/** GAP-12/W-61/INV-36 §3.3/§3.4. `dailyOperations` — the same gate recording a movement uses. */
export const voidDepositMovementHandler: RouteHandler<
  typeof voidDepositMovementRoute,
  Env
> = async (c) => {
  requireCapability(c, "dailyOperations");
  const businessId = requireBusinessId(c);
  const userId = requireUserId(c);
  const { movementId } = c.req.valid("param");
  const body = c.req.valid("json");

  const result = await voidDepositMovement(c.get("writer"), {
    businessId,
    movementId,
    reason: body.reason,
    userId,
  });

  if (result.deposit.partyDriverId === null) {
    throw new Error(
      "deposit has no party_driver_id — every deposit this API creates is a driver's",
    );
  }

  return c.json(
    {
      id: result.id,
      voidedAt: result.voidedAt,
      deposit: {
        id: result.deposit.id,
        partyDriverId: result.deposit.partyDriverId,
        status: result.deposit.status,
        heldMinor: toWire(result.heldMinor),
      },
    },
    200,
  );
};
