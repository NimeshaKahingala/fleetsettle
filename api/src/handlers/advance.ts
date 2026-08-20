import { asBusinessDate, toWire, type Minor } from "@fleetsettle/shared";
import type { RouteHandler } from "@hono/zod-openapi";
import { requireBusinessId, requireCapability, requireUserId } from "../auth/context.js";
import {
  issueAdvance,
  settleAdvance,
  voidAdvance,
  voidAdvanceSettlement,
} from "../domain/advance.js";
import { NotFoundError } from "../errors/app-error.js";
import { findDriverForBusiness } from "../queries/driver.js";
import {
  findAdvanceForBusiness,
  listAdvanceSettlementsForAdvance,
  type AdvanceRow,
  type AdvanceSettlementRow,
} from "../queries/driver-money.js";
import type {
  issueAdvanceRoute,
  listAdvanceSettlementsRoute,
  settleAdvanceRoute,
  voidAdvanceRoute,
  voidAdvanceSettlementRoute,
} from "../route-defs/advance.js";
import type { Env } from "../types.js";

function toResponse(row: AdvanceRow, settledMinor: bigint) {
  return {
    id: row.id,
    driverId: row.driverId,
    tripId: row.tripId,
    amountMinor: toWire(row.amountMinor as Minor),
    issuedOn: row.issuedOn,
    status: row.status,
    settledMinor: toWire(settledMinor as Minor),
    replacesId: row.replacesId,
  };
}

/** F-6.3/UC-53. `dailyOperations` (STAFF) — grouped with expenses/collections in the same capability. */
export const issueAdvanceHandler: RouteHandler<typeof issueAdvanceRoute, Env> = async (c) => {
  requireCapability(c, "dailyOperations");
  const businessId = requireBusinessId(c);
  const userId = requireUserId(c);
  const body = c.req.valid("json");
  const reader = c.get("reader");

  const driver = await findDriverForBusiness(reader, businessId, body.driverId);
  if (!driver) throw new NotFoundError("No such driver in this business");

  const { advanceId } = await issueAdvance(c.get("writer"), {
    businessId,
    driverId: body.driverId,
    ...(body.tripId !== undefined ? { tripId: body.tripId } : {}),
    amountMinor: body.amountMinor,
    issuedOn: asBusinessDate(body.issuedOn),
    issuedByUserId: userId,
    ...(body.replacesId !== undefined ? { replacesId: body.replacesId } : {}),
  });

  return c.json(
    toResponse(
      {
        id: advanceId,
        businessId,
        driverId: body.driverId,
        tripId: body.tripId ?? null,
        amountMinor: body.amountMinor,
        issuedOn: body.issuedOn,
        status: "open",
        voidedAt: null,
        replacesId: body.replacesId ?? null,
      },
      0n,
    ),
    201,
  );
};

export const settleAdvanceHandler: RouteHandler<typeof settleAdvanceRoute, Env> = async (c) => {
  requireCapability(c, "dailyOperations");
  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");

  const result = await settleAdvance(c.get("writer"), {
    businessId,
    advanceId: id,
    kind: body.kind,
    amountMinor: body.amountMinor,
    occurredOn: asBusinessDate(body.occurredOn),
    ...(body.replacesId !== undefined ? { replacesId: body.replacesId } : {}),
  });

  return c.json(
    {
      ...toResponse(result.advance, result.settledMinor),
      settlementId: result.settlementId,
      settlementReplacesId: body.replacesId ?? null,
    },
    200,
  );
};

function toSettlementListRow(row: AdvanceSettlementRow) {
  return {
    id: row.id,
    advanceId: row.advanceId,
    kind: row.kind,
    amountMinor: toWire(row.amountMinor as Minor),
    occurredOn: row.occurredOn,
    voidedAt: row.voidedAt,
    voidedReason: row.voidedReason,
    replacesId: row.replacesId,
  };
}

/** GAP-147: `dailyOperations` — the same gate settling one uses, so a manager can find one to void. */
export const listAdvanceSettlementsHandler: RouteHandler<
  typeof listAdvanceSettlementsRoute,
  Env
> = async (c) => {
  requireCapability(c, "dailyOperations");
  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");

  const advanceRow = await findAdvanceForBusiness(c.get("reader"), businessId, id);
  if (!advanceRow) throw new NotFoundError("No such advance in this business");

  const rows = await listAdvanceSettlementsForAdvance(c.get("reader"), businessId, id);
  return c.json(rows.map(toSettlementListRow), 200);
};

/** GAP-12/W-61/INV-36 §3.5. `dailyOperations` — the same gate settling one uses. */
export const voidAdvanceSettlementHandler: RouteHandler<
  typeof voidAdvanceSettlementRoute,
  Env
> = async (c) => {
  requireCapability(c, "dailyOperations");
  const businessId = requireBusinessId(c);
  const userId = requireUserId(c);
  const { settlementId } = c.req.valid("param");
  const body = c.req.valid("json");

  const result = await voidAdvanceSettlement(c.get("writer"), {
    businessId,
    settlementId,
    reason: body.reason,
    userId,
  });

  return c.json(
    {
      id: result.id,
      voidedAt: result.voidedAt,
      advance: toResponse(result.advance, result.settledMinor),
    },
    200,
  );
};

/** GAP-12/W-61/INV-36 §3.6. `dailyOperations` — the same gate issuing one uses. */
export const voidAdvanceHandler: RouteHandler<typeof voidAdvanceRoute, Env> = async (c) => {
  requireCapability(c, "dailyOperations");
  const businessId = requireBusinessId(c);
  const userId = requireUserId(c);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");

  const result = await voidAdvance(c.get("writer"), {
    businessId,
    advanceId: id,
    reason: body.reason,
    userId,
  });

  return c.json(result, 200);
};
