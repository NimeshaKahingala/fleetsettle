import { toWire, type Minor } from "@fleetsettle/shared";
import type { LostReason } from "@fleetsettle/shared/schemas";
import type { RouteHandler } from "@hono/zod-openapi";
import {
  requireBusinessId,
  requireBusinessTimezone,
  requireCapability,
  requireRole,
  requireUserId,
} from "../auth/context.js";
import {
  getAgeingReport,
  getCashPositionReport,
  getFuelEfficiencyReport,
  getGoodwillReport,
  getLostDaysReport,
  getOverheadsReport,
  getReceivablesReport,
  getTripRankingReport,
  getUtilisationReport,
  getVehicleMonthReport,
} from "../domain/reports.js";
import { NotFoundError } from "../errors/app-error.js";
import { findPeriodBoundaries } from "../queries/reports.js";
import { listVehicleIdsManagedByUserForPeriod } from "../queries/vehicle-scope.js";
import type {
  getAgeingReportRoute,
  getCashPositionReportRoute,
  getFuelEfficiencyReportRoute,
  getGoodwillReportRoute,
  getLostDaysReportRoute,
  getOverheadsReportRoute,
  getReceivablesReportRoute,
  getTripRankingReportRoute,
  getUtilisationReportRoute,
  getVehicleMonthReportRoute,
} from "../route-defs/reports.js";
import type { Env } from "../types.js";

/**
 * UC-70/DM §15. `viewReports`: owner, owner-manager, manager. GAP-1/W-59/
 * D-17: a manager's own vehicle set is resolved here, never inside
 * `getVehicleMonthReport` itself — `sumAllTimeEarnedForUser` (partner.ts)
 * also calls that function for an unrelated all-time figure and must keep
 * reading every vehicle. Bound to whether the manager's
 * `management_fee_agreement` **overlapped the reported period** (INV-34),
 * so the period lookup runs here first, only for a manager — an owner or
 * owner-manager never pays that extra query.
 */
export const getVehicleMonthReportHandler: RouteHandler<
  typeof getVehicleMonthReportRoute,
  Env
> = async (c) => {
  requireCapability(c, "viewReports");
  const businessId = requireBusinessId(c);
  const role = requireRole(c);
  const { periodId, vehicleId } = c.req.valid("query");

  let allowedVehicleIds: string[] | undefined;
  if (role === "manager") {
    const reader = c.get("reader");
    const period = await findPeriodBoundaries(reader, businessId, periodId);
    if (!period) throw new NotFoundError("No such accounting period in this business");
    allowedVehicleIds = await listVehicleIdsManagedByUserForPeriod(
      reader,
      businessId,
      requireUserId(c),
      period.periodStart,
      period.periodEnd,
    );
  }

  const report = await getVehicleMonthReport(
    c.get("reader"),
    businessId,
    periodId,
    vehicleId,
    allowedVehicleIds,
  );

  return c.json(
    {
      period: report.period,
      vehicles: report.vehicles.map((v) => ({
        vehicleId: v.vehicleId,
        registration: v.registration,
        earnedMinor: toWire(v.earnedMinor as Minor),
        costsMinor: toWire(v.costsMinor as Minor),
        profitMinor: toWire(v.profitMinor as Minor),
        ownerShares: v.ownerShares.map((o) => ({
          userId: o.userId,
          displayName: o.displayName,
          shareBp: o.shareBp,
          profitShareMinor: toWire(o.profitShareMinor as Minor),
        })),
      })),
    },
    200,
  );
};

/** GAP-41/UC-66/W-32. `viewReports`: same audience as `vehicle-month` — this block sits beneath it on the same screen. */
export const getOverheadsReportHandler: RouteHandler<typeof getOverheadsReportRoute, Env> = async (
  c,
) => {
  requireCapability(c, "viewReports");
  const businessId = requireBusinessId(c);
  const { periodId } = c.req.valid("query");

  const report = await getOverheadsReport(c.get("reader"), businessId, periodId);

  return c.json({ totalMinor: toWire(report.totalMinor as Minor) }, 200);
};

/** UC-71. */
export const getTripRankingReportHandler: RouteHandler<
  typeof getTripRankingReportRoute,
  Env
> = async (c) => {
  requireCapability(c, "viewReports");
  const businessId = requireBusinessId(c);

  const rows = await getTripRankingReport(c.get("reader"), businessId);

  return c.json(
    rows.map((r) => ({
      id: r.id,
      vehicleId: r.vehicleId,
      registration: r.registration,
      agreedAmountMinor: toWire(r.agreedAmountMinor as Minor),
      costsMinor: toWire(r.costsMinor as Minor),
      driverFeeMinor: toWire(r.driverFeeMinor as Minor),
      profitMinor: toWire(r.profitMinor as Minor),
      distanceKm: r.distanceKm,
      profitPerKm: r.profitPerKm,
    })),
    200,
  );
};

/** UC-72. */
export const getFuelEfficiencyReportHandler: RouteHandler<
  typeof getFuelEfficiencyReportRoute,
  Env
