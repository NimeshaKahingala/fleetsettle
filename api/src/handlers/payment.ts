import { toWire, type Minor } from "@fleetsettle/shared";
import type { RouteHandler } from "@hono/zod-openapi";
import { requireBusinessId, requireCapability, requireUserId } from "../auth/context.js";
import { recordPayment } from "../domain/payment.js";
import { correctPayment } from "../domain/payment-correction.js";
import { NotFoundError } from "../errors/app-error.js";
import { findCustomerForBusiness } from "../queries/customer.js";
import { findDriverForBusiness } from "../queries/driver.js";
import type { correctPaymentRoute, recordPaymentRoute } from "../route-defs/payment.js";
import type { Env } from "../types.js";

/**
 * F-2.2/UC-11. `dailyOperations` — grouped with expenses/collections/advances.
 * A partner's identity is not re-checked here (no partner-directory lookup
 * yet, P7's territory) — customer and driver are, matching the party types
 * this phase actually exercises.
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
  }

  const result = await recordPayment(c.get("writer"), {
    businessId,
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
