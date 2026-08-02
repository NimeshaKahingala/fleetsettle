import { toWire, type Minor } from "@fleetsettle/shared";
import type { RouteHandler } from "@hono/zod-openapi";
import { requireBusinessId, requireCapability, requireUserId } from "../auth/context.js";
import { generateNextBillingPeriod } from "../domain/billing-period.js";
import { renewLease, startLease } from "../domain/lease.js";
import { NotFoundError } from "../errors/app-error.js";
import { findBillingPeriodsForLease, type BillingPeriodRow } from "../queries/billing-period.js";
import { findCustomerForBusiness } from "../queries/customer.js";
import { findLeaseForBusiness, type LeaseRow } from "../queries/lease.js";
import { findVehicleForBusiness } from "../queries/vehicle.js";
import type {
  generateBillingPeriodRoute,
  getLeaseRoute,
  listBillingPeriodsRoute,
  renewLeaseRoute,
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

  const businessId = requireBusinessId(c);
  const body = c.req.valid("json");
  const reader = c.get("reader");

  const vehicle = await findVehicleForBusiness(reader, businessId, body.vehicleId);
  if (!vehicle) throw new NotFoundError("No such vehicle in this business");
  const customer = await findCustomerForBusiness(reader, businessId, body.customerId);
  if (!customer) throw new NotFoundError("No such customer in this business");

  const { lease } = await startLease(c.get("writer"), {
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
  });

  return c.json(toResponse(lease), 201);
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