> = async (c) => {
  requireCapability(c, "viewReports");
  const businessId = requireBusinessId(c);
  const { vehicleId, from, to } = c.req.valid("query");

  const report = await getFuelEfficiencyReport(c.get("reader"), businessId, vehicleId, from, to);

  return c.json(
    {
      vehicleId: report.vehicleId,
      points: report.points.map((p) => ({
        spentOn: p.spentOn,
        amountMinor: toWire(p.amountMinor as Minor),
        litres: p.litres,
        kmPerLitre: p.kmPerLitre,
      })),
    },
    200,
  );
};

/** UC-74/DM §15. */
export const getReceivablesReportHandler: RouteHandler<
  typeof getReceivablesReportRoute,
  Env
> = async (c) => {
  requireCapability(c, "viewReports");
  const businessId = requireBusinessId(c);

  const rows = await getReceivablesReport(c.get("reader"), businessId);

  return c.json(
    rows.map((r) => ({
      partyType: r.partyType,
      partyId: r.partyId,
      partyName: r.partyName,
      outstandingMinor: toWire(r.outstandingMinor as Minor),
      oldestDueOn: r.oldestDueOn,
    })),
    200,
  );
};

/** UC-78/DM §15. */
export const getAgeingReportHandler: RouteHandler<typeof getAgeingReportRoute, Env> = async (c) => {
  requireCapability(c, "viewReports");
  const businessId = requireBusinessId(c);
  const { asOfDate } = c.req.valid("query");

  const rows = await getAgeingReport(c.get("reader"), businessId, asOfDate);

  return c.json(
    rows.map((r) => ({
      partyType: r.partyType,
      partyId: r.partyId,
      partyName: r.partyName,
      bucket: r.bucket,
      outstandingMinor: toWire(r.outstandingMinor as Minor),
    })),
    200,
  );
};

/** UC-75/DM §15. */
export const getCashPositionReportHandler: RouteHandler<
  typeof getCashPositionReportRoute,
  Env
> = async (c) => {
  requireCapability(c, "viewReports");
  const businessId = requireBusinessId(c);

  const report = await getCashPositionReport(c.get("reader"), businessId);

  return c.json(
    {
      partners: report.partners.map((p) => ({
        userId: p.userId,
        displayName: p.displayName,
        heldMinor: toWire(p.heldMinor as Minor),
      })),
      depositsHeldMinor: toWire(report.depositsHeldMinor as Minor),
      banked: report.banked.map((b) => ({
        destination: b.destination,
        heldMinor: toWire(b.heldMinor as Minor),
      })),
      driverAdvances: report.driverAdvances.map((a) => ({
        driverId: a.driverId,
        driverName: a.driverName,
        outstandingMinor: toWire(a.outstandingMinor as Minor),
      })),
    },
    200,
  );
};

/** UC-76/DM §15. */
export const getLostDaysReportHandler: RouteHandler<typeof getLostDaysReportRoute, Env> = async (
  c,
) => {
  requireCapability(c, "viewReports");
  const businessId = requireBusinessId(c);
  const { from, to } = c.req.valid("query");

  const report = await getLostDaysReport(c.get("reader"), businessId, from, to);

  return c.json(
    {
      byWeekday: report.byWeekday.map((r) => ({
        driverId: r.driverId,
        driverName: r.driverName,
        weekday: r.weekday,
        lost: r.lost,
        ran: r.ran,
        leaseEligible: r.leaseEligible,
        lostValueMinor: toWire(r.lostValueMinor as Minor),
      })),
      byMonth: report.byMonth.map((r) => ({
        driverId: r.driverId,
        driverName: r.driverName,
        month: r.month,
        lost: r.lost,
        ran: r.ran,
        leaseEligible: r.leaseEligible,
        lostValueMinor: toWire(r.lostValueMinor as Minor),
      })),
      byReason: report.byReason.map((r) => ({
        driverId: r.driverId,
        driverName: r.driverName,
        // DM §7's CHECK guarantees this is one of the six lost_reason values whenever state = 'did_not_run' — the query only ever selects those rows
        reason: r.reason as LostReason,
        lost: r.lost,
        lostValueMinor: toWire(r.lostValueMinor as Minor),
      })),
    },
    200,
  );
};

/** UC-77. `viewOwnerOnlyReports`: owner, owner-manager only. */
export const getGoodwillReportHandler: RouteHandler<typeof getGoodwillReportRoute, Env> = async (
  c,
) => {
  requireCapability(c, "viewOwnerOnlyReports");
  const businessId = requireBusinessId(c);
  const timezone = requireBusinessTimezone(c);
  const { from, to } = c.req.valid("query");

  const report = await getGoodwillReport(c.get("reader"), businessId, from, to, timezone);

  return c.json({ totalMinor: toWire(report.totalMinor as Minor) }, 200);
};

/** UC-79. `viewOwnerOnlyReports`: owner, owner-manager only. */
export const getUtilisationReportHandler: RouteHandler<
  typeof getUtilisationReportRoute,
  Env
> = async (c) => {
  requireCapability(c, "viewOwnerOnlyReports");
  const businessId = requireBusinessId(c);
  const { vehicleId, from, to } = c.req.valid("query");

  const report = await getUtilisationReport(c.get("reader"), businessId, vehicleId, from, to);

  return c.json(report, 200);
};
