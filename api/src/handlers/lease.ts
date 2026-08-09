import { toWire, type Minor } from "@fleetsettle/shared";
import type { RouteHandler } from "@hono/zod-openapi";
import { requireBusinessId, requireCapability, requireUserId } from "../auth/context.js";
import { generateNextBillingPeriod } from "../domain/billing-period.js";
import {
  closeLease,
  closeOutLease,
  getLeaseClosureSummary,
  settleLeaseDeposit,
} from "../domain/lease-closure.js";
import { renewLease, startLease } from "../domain/lease.js";
import { NotFoundError, VehicleArrangementMismatchError } from "../errors/app-error.js";
import { findBillingPeriodsForLease, type BillingPeriodRow } from "../queries/billing-period.js";
import { findCustomerForBusiness } from "../queries/customer.js";
import { findDepositForLease, sumDepositMovements } from "../queries/driver-money.js";
import { findLeaseForBusiness, type LeaseRow } from "../queries/lease.js";
import { findObligationsForLease } from "../queries/obligation.js";
import { findVehicleForBusiness } from "../queries/vehicle.js";
import type {
  closeLeaseRoute,
  closeOutLeaseRoute,
  generateBillingPeriodRoute,
  getLeaseClosureSummaryRoute,
  getLeaseDepositRoute,
  getLeaseRoute,
  listBillingPeriodsRoute,
  listLeaseObligationsRoute,
  renewLeaseRoute,
  settleLeaseDepositRoute,
  startLeaseRoute,
} from "../route-defs/lease.js";
import type { Env } from "../types.js";

function toResponse(row: LeaseRow) {
  return {
    id: row.id,
    vehicleId: row.vehicleId,
    customerId: row.customerId,
    status: row.status,
    startDate: row.startDate,
    endDate: row.endDate,
    billingDay: row.billingDay,
    rentAmountMinor: toWire(row.rentAmountMinor as Minor),
    mileageDailyLimitKm: row.mileageDailyLimitKm,
    mileageExcessRateMinor:
      row.mileageExcessRateMinor !== null ? toWire(row.mileageExcessRateMinor as Minor) : null,
    reminderDaysBefore: row.reminderDaysBefore,
  };
}

function billingPeriodToResponse(row: BillingPeriodRow) {
  return {
    id: row.id,
    leaseId: row.leaseId,
    seq: row.seq,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    daysCount: row.daysCount,
    rentAmountMinor: toWire(row.rentAmountMinor as Minor),
    allowanceKm: row.allowanceKm,
  };
}

/**
 * F-2.1 / UC-10. `leaseAndTripLifecycle` (STAFF) — the same capability that
 * gates closing one. One transaction: the lease, its handover odometer
 * reading (when a mileage limit is set), and the first billing period —
 * `startLease` (domain/lease.ts) is the write; this is only validation and
 * translation to the wire shape.
 */
export const startLeaseHandler: RouteHandler<typeof startLeaseRoute, Env> = async (c) => {
  requireCapability(c, "leaseAndTripLifecycle");
  const userId = requireUserId(c);

  const businessId = requireBusinessId(c);
  const body = c.req.valid("json");
  const reader = c.get("reader");

  const vehicle = await findVehicleForBusiness(reader, businessId, body.vehicleId);
  if (!vehicle) throw new NotFoundError("No such vehicle in this business");
  // GAP-84/F1: a lease is arrangement A. `null` (no current arrangement row,
  // the "impossible case" `createVehicle`'s own comment names) is refused
  // the same as a mismatched B/C — F-1.2 is what would ever leave a vehicle
  // with none, and F-1.2 does not exist yet.
  if (vehicle.arrangement !== "A") {
    throw new VehicleArrangementMismatchError(
      vehicle.arrangement === null
        ? "This vehicle has no current arrangement"
        : `This vehicle is configured for arrangement ${vehicle.arrangement}, not a monthly rental`,
    );
  }
  const customer = await findCustomerForBusiness(reader, businessId, body.customerId);
  if (!customer) throw new NotFoundError("No such customer in this business");

  const { lease, depositId } = await startLease(c.get("writer"), {
    businessId,
    vehicleId: body.vehicleId,
    customerId: body.customerId,
    startDate: body.startDate,
    ...(body.endDate !== undefined ? { endDate: body.endDate } : {}),
    billingDay: body.billingDay,
    rentAmountMinor: body.rentAmountMinor,
    ...(body.mileageDailyLimitKm !== undefined
      ? { mileageDailyLimitKm: body.mileageDailyLimitKm }
      : {}),
    ...(body.mileageExcessRateMinor !== undefined
      ? { mileageExcessRateMinor: body.mileageExcessRateMinor }
      : {}),
    ...(body.reminderDaysBefore !== undefined
      ? { reminderDaysBefore: body.reminderDaysBefore }
      : {}),
    ...(body.odometerReadingKm !== undefined ? { odometerReadingKm: body.odometerReadingKm } : {}),
    ...(body.odometerSource !== undefined ? { odometerSource: body.odometerSource } : {}),
    ...(body.depositAmountMinor !== undefined
      ? { depositAmountMinor: body.depositAmountMinor }
      : {}),
    userId,
  });

  return c.json({ ...toResponse(lease), depositId }, 201);
};

