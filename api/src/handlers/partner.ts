import { businessToday, toWire, type Minor } from "@fleetsettle/shared";
import type { RouteHandler } from "@hono/zod-openapi";
import {
  requireBusinessId,
  requireBusinessTimezone,
  requireCapability,
  requireUserId,
} from "../auth/context.js";
import {
  grantManagement,
  recordBankingEvent,
  recordCapitalContribution,
  recordPartnerPayout,
  revokeManagement,
  setOwnershipShares,
} from "../domain/partner.js";
import { NotFoundError } from "../errors/app-error.js";
import {
  findBusinessMemberUserId,
  findManagementFeeAgreementForBusiness,
  type BankingEventRow,
  type CapitalContributionRow,
  type ManagementFeeAgreementRow,
  type OwnershipShareRow,
  type PartnerPayoutRow,
} from "../queries/partner.js";
import { findVehicleForBusiness } from "../queries/vehicle.js";
import type {
  grantManagementRoute,
  recordBankingEventRoute,
  recordCapitalContributionRoute,
  recordPartnerPayoutRoute,
  revokeManagementRoute,
  setOwnershipSharesRoute,
} from "../route-defs/partner.js";
import type { Env } from "../types.js";

function shareToResponse(row: OwnershipShareRow) {
  return {
    id: row.id,
    vehicleId: row.vehicleId,
    userId: row.userId,
    shareBp: row.shareBp,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
  };
}

/** F-1.3/UC-02. `managePartnerCapital` (OWNERS) — see auth/policy.ts on why this is a flat check for now, not yet scoped per vehicle. */
export const setOwnershipSharesHandler: RouteHandler<typeof setOwnershipSharesRoute, Env> = async (
  c,
) => {
  requireCapability(c, "managePartnerCapital");

  const businessId = requireBusinessId(c);
  const body = c.req.valid("json");
  const reader = c.get("reader");

  const vehicle = await findVehicleForBusiness(reader, businessId, body.vehicleId);
  if (!vehicle) throw new NotFoundError("No such vehicle in this business");
  for (const share of body.shares) {
    const member = await findBusinessMemberUserId(reader, businessId, share.userId);
    if (!member) throw new NotFoundError("No such partner in this business");
  }

  const rows = await setOwnershipShares(c.get("writer"), {
    vehicleId: body.vehicleId,
    effectiveFrom: body.effectiveFrom,
    shares: body.shares,
  });

  return c.json(rows.map(shareToResponse), 201);
};

function contributionToResponse(row: CapitalContributionRow) {
  return {
    id: row.id,
    vehicleId: row.vehicleId,
    userId: row.userId,
    amountMinor: toWire(row.amountMinor as Minor),
    contributedOn: row.contributedOn,
    note: row.note,
  };
}

/** F-1.3/UC-02/W-52. `managePartnerCapital` (OWNERS). */
export const recordCapitalContributionHandler: RouteHandler<
  typeof recordCapitalContributionRoute,
  Env
> = async (c) => {
  requireCapability(c, "managePartnerCapital");

  const businessId = requireBusinessId(c);
  const body = c.req.valid("json");
  const reader = c.get("reader");

  if (body.vehicleId !== undefined) {
    const vehicle = await findVehicleForBusiness(reader, businessId, body.vehicleId);
    if (!vehicle) throw new NotFoundError("No such vehicle in this business");
  }
  const member = await findBusinessMemberUserId(reader, businessId, body.userId);
  if (!member) throw new NotFoundError("No such partner in this business");

  const { contributionId } = await recordCapitalContribution(c.get("writer"), {
    businessId,
    ...(body.vehicleId !== undefined ? { vehicleId: body.vehicleId } : {}),
    userId: body.userId,
    amountMinor: body.amountMinor,
    contributedOn: body.contributedOn,
    ...(body.note !== undefined ? { note: body.note } : {}),
  });

  return c.json(
    contributionToResponse({
      id: contributionId,
      businessId,
      vehicleId: body.vehicleId ?? null,
      userId: body.userId,
      amountMinor: body.amountMinor,
      contributedOn: body.contributedOn,
      note: body.note ?? null,
    }),
    201,
  );
};

function managementToResponse(row: ManagementFeeAgreementRow) {
  return {
    id: row.id,
    vehicleId: row.vehicleId,
    managerUserId: row.managerUserId,
    monthlyFeeMinor: toWire(row.monthlyAmountMinor as Minor),
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
  };
}

