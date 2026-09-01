import { toWire, type Minor } from "@fleetsettle/shared";
import type { RouteHandler } from "@hono/zod-openapi";
import { requireBusinessId, requireCapability, requireUserId } from "../auth/context.js";
import { recordPayment } from "../domain/payment.js";
import { correctPayment } from "../domain/payment-correction.js";
import { NotFoundError } from "../errors/app-error.js";
import { findCustomerForBusiness } from "../queries/customer.js";
import { findDriverForBusiness } from "../queries/driver.js";
import { findBusinessMemberUserId } from "../queries/partner.js";
import {
  listPaymentsForBusiness,
  type PaymentListFilters,
  type PaymentListRow,
} from "../queries/payment.js";
import type {
  correctPaymentRoute,
  listPaymentsRoute,
  recordPaymentRoute,
} from "../route-defs/payment.js";
import type { Env } from "../types.js";
import { assertNotFutureBusinessDate } from "../validation.js";

export function toListRow(row: PaymentListRow) {
  return {
    id: row.id,
    direction: row.direction,
    partyType: row.partyType,
    partyCustomerId: row.partyCustomerId,
    partyDriverId: row.partyDriverId,
    partyUserId: row.partyUserId,
    amountMinor: toWire(row.amountMinor as Minor),
    occurredOn: row.occurredOn,
    method: row.method,
    reference: row.reference,
    status: row.status,
  };
}

/** A3/GAP-38. `dailyOperations` — the same capability as recording one; `reverseReceipt` (owners only) still gates the actual correction below. */
export const listPaymentsHandler: RouteHandler<typeof listPaymentsRoute, Env> = async (c) => {
  requireCapability(c, "dailyOperations");
  const businessId = requireBusinessId(c);
  const query = c.req.valid("query");

  const filters: PaymentListFilters = {
    ...(query.partyType !== undefined ? { partyType: query.partyType } : {}),
    ...(query.partyCustomerId !== undefined ? { partyCustomerId: query.partyCustomerId } : {}),
    ...(query.partyDriverId !== undefined ? { partyDriverId: query.partyDriverId } : {}),
    ...(query.direction !== undefined ? { direction: query.direction } : {}),
    ...(query.from !== undefined ? { from: query.from } : {}),
    ...(query.to !== undefined ? { to: query.to } : {}),
  };

  const rows = await listPaymentsForBusiness(c.get("reader"), businessId, filters);
  return c.json(rows.map(toListRow), 200);
};

/**
 * F-2.2/UC-11. `dailyOperations` — grouped with expenses/collections/advances.
 * GAP-93: every party type is now checked against this business — `partner`
 * used to skip it, the one place a request-body id was trusted outright.
 */
export const recordPaymentHandler: RouteHandler<typeof recordPaymentRoute, Env> = async (c) => {
  requireCapability(c, "dailyOperations");
  const businessId = requireBusinessId(c);
  const userId = requireUserId(c);
  const body = c.req.valid("json");
  const reader = c.get("reader");

  if (body.partyType === "customer") {
    const customer = await findCustomerForBusiness(reader, businessId, body.partyId);
    if (!customer) throw new NotFoundError("No such customer in this business");
  } else if (body.partyType === "driver") {
    const driver = await findDriverForBusiness(reader, businessId, body.partyId);
    if (!driver) throw new NotFoundError("No such driver in this business");
  } else if (body.partyType === "partner") {
    const member = await findBusinessMemberUserId(reader, businessId, body.partyId);
    if (!member) throw new NotFoundError("No such active member in this business");
  }

  assertNotFutureBusinessDate(c, body.occurredOn, "occurredOn");

  const result = await recordPayment(c.get("writer"), {
    businessId,
    direction: body.direction,
    partyType: body.partyType,
    partyId: body.partyId,
    amountMinor: body.amountMinor,
    occurredOn: body.occurredOn,
    userId,
  });

  return c.json(
    {
      id: result.paymentId,
      amountMinor: toWire(body.amountMinor),
      occurredOn: body.occurredOn,
      allocations: result.allocations.map((a) => ({
        obligationId: a.obligationId,
        amountMinor: toWire(a.amountMinor),
      })),
      unallocatedMinor: toWire(result.unallocatedMinor),
    },
    201,
  );
};

/** F-8.2/UC-93. `reverseReceipt` — owner/owner-manager only, the same capability row as closing a period. */
export const correctPaymentHandler: RouteHandler<typeof correctPaymentRoute, Env> = async (c) => {
  requireCapability(c, "reverseReceipt");
  const businessId = requireBusinessId(c);
  const userId = requireUserId(c);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");

  assertNotFutureBusinessDate(c, body.correctedOn, "correctedOn");

  const result = await correctPayment(c.get("writer"), {
    businessId,
    paymentId: id,
    differenceMinor: body.differenceMinor,
    bearer: body.bearer,
    reason: body.reason,
    correctedOn: body.correctedOn,
    userId,
  });

  return c.json(
    {
      correctionId: result.correctionId,
      paymentId: result.paymentId,
      differenceMinor: toWire(result.differenceMinor),
      bearer: result.bearer,
      payment: {
        id: result.payment.id,
        amountMinor: toWire(result.payment.amountMinor as Minor),
        status: result.payment.status,
      },
    },
    200,
  );
};
