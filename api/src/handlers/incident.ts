import { asBusinessDate, businessToday, toWire, type Minor } from "@fleetsettle/shared";
import type { RouteHandler } from "@hono/zod-openapi";
import {
  requireBusinessId,
  requireBusinessTimezone,
  requireCapability,
  requireUserId,
} from "../auth/context.js";
import {
  closeIncident,
  computeIncidentBottomLine,
  openIncident,
  recordCustomerContribution,
  recordOffRoad,
  recordRecoveryReceived,
  settleInsuranceClaim,
  submitInsuranceClaim,
  voidIncidentRecovery,
  type IncidentBottomLine,
} from "../domain/incident.js";
import { NotFoundError } from "../errors/app-error.js";
import { listExpensesForIncident } from "../queries/expense.js";
import {
  findIncidentForBusiness,
  findIncidentRecoveryForBusiness,
  findInsuranceClaimForIncident,
  listIncidentRecoveryHistory,
  type IncidentRecoveryRow,
  type IncidentRow,
  type InsuranceClaimRow,
} from "../queries/incident.js";
import type { Reader } from "../db/client.js";
import { findLeaseForBusiness } from "../queries/lease.js";
import { findVehicleForBusiness } from "../queries/vehicle.js";
import type {
  closeIncidentRoute,
  getIncidentRoute,
  listIncidentExpensesRoute,
  openIncidentRoute,
  recordCustomerContributionRoute,
  recordOffRoadRoute,
  recordRecoveryReceivedRoute,
  settleInsuranceClaimRoute,
  submitInsuranceClaimRoute,
  voidIncidentRecoveryRoute,
} from "../route-defs/incident.js";
import type { Env } from "../types.js";

/** Shared with `handlers/vehicle.ts`'s own Incidents-section list (Web-P8a) — one mapping for `IncidentRow → incidentResponseSchema`, not a second copy that could drift. */
export function incidentToResponse(row: IncidentRow) {
  return {
    id: row.id,
    vehicleId: row.vehicleId,
    leaseId: row.leaseId,
    status: row.status,
    occurredOn: row.occurredOn,
    description: row.description,
    offRoadFrom: row.offRoadFrom,
    offRoadTo: row.offRoadTo,
    rentTreatment: row.rentTreatment,
    closedAt: row.closedAt,
  };
}

function bottomLineToResponse(bottomLine: IncidentBottomLine) {
  return {
    totalRepairCostMinor: toWire(bottomLine.totalRepairCostMinor),
    totalRecoveredMinor: toWire(bottomLine.totalRecoveredMinor),
    pendingRecoveryMinor: toWire(bottomLine.pendingRecoveryMinor),
    netCostMinor: toWire(bottomLine.netCostMinor),
  };
}

async function incidentDetailToResponse(reader: Reader, row: IncidentRow) {
  const [bottomLine, recoveries, claim] = await Promise.all([
    computeIncidentBottomLine(reader, row.id),
    listIncidentRecoveryHistory(reader, row.id),
    findInsuranceClaimForIncident(reader, row.id),
  ]);
  return {
    ...incidentToResponse(row),
    bottomLine: bottomLineToResponse(bottomLine),
    recoveries: recoveries.map(recoveryToResponse),
    insuranceClaim: claim !== undefined ? claimToResponse(claim) : null,
  };
}

type RecoveryResponseRow = Pick<
  IncidentRecoveryRow,
  | "id"
  | "incidentId"
  | "source"
  | "agreedAmountMinor"
  | "receivedAmountMinor"
  | "replacesId"
  | "voidedAt"
  | "voidedReason"
> & {
  /**
   * GAP-173/W-35: carried by the two listing reads, which join for it.
   *
   * The write-path responses below omit it and send `null`. That is not a
   * silent gap: every recovery mutation in the client invalidates
   * `["incident", incidentId]` (`CustomerContributionSheet`,
   * `RecoveryReceivedSheet`, `InsuranceClaimSheet`, `VoidIncidentRecoverySheet`),
   * so the list re-reads and the flag appears from the joined row. Threading
   * the period's start through four write paths would buy one render.
   */
  belongsToPeriodStart?: string | null;
};

function recoveryToResponse(row: RecoveryResponseRow) {
  return {
    id: row.id,
    incidentId: row.incidentId,
    source: row.source,
    agreedAmountMinor: toWire(row.agreedAmountMinor as Minor),
    receivedAmountMinor: toWire(row.receivedAmountMinor as Minor),
    replacesId: row.replacesId,
    belongsToPeriodStart: row.belongsToPeriodStart ?? null,
    voidedAt: row.voidedAt,
    voidedReason: row.voidedReason,
  };
}

type ClaimResponseRow = Pick<
  InsuranceClaimRow,
  | "id"
  | "incidentId"
  | "claimedAmountMinor"
  | "excessBorneMinor"
  | "status"
  | "receivedAmountMinor"
  | "receivedOn"
