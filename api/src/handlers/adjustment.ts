import { businessToday, toWire, type Minor } from "@fleetsettle/shared";
import type { AdjustmentType } from "@fleetsettle/shared/schemas";
import type { RouteHandler } from "@hono/zod-openapi";
import {
  requireBusinessId,
  requireBusinessTimezone,
  requireCapability,
  requireUserId,
} from "../auth/context.js";
import { applyAdjustment, voidAdjustment } from "../domain/adjustment.js";
import { NotFoundError } from "../errors/app-error.js";
import { listAdjustmentsForObligation, type AdjustmentRow } from "../queries/adjustment.js";
import { findBusinessSettings } from "../queries/business.js";
import { findObligationForBusiness } from "../queries/obligation.js";
import type {
  createAdjustmentRoute,
  listAdjustmentsRoute,
  voidAdjustmentRoute,
} from "../route-defs/adjustment.js";
import type { Env } from "../types.js";
import { assertNotFutureBusinessDate } from "../validation.js";

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

  // M-8, 31 Aug 2026: the client's own occurredOn, when given — a waiver
  // agreed in the past and entered today (U-8: any record can be entered
  // for a past date) must window into the month it was actually given, not
  // the month it was typed in.
  const today = businessToday(requireBusinessTimezone(c));
  if (body.occurredOn !== undefined) {
    assertNotFutureBusinessDate(c, body.occurredOn, "occurredOn");
  }

  const result = await applyAdjustment(c.get("writer"), {
    businessId,
    obligationId: body.obligationId,
    adjustmentType: body.adjustmentType,
    amountMinor: body.amountMinor,
    sign: body.sign,
    ...(body.reason !== undefined ? { reason: body.reason } : {}),
    occurredOn: body.occurredOn ?? today,
    userId,
    ...(body.replacesId !== undefined ? { replacesId: body.replacesId } : {}),
  });

  return c.json(
    {
      id: result.obligation.id,
      amountMinor: toWire(result.obligation.amountMinor as Minor),
      settledMinor: toWire(result.obligation.settledMinor as Minor),
      waivedMinor: toWire(result.obligation.waivedMinor as Minor),
      status: result.obligation.status,
      adjustmentId: result.adjustmentId,
      replacesId: body.replacesId ?? null,
    },
    201,
  );
};

function toListRow(row: AdjustmentRow) {
  return {
    id: row.id,
    obligationId: row.obligationId,
    adjustmentType: row.adjustmentType as AdjustmentType,
    amountMinor: toWire(row.amountMinor as Minor),
    sign: row.sign,
    reason: row.reason,
    occurredOn: row.occurredOn,
    voidedAt: row.voidedAt,
    voidedReason: row.voidedReason,
    replacesId: row.replacesId,
  };
}

/** GAP-147: `dailyOperations` — the same gate `voidAdjustmentHandler` uses for every adjustment type, so a manager can find one to void. */
export const listAdjustmentsHandler: RouteHandler<typeof listAdjustmentsRoute, Env> = async (c) => {
  requireCapability(c, "dailyOperations");
  const businessId = requireBusinessId(c);
  const { obligationId } = c.req.valid("query");

  const obligationRow = await findObligationForBusiness(c.get("reader"), businessId, obligationId);
  if (!obligationRow) throw new NotFoundError("No such obligation in this business");

  const rows = await listAdjustmentsForObligation(c.get("reader"), businessId, obligationId);
  return c.json(rows.map(toListRow), 200);
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
