import { businessToday, toWire, type Minor } from "@fleetsettle/shared";
import type { RouteHandler } from "@hono/zod-openapi";
import {
  requireBusinessId,
  requireBusinessTimezone,
  requireCapability,
  requireUserId,
} from "../auth/context.js";
import { applyAdjustment, voidAdjustment } from "../domain/adjustment.js";
import { findBusinessSettings } from "../queries/business.js";
import type { createAdjustmentRoute, voidAdjustmentRoute } from "../route-defs/adjustment.js";
import type { Env } from "../types.js";

const WAIVER_TYPES = new Set(["waiver", "auto_waiver"]);

/**
 * F-2.4/UC-15/W-17. `dailyOperations` (STAFF) for an ordinary adjustment —
 * a MANUAL waiver above the business's own auto-waive threshold escalates
 * to `writeOffOrWaiveAboveThreshold` (OWNERS), the same blast-radius
 * reasoning as `closePeriod`. OQ-3: a blank threshold means zero, never
 * unbounded — `businessSettings.autoWaiveThresholdMinor` is never null.
 */
export const createAdjustmentHandler: RouteHandler<typeof createAdjustmentRoute, Env> = async (
  c,
) => {
  const businessId = requireBusinessId(c);
  const userId = requireUserId(c);
  const body = c.req.valid("json");

  if (WAIVER_TYPES.has(body.adjustmentType)) {
    const settings = await findBusinessSettings(c.get("reader"), businessId);
    const threshold = settings?.autoWaiveThresholdMinor ?? 0n;
    requireCapability(
      c,
      body.amountMinor > threshold ? "writeOffOrWaiveAboveThreshold" : "dailyOperations",
    );
  } else {
    requireCapability(c, "dailyOperations");
  }

  const today = businessToday(requireBusinessTimezone(c));

  const result = await applyAdjustment(c.get("writer"), {
    businessId,
    obligationId: body.obligationId,
    adjustmentType: body.adjustmentType,
    amountMinor: body.amountMinor,
    sign: body.sign,
    ...(body.reason !== undefined ? { reason: body.reason } : {}),
    occurredOn: today,
    userId,
  });

  return c.json(
    {
      id: result.obligation.id,
      amountMinor: toWire(result.obligation.amountMinor as Minor),
      settledMinor: toWire(result.obligation.settledMinor as Minor),
      waivedMinor: toWire(result.obligation.waivedMinor as Minor),
      status: result.obligation.status,
      adjustmentId: result.adjustmentId,
    },
    201,
  );
};

/** GAP-12/W-61/INV-36 §3.1. `dailyOperations` — the same gate `voidExpense` uses. */
export const voidAdjustmentHandler: RouteHandler<typeof voidAdjustmentRoute, Env> = async (c) => {
  requireCapability(c, "dailyOperations");
  const businessId = requireBusinessId(c);
  const userId = requireUserId(c);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");

  const result = await voidAdjustment(c.get("writer"), {
    businessId,
    adjustmentId: id,
    reason: body.reason,
    userId,
  });

  return c.json(
    {
      id: result.id,
      voidedAt: result.voidedAt,
      obligation: {
        id: result.obligation.id,
        amountMinor: toWire(result.obligation.amountMinor as Minor),
        settledMinor: toWire(result.obligation.settledMinor as Minor),
        waivedMinor: toWire(result.obligation.waivedMinor as Minor),
        status: result.obligation.status,
      },
    },
    200,
  );
};
