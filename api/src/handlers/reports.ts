import { toWire, type Minor } from "@fleetsettle/shared";
import type { RouteHandler } from "@hono/zod-openapi";
import { requireBusinessId, requireCapability } from "../auth/context.js";
import {
  getAgeingReport,
  getCashPositionReport,
  getFuelEfficiencyReport,
  getGoodwillReport,
  getLostDaysReport,
  getReceivablesReport,
  getTripRankingReport,
  getUtilisationReport,
  getVehicleMonthReport,
} from "../domain/reports.js";
import type {
  getAgeingReportRoute,
  getCashPositionReportRoute,
  getFuelEfficiencyReportRoute,
  getGoodwillReportRoute,
  getLostDaysReportRoute,
  getReceivablesReportRoute,
  getTripRankingReportRoute,
  getUtilisationReportRoute,
  getVehicleMonthReportRoute,
} from "../route-defs/reports.js";
import type { Env } from "../types.js";

/** UC-70/DM §15. `viewReports`: owner, owner-manager, manager — the flat per-business stand-in `auth/policy.ts` documents. */
export const getVehicleMonthReportHandler: RouteHandler<
  typeof getVehicleMonthReportRoute,
  Env
> = async (c) => {
  requireCapability(c, "viewReports");
  const businessId = requireBusinessId(c);
  const { periodId, vehicleId } = c.req.valid("query");

  const report = await getVehicleMonthReport(c.get("reader"), businessId, periodId, vehicleId);

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

  const rows = await getLostDaysReport(c.get("reader"), businessId, from, to);

  return c.json(
    rows.map((r) => ({
      driverId: r.driverId,
      driverName: r.driverName,
      weekday: r.weekday,
      lost: r.lost,
      ran: r.ran,
      leaseEligible: r.leaseEligible,
      lostValueMinor: toWire(r.lostValueMinor as Minor),
    })),
    200,
  );
};

/** UC-77. `viewOwnerOnlyReports`: owner, owner-manager only. */
export const getGoodwillReportHandler: RouteHandler<typeof getGoodwillReportRoute, Env> = async (
  c,
) => {
  requireCapability(c, "viewOwnerOnlyReports");
  const businessId = requireBusinessId(c);
  const { from, to } = c.req.valid("query");

  const report = await getGoodwillReport(c.get("reader"), businessId, from, to);

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