>;

function claimToResponse(row: ClaimResponseRow) {
  return {
    id: row.id,
    incidentId: row.incidentId,
    claimedAmountMinor: toWire(row.claimedAmountMinor as Minor),
    excessBorneMinor: toWire(row.excessBorneMinor as Minor),
    status: row.status,
    receivedAmountMinor:
      row.receivedAmountMinor !== null ? toWire(row.receivedAmountMinor as Minor) : null,
    receivedOn: row.receivedOn,
  };
}

/** F-3.4 step 1/UC-12. `dailyOperations` (STAFF) — same group as expenses and collections. */
export const openIncidentHandler: RouteHandler<typeof openIncidentRoute, Env> = async (c) => {
  requireCapability(c, "dailyOperations");

  const businessId = requireBusinessId(c);
  const body = c.req.valid("json");
  const reader = c.get("reader");

  const vehicle = await findVehicleForBusiness(reader, businessId, body.vehicleId);
  if (!vehicle) throw new NotFoundError("No such vehicle in this business");
  if (body.leaseId !== undefined) {
    const lease = await findLeaseForBusiness(reader, businessId, body.leaseId);
    if (!lease) throw new NotFoundError("No such lease in this business");
  }

  const { incidentId } = await openIncident(c.get("writer"), {
    businessId,
    vehicleId: body.vehicleId,
    ...(body.leaseId !== undefined ? { leaseId: body.leaseId } : {}),
    occurredOn: asBusinessDate(body.occurredOn),
    ...(body.description !== undefined ? { description: body.description } : {}),
  });

  const row: IncidentRow = {
    id: incidentId,
    vehicleId: body.vehicleId,
    leaseId: body.leaseId ?? null,
    status: "open",
    occurredOn: body.occurredOn,
    description: body.description ?? null,
    offRoadFrom: null,
    offRoadTo: null,
    rentTreatment: null,
    closedAt: null,
  };

  return c.json(await incidentDetailToResponse(reader, row), 201);
};

export const getIncidentHandler: RouteHandler<typeof getIncidentRoute, Env> = async (c) => {
  requireCapability(c, "dailyOperations");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");
  const reader = c.get("reader");

  const row = await findIncidentForBusiness(reader, businessId, id);
  if (!row) throw new NotFoundError();

  return c.json(await incidentDetailToResponse(reader, row), 200);
};

/** Web-P8a's incident screen, step 3 ("Repairs"). `dailyOperations` — matches every other incident endpoint's own gate. */
export const listIncidentExpensesHandler: RouteHandler<
  typeof listIncidentExpensesRoute,
  Env
> = async (c) => {
  requireCapability(c, "dailyOperations");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");
  const reader = c.get("reader");

  const existing = await findIncidentForBusiness(reader, businessId, id);
  if (!existing) throw new NotFoundError();

  const rows = await listExpensesForIncident(reader, id);
  return c.json(
    rows.map((row) => ({
      id: row.id,
      vehicleId: row.vehicleId,
      tripId: row.tripId,
      incidentId: id,
      category: row.category,
      amountMinor: toWire(row.amountMinor as Minor),
      spentOn: row.spentOn,
      borneBy: row.borneBy,
      borneByDriverId: row.borneByDriverId,
      borneByCustomerId: row.borneByCustomerId,
      paidByUserId: row.paidByUserId,
      litres: row.litres,
      note: row.note,
      voidedAt: row.voidedAt,
      voidedReason: row.voidedReason,
    })),
    200,
  );
};

/** F-3.4 step 2/W-9. `recordOffRoad` (domain/incident.ts) is the write; this is validation and translation only. */
export const recordOffRoadHandler: RouteHandler<typeof recordOffRoadRoute, Env> = async (c) => {
  requireCapability(c, "dailyOperations");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const userId = requireUserId(c);

  const result = await recordOffRoad(c.get("writer"), {
    businessId,
    incidentId: id,
    offRoadFrom: asBusinessDate(body.offRoadFrom),
    offRoadTo: asBusinessDate(body.offRoadTo),
    rentTreatment: body.rentTreatment,
    occurredOn: businessToday(requireBusinessTimezone(c)),
    userId,
  });

  return c.json(
    {
      incident: incidentToResponse(result.incident),
      ...(result.leaseExtensionId !== undefined
        ? { leaseExtensionId: result.leaseExtensionId }
        : {}),
      ...(result.adjustmentId !== undefined ? { adjustmentId: result.adjustmentId } : {}),
    },
    200,
  );
};

/** F-3.4 step 4/W-10. `dailyOperations` (STAFF). */
export const recordCustomerContributionHandler: RouteHandler<
  typeof recordCustomerContributionRoute,
  Env
