import { toWire, type Minor } from "@fleetsettle/shared";
import type { RouteHandler } from "@hono/zod-openapi";
import { requireBusinessId, requireCapability, requireDriverId } from "../auth/context.js";
import { getDriverOwnView } from "../domain/driver-view.js";
import type { getDriverViewRoute } from "../route-defs/driver-view.js";
import type { Env } from "../types.js";

/** F-6.8/UC-59/W-13. `viewOwnData` (linked driver only) — the entire security boundary is `requireDriverId` resolving the caller's own row; there is no path by which this could read another driver's data. */
export const getDriverViewHandler: RouteHandler<typeof getDriverViewRoute, Env> = async (c) => {
  requireCapability(c, "viewOwnData");

  const businessId = requireBusinessId(c);
  const driverId = requireDriverId(c);
  const { from, to } = c.req.valid("query");

  const view = await getDriverOwnView(c.get("reader"), businessId, driverId, from, to);

  return c.json(
    {
      owedToUsMinor: toWire(view.owedToUsMinor as Minor),
      owedByUsMinor: toWire(view.owedByUsMinor as Minor),
      days: view.days.map((d) => ({
        businessDate: d.businessDate,
        state: d.state,
        earnedMinor: toWire(d.earnedMinor as Minor),
        receivedMinor: toWire(d.receivedMinor as Minor),
        lostReason: d.lostReason,
      })),
      trips: view.trips.map((t) => ({
        id: t.id,
        vehicleId: t.vehicleId,
        closingDate: t.closingDate,
        agreedAmountMinor: toWire(t.agreedAmountMinor as Minor),
        driverFeeMinor: toWire(t.driverFeeMinor as Minor),
      })),
      advances: view.advances.map((a) => ({
        id: a.id,
        amountMinor: toWire(a.amountMinor as Minor),
        issuedOn: a.issuedOn,
        status: a.status,
      })),
      offsets: view.offsets.map((o) => ({
        id: o.id,
        amountMinor: toWire(o.amountMinor as Minor),
        occurredOn: o.occurredOn,
      })),
      deposit: view.deposit
        ? { id: view.deposit.id, heldMinor: toWire(view.deposit.heldMinor as Minor) }
        : null,
    },
    200,
  );
};
