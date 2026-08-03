import { asBusinessDate, businessToday, toWire, type Minor } from "@fleetsettle/shared";
import type { RouteHandler } from "@hono/zod-openapi";
import {
  requireBusinessId,
  requireBusinessTimezone,
  requireCapability,
  requireUserId,
} from "../auth/context.js";
import { confirmDay } from "../domain/confirmDay.js";
import { NotFoundError } from "../errors/app-error.js";
import { findDailyLeaseForBusiness, findDailyLeaseRateForDate } from "../queries/dailyLease.js";
import {
  findDayRecordByLeaseAndDate,
  listUnconfirmedDayRecordsForBusiness,
  type DayRecordRow,
} from "../queries/day-record.js";
import { findObligationBySource } from "../queries/obligation.js";
import type {
  confirmDayRoute,
  getDayRecordRoute,
  listUnconfirmedDayRecordsRoute,
} from "../route-defs/day-record.js";
import type { Env } from "../types.js";

function toResponse(row: DayRecordRow, receivedMinor: bigint) {
  return {
    id: row.id,
    dailyLeaseId: row.dailyLeaseId,
    vehicleId: row.vehicleId,
    driverId: row.driverId,
    businessDate: row.businessDate,
    state: row.state,
    earnedMinor: toWire(row.earnedMinor as Minor),
    expectedMinor: toWire(row.expectedMinor as Minor),
    receivedMinor: toWire(receivedMinor as Minor),
    lostReason: row.lostReason,
    note: row.note,
  } as const;
}

/** F-4.2/F-4.3/F-4.6. `dailyOperations` (STAFF). */
export const confirmDayHandler: RouteHandler<typeof confirmDayRoute, Env> = async (c) => {
  requireCapability(c, "dailyOperations");
  const businessId = requireBusinessId(c);
  const userId = requireUserId(c);
  const body = c.req.valid("json");
  const reader = c.get("reader");

  const lease = await findDailyLeaseForBusiness(reader, businessId, body.dailyLeaseId);
  if (!lease) throw new NotFoundError("No such daily lease in this business");

  const rate = await findDailyLeaseRateForDate(reader, body.dailyLeaseId, body.businessDate);
  if (!rate) throw new NotFoundError("No rate is in force for this daily lease on this date");

  const action =
    body.action === "paid_in_full"
      ? ({ kind: "paid_in_full" } as const)
      : body.action === "something_else"
        ? ({
            kind: "something_else",
            earnedMinor: body.earnedMinor,
            receivedMinor: body.receivedMinor,
          } as const)
        : ({ kind: "did_not_run", lostReason: body.lostReason } as const);

  const result = await confirmDay(c.get("writer"), {
    businessId,
    dailyLeaseId: body.dailyLeaseId,
    vehicleId: lease.vehicleId,
    driverId: lease.driverId,
    businessDate: asBusinessDate(body.businessDate),
    expectedMinor: rate.dailyLeaseAmountMinor as Minor,
    userId,
    ...(body.note !== undefined ? { note: body.note } : {}),
    action,
  });

  return c.json(toResponse(result.dayRecord, result.receivedMinor), result.created ? 201 : 200);
};

/** F-4.1. `dailyOperations` (STAFF). A 404 means "not yet confirmed", never "gone" (day_record rows are never deleted). */
export const getDayRecordHandler: RouteHandler<typeof getDayRecordRoute, Env> = async (c) => {
  requireCapability(c, "dailyOperations");
  const businessId = requireBusinessId(c);
  const { dailyLeaseId, businessDate } = c.req.valid("param");
  const reader = c.get("reader");

  const lease = await findDailyLeaseForBusiness(reader, businessId, dailyLeaseId);
  if (!lease) throw new NotFoundError("No such daily lease in this business");

  const row = await findDayRecordByLeaseAndDate(reader, dailyLeaseId, businessDate);
  if (!row) throw new NotFoundError("This date is not yet confirmed");

  const obligationRow = await findObligationBySource(reader, "day_record", row.id);
  return c.json(toResponse(row, obligationRow?.settledMinor ?? 0n), 200);
};

/** Home item 4 (UI §3.2). Same `dailyOperations` gate as this resource's other endpoints. */
export const listUnconfirmedDayRecordsHandler: RouteHandler<
  typeof listUnconfirmedDayRecordsRoute,
  Env
> = async (c) => {
  requireCapability(c, "dailyOperations");
  const businessId = requireBusinessId(c);
  const today = businessToday(requireBusinessTimezone(c));

  const rows = await listUnconfirmedDayRecordsForBusiness(c.get("reader"), businessId, today);

  return c.json(
    rows.map((r) => ({
      id: r.id,
      dailyLeaseId: r.dailyLeaseId,
      vehicleId: r.vehicleId,
      vehicleRegistration: r.vehicleRegistration,
      driverId: r.driverId,
      driverName: r.driverName,
      businessDate: r.businessDate,
      expectedMinor: toWire(r.expectedMinor as Minor),
    })),
    200,
  );
};
