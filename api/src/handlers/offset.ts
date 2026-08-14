import { asBusinessDate, toWire } from "@fleetsettle/shared";
import type { RouteHandler } from "@hono/zod-openapi";
import { requireBusinessId, requireCapability, requireUserId } from "../auth/context.js";
import { createOffset, voidOffset } from "../domain/offset.js";
import { NotFoundError } from "../errors/app-error.js";
import { findDriverForBusiness } from "../queries/driver.js";
import type { createOffsetRoute, voidOffsetRoute } from "../route-defs/offset.js";
import type { Env } from "../types.js";

/** F-6.4/UC-56/W-2. `dailyOperations` (STAFF) — the same day-to-day capability driver money already sits under. */
export const createOffsetHandler: RouteHandler<typeof createOffsetRoute, Env> = async (c) => {
  requireCapability(c, "dailyOperations");
  const businessId = requireBusinessId(c);
  const userId = requireUserId(c);
  const body = c.req.valid("json");
  const reader = c.get("reader");

  const driver = await findDriverForBusiness(reader, businessId, body.driverId);
  if (!driver) throw new NotFoundError("No such driver in this business");

  const { offsetId } = await createOffset(c.get("writer"), {
    businessId,
    driverId: body.driverId,
    amountMinor: body.amountMinor,
    occurredOn: asBusinessDate(body.occurredOn),
    ...(body.note !== undefined ? { note: body.note } : {}),
    userId,
  });

  return c.json(
    {
      id: offsetId,
      driverId: body.driverId,
      amountMinor: toWire(body.amountMinor),
      occurredOn: body.occurredOn,
      note: body.note ?? null,
    },
    201,
  );
};

/** GAP-12/W-61/INV-36 §3.2. `dailyOperations` — the same gate creating one uses. */
export const voidOffsetHandler: RouteHandler<typeof voidOffsetRoute, Env> = async (c) => {
  requireCapability(c, "dailyOperations");
  const businessId = requireBusinessId(c);
  const userId = requireUserId(c);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");

  const result = await voidOffset(c.get("writer"), {
    businessId,
    offsetId: id,
    reason: body.reason,
    userId,
  });

  return c.json(result, 200);
};