export const getLeaseHandler: RouteHandler<typeof getLeaseRoute, Env> = async (c) => {
  requireCapability(c, "leaseAndTripLifecycle");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");

  const row = await findLeaseForBusiness(c.get("reader"), businessId, id);
  if (!row) throw new NotFoundError();

  return c.json(toResponse(row), 200);
};

/** F-2.5 / UC-17. Old periods keep their old figure (domain/lease.ts) — this only changes what the next generated period picks up. */
export const renewLeaseHandler: RouteHandler<typeof renewLeaseRoute, Env> = async (c) => {
  requireCapability(c, "leaseAndTripLifecycle");
  requireUserId(c);

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");

  const existing = await findLeaseForBusiness(c.get("reader"), businessId, id);
  if (!existing) throw new NotFoundError();

  await renewLease(c.get("writer"), {
    businessId,
    leaseId: id,
    rentAmountMinor: body.rentAmountMinor,
    ...(body.mileageDailyLimitKm !== undefined
      ? { mileageDailyLimitKm: body.mileageDailyLimitKm }
      : {}),
    ...(body.mileageExcessRateMinor !== undefined
      ? { mileageExcessRateMinor: body.mileageExcessRateMinor }
      : {}),
  });

  return c.json(
    toResponse({
      ...existing,
      rentAmountMinor: body.rentAmountMinor,
      mileageDailyLimitKm: body.mileageDailyLimitKm ?? existing.mileageDailyLimitKm,
      mileageExcessRateMinor: body.mileageExcessRateMinor ?? existing.mileageExcessRateMinor,
    }),
    200,
  );
};

/** F-2.1's invisible step, made callable — idempotent on `(lease_id, seq)` (domain/billing-period.ts); P13's cron will call the same function on a schedule. */
export const generateBillingPeriodHandler: RouteHandler<
  typeof generateBillingPeriodRoute,
  Env
> = async (c) => {
  requireCapability(c, "dailyOperations");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");

  const existing = await findLeaseForBusiness(c.get("reader"), businessId, id);
  if (!existing) throw new NotFoundError();

  const { billingPeriod, created } = await generateNextBillingPeriod(c.get("writer"), {
    businessId,
    leaseId: id,
  });

  return c.json(billingPeriodToResponse(billingPeriod), created ? 201 : 200);
};

export const listBillingPeriodsHandler: RouteHandler<typeof listBillingPeriodsRoute, Env> = async (
  c,
) => {
  requireCapability(c, "dailyOperations");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");

  const existing = await findLeaseForBusiness(c.get("reader"), businessId, id);
  if (!existing) throw new NotFoundError();

  const rows = await findBillingPeriodsForLease(c.get("reader"), id);
  return c.json(
    rows.map((row) => billingPeriodToResponse(row)),
    200,
  );
};

/** Web-P6b's lease hub. `dailyOperations` — the same capability its own writes (`recordPayment`, `createAdjustment`) already need. */
export const listLeaseObligationsHandler: RouteHandler<
  typeof listLeaseObligationsRoute,
  Env
> = async (c) => {
  requireCapability(c, "dailyOperations");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");

  const existing = await findLeaseForBusiness(c.get("reader"), businessId, id);
  if (!existing) throw new NotFoundError();

  const rows = await findObligationsForLease(c.get("reader"), businessId, id);
  return c.json(
    rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      dueOn: row.dueOn,
      amountMinor: toWire(row.amountMinor as Minor),
      settledMinor: toWire(row.settledMinor as Minor),
      waivedMinor: toWire(row.waivedMinor as Minor),
      status: row.status as "pending" | "part_paid" | "paid" | "waived" | "written_off",
    })),
    200,
  );
};