/** F-1.4/UC-03/W-53. `managePartnerCapital` (OWNERS). */
export const grantManagementHandler: RouteHandler<typeof grantManagementRoute, Env> = async (c) => {
  requireCapability(c, "managePartnerCapital");

  const businessId = requireBusinessId(c);
  const body = c.req.valid("json");
  const reader = c.get("reader");

  const vehicle = await findVehicleForBusiness(reader, businessId, body.vehicleId);
  if (!vehicle) throw new NotFoundError("No such vehicle in this business");
  const manager = await findBusinessMemberUserId(reader, businessId, body.managerUserId);
  if (!manager) throw new NotFoundError("No such manager in this business");

  const { agreementId } = await grantManagement(c.get("writer"), {
    vehicleId: body.vehicleId,
    managerUserId: body.managerUserId,
    ...(body.monthlyFeeMinor !== undefined ? { monthlyFeeMinor: body.monthlyFeeMinor } : {}),
    effectiveFrom: body.effectiveFrom,
  });

  return c.json(
    managementToResponse({
      id: agreementId,
      vehicleId: body.vehicleId,
      managerUserId: body.managerUserId,
      monthlyAmountMinor: body.monthlyFeeMinor ?? 0n,
      effectiveFrom: body.effectiveFrom,
      effectiveTo: null,
    }),
    201,
  );
};

/** F-1.4. `managePartnerCapital` (OWNERS). */
export const revokeManagementHandler: RouteHandler<typeof revokeManagementRoute, Env> = async (
  c,
) => {
  requireCapability(c, "managePartnerCapital");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");
  const today = businessToday(requireBusinessTimezone(c));

  const existing = await findManagementFeeAgreementForBusiness(c.get("reader"), businessId, id);
  if (!existing) throw new NotFoundError();

  await revokeManagement(c.get("writer"), id, today);

  return c.json(managementToResponse({ ...existing, effectiveTo: today }), 200);
};

function bankingEventToResponse(row: BankingEventRow) {
  return {
    id: row.id,
    fromUserId: row.fromUserId,
    amountRecordedMinor: toWire(row.amountRecordedMinor as Minor),
    amountCountedMinor: toWire(row.amountCountedMinor as Minor),
    bankedOn: row.bankedOn,
    destination: row.destination,
    reference: row.reference,
    discrepancyMinor: toWire(row.discrepancyMinor as Minor),
    // Never selectable through this endpoint (see the schema's own doc
    // comment) — narrowed here only because the DB column's CHECK also
    // allows 'attributed_to_receipt'.
    discrepancyBearer:
      row.discrepancyBearer === "attributed_to_receipt" ? null : row.discrepancyBearer,
  };
}

/** F-7.4/UC-65/INV-23. `dailyOperations` (STAFF) — actor is "Manager or partner," the same group as expenses/collections. */
export const recordBankingEventHandler: RouteHandler<typeof recordBankingEventRoute, Env> = async (
  c,
) => {
  requireCapability(c, "dailyOperations");

  const businessId = requireBusinessId(c);
  const userId = requireUserId(c);
  const body = c.req.valid("json");
  const reader = c.get("reader");

  const member = await findBusinessMemberUserId(reader, businessId, userId);
  if (!member) throw new NotFoundError("No such partner in this business");

  const { bankingEventId, discrepancyMinor } = await recordBankingEvent(c.get("writer"), {
    businessId,
    fromUserId: userId,
    amountRecordedMinor: body.amountRecordedMinor,
    amountCountedMinor: body.amountCountedMinor,
    bankedOn: body.bankedOn,
    destination: body.destination,
    ...(body.reference !== undefined ? { reference: body.reference } : {}),
    ...(body.discrepancyBearer !== undefined ? { discrepancyBearer: body.discrepancyBearer } : {}),
    createdBy: userId,
  });

  return c.json(
    bankingEventToResponse({
      id: bankingEventId,
      businessId,
      fromUserId: userId,
      amountRecordedMinor: body.amountRecordedMinor,
      amountCountedMinor: body.amountCountedMinor,
      bankedOn: body.bankedOn,
      destination: body.destination,
      reference: body.reference ?? null,
      discrepancyMinor,
      discrepancyBearer: body.discrepancyBearer ?? null,
    }),
    201,
  );
};

function payoutToResponse(row: PartnerPayoutRow) {
  return {
    id: row.id,
    userId: row.userId,
    amountMinor: toWire(row.amountMinor as Minor),
    kind: row.kind,
    occurredOn: row.occurredOn,
  };
}

/** F-7.2/UC-63. `managePartnerCapital` (OWNERS) — a payout is never a cost of the vehicle. */
export const recordPartnerPayoutHandler: RouteHandler<
  typeof recordPartnerPayoutRoute,
  Env
> = async (c) => {
  requireCapability(c, "managePartnerCapital");

  const businessId = requireBusinessId(c);
  const body = c.req.valid("json");
  const reader = c.get("reader");

  const member = await findBusinessMemberUserId(reader, businessId, body.userId);
  if (!member) throw new NotFoundError("No such partner in this business");

  const { payoutId } = await recordPartnerPayout(c.get("writer"), {
    businessId,
    userId: body.userId,
    amountMinor: body.amountMinor,
    kind: body.kind,
    occurredOn: body.occurredOn,
  });

  return c.json(
    payoutToResponse({
      id: payoutId,
      businessId,
      userId: body.userId,
      amountMinor: body.amountMinor,
      kind: body.kind,
      occurredOn: body.occurredOn,
    }),
    201,
  );
};