> = async (c) => {
  requireCapability(c, "dailyOperations");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");

  const existing = await findIncidentForBusiness(c.get("reader"), businessId, id);
  if (!existing) throw new NotFoundError();

  const { recoveryId } = await recordCustomerContribution(c.get("writer"), {
    businessId,
    incidentId: id,
    agreedAmountMinor: body.agreedAmountMinor,
    agreedOn: asBusinessDate(body.agreedOn),
    ...(body.note !== undefined ? { note: body.note } : {}),
    ...(body.replacesId !== undefined ? { replacesId: body.replacesId } : {}),
  });

  return c.json(
    recoveryToResponse({
      id: recoveryId,
      incidentId: id,
      source: "customer",
      agreedAmountMinor: body.agreedAmountMinor,
      receivedAmountMinor: 0n,
      replacesId: body.replacesId ?? null,
      voidedAt: null,
      voidedReason: null,
    }),
    201,
  );
};

/** F-3.4 steps 4/5. `dailyOperations` (STAFF). */
export const recordRecoveryReceivedHandler: RouteHandler<
  typeof recordRecoveryReceivedRoute,
  Env
> = async (c) => {
  requireCapability(c, "dailyOperations");

  const businessId = requireBusinessId(c);
  const { recoveryId } = c.req.valid("param");
  const body = c.req.valid("json");

  const existing = await findIncidentRecoveryForBusiness(c.get("reader"), businessId, recoveryId);
  if (!existing || existing.voidedAt !== null) throw new NotFoundError();

  const { recovery } = await recordRecoveryReceived(c.get("writer"), {
    businessId,
    recoveryId,
    receivedAmountMinor: body.receivedAmountMinor,
    receivedOn: asBusinessDate(body.receivedOn),
    userId: requireUserId(c),
  });

  return c.json(recoveryToResponse(recovery), 200);
};

/** F-3.4 step 5/W-11. `dailyOperations` (STAFF) — the section stays hidden client-side unless enabled; the endpoint itself is not further gated. */
export const submitInsuranceClaimHandler: RouteHandler<
  typeof submitInsuranceClaimRoute,
  Env
> = async (c) => {
  requireCapability(c, "dailyOperations");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");

  const existing = await findIncidentForBusiness(c.get("reader"), businessId, id);
  if (!existing) throw new NotFoundError();

  const excessBorneMinor = body.excessBorneMinor ?? (0n as Minor);

  const { claimId } = await submitInsuranceClaim(c.get("writer"), {
    businessId,
    incidentId: id,
    claimedAmountMinor: body.claimedAmountMinor,
    excessBorneMinor,
    claimedOn: asBusinessDate(body.claimedOn),
    ...(body.replacesId !== undefined ? { replacesId: body.replacesId } : {}),
  });

  return c.json(
    claimToResponse({
      id: claimId,
      incidentId: id,
      claimedAmountMinor: body.claimedAmountMinor,
      excessBorneMinor,
      status: "submitted",
      receivedAmountMinor: 0n,
      receivedOn: null,
    }),
    201,
  );
};

/** F-3.4 step 5, later. `dailyOperations` (STAFF). */
export const settleInsuranceClaimHandler: RouteHandler<
  typeof settleInsuranceClaimRoute,
  Env
> = async (c) => {
  requireCapability(c, "dailyOperations");

  const businessId = requireBusinessId(c);
  const { claimId } = c.req.valid("param");
  const body = c.req.valid("json");

  const result = await settleInsuranceClaim(c.get("writer"), {
    businessId,
    claimId,
    receivedAmountMinor: body.receivedAmountMinor,
    receivedOn: asBusinessDate(body.receivedOn),
    ...(body.status !== undefined ? { status: body.status } : {}),
  });

  return c.json(
    {
      claim: claimToResponse(result.claim),
      ...(result.recovery !== undefined ? { recovery: recoveryToResponse(result.recovery) } : {}),
    },
    200,
  );
};

/** F-3.4: closed manually. `dailyOperations` (STAFF). */
export const closeIncidentHandler: RouteHandler<typeof closeIncidentRoute, Env> = async (c) => {
  requireCapability(c, "dailyOperations");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");
  const reader = c.get("reader");
  const today = businessToday(requireBusinessTimezone(c));

  const row = await closeIncident(c.get("writer"), businessId, id, today);

  return c.json(await incidentDetailToResponse(reader, row), 200);
};

/** GAP-12/W-61/INV-36 §3.9. `dailyOperations` — the same gate recording one uses. */
export const voidIncidentRecoveryHandler: RouteHandler<
  typeof voidIncidentRecoveryRoute,
  Env
> = async (c) => {
  requireCapability(c, "dailyOperations");

  const businessId = requireBusinessId(c);
  const { recoveryId } = c.req.valid("param");
  const body = c.req.valid("json");

  const result = await voidIncidentRecovery(c.get("writer"), {
    businessId,
    recoveryId,
    reason: body.reason,
    userId: requireUserId(c),
  });

  return c.json(result, 200);
};