/** F-2.6/UC-16 steps 1–3. `leaseAndTripLifecycle` — the same capability that gates starting one. */
export const closeLeaseHandler: RouteHandler<typeof closeLeaseRoute, Env> = async (c) => {
  requireCapability(c, "leaseAndTripLifecycle");
  const userId = requireUserId(c);

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");

  const existing = await findLeaseForBusiness(c.get("reader"), businessId, id);
  if (!existing) throw new NotFoundError();

  const { finalPeriod } = await closeLease(c.get("writer"), {
    businessId,
    leaseId: id,
    closingDate: body.closingDate,
    finalPeriodMode: body.finalPeriodMode,
    ...(body.agreedAmountMinor !== undefined ? { agreedAmountMinor: body.agreedAmountMinor } : {}),
    ...(body.note !== undefined ? { note: body.note } : {}),
    ...(body.closingOdometerKm !== undefined ? { closingOdometerKm: body.closingOdometerKm } : {}),
    ...(body.odometerSource !== undefined ? { odometerSource: body.odometerSource } : {}),
    userId,
  });

  return c.json(
    {
      finalPeriod: {
        billingPeriodId: finalPeriod.billingPeriodId,
        obligationId: finalPeriod.obligationId,
        periodEnd: finalPeriod.periodEnd,
        daysCount: finalPeriod.daysCount,
        allowanceKm: finalPeriod.allowanceKm,
        amountMinor: toWire(finalPeriod.amountMinor),
      },
    },
    200,
  );
};

/** F-2.6 step 4/INV-18. Same read-only gate as `getLeaseHandler`. */
export const getLeaseClosureSummaryHandler: RouteHandler<
  typeof getLeaseClosureSummaryRoute,
  Env
> = async (c) => {
  requireCapability(c, "leaseAndTripLifecycle");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");

  const summary = await getLeaseClosureSummary(c.get("reader"), businessId, id);

  return c.json(
    {
      unpaidObligations: summary.unpaidObligations.map((o) => ({
        id: o.id,
        kind: o.kind,
        dueOn: o.dueOn,
        amountMinor: toWire(o.amountMinor as Minor),
        settledMinor: toWire(o.settledMinor as Minor),
        waivedMinor: toWire(o.waivedMinor as Minor),
      })),
      totalUnpaidMinor: toWire(summary.totalUnpaidMinor),
      openIncidents: summary.openIncidents,
    },
    200,
  );
};

/** Web-P6d: whether this lease has a deposit at all, and its current held balance. `leaseAndTripLifecycle` — the same capability `settleLeaseDeposit` itself needs. */
export const getLeaseDepositHandler: RouteHandler<typeof getLeaseDepositRoute, Env> = async (c) => {
  requireCapability(c, "leaseAndTripLifecycle");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");

  const existing = await findLeaseForBusiness(c.get("reader"), businessId, id);
  if (!existing) throw new NotFoundError();

  const depositRow = await findDepositForLease(c.get("reader"), businessId, id);
  if (!depositRow) return c.json(null, 200);

  const heldMinor = await sumDepositMovements(c.get("reader"), depositRow.id);
  return c.json(
    {
      id: depositRow.id,
      status: depositRow.status,
      heldMinor: toWire(heldMinor as Minor),
      holdReleaseDate: depositRow.holdReleaseDate,
    },
    200,
  );
};

/** F-2.6 step 6/W-29/W-44. */
export const settleLeaseDepositHandler: RouteHandler<typeof settleLeaseDepositRoute, Env> = async (
  c,
) => {
  requireCapability(c, "leaseAndTripLifecycle");
  const userId = requireUserId(c);

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");

  const existing = await findLeaseForBusiness(c.get("reader"), businessId, id);
  if (!existing) throw new NotFoundError();

  const result = await settleLeaseDeposit(c.get("writer"), {
    businessId,
    leaseId: id,
    action: body.action,
    ...(body.amountMinor !== undefined ? { amountMinor: body.amountMinor } : {}),
    ...(body.reason !== undefined ? { reason: body.reason } : {}),
    occurredOn: body.occurredOn,
    userId,
  });

  return c.json(
    {
      depositId: result.depositId,
      status: result.status,
      heldMinor: toWire(result.heldMinor),
      holdReleaseDate: result.holdReleaseDate,
    },
    200,
  );
};

/** F-2.6 step 7. The closing WhatsApp message needs P14 and is not sent here. */
export const closeOutLeaseHandler: RouteHandler<typeof closeOutLeaseRoute, Env> = async (c) => {
  requireCapability(c, "leaseAndTripLifecycle");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");

  const existing = await findLeaseForBusiness(c.get("reader"), businessId, id);
  if (!existing) throw new NotFoundError();

  await closeOutLease(c.get("writer"), { businessId, leaseId: id });

  const closed = await findLeaseForBusiness(c.get("reader"), businessId, id);
  if (!closed) throw new NotFoundError();

  return c.json(toResponse(closed), 200);
};
