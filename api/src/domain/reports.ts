import { addDays, inclusiveDays, splitInteger, type BusinessDate } from "@fleetsettle/shared";
import type { Reader, Tx, Writer } from "../db/client.js";
import { ForbiddenCapabilityError, NotFoundError } from "../errors/app-error.js";
import {
  countAllocatedDaysForVehicle,
  countEarningDaysForVehicle,
  findOwnershipSharesAsOf,
  findPartyNames,
  findPeriodBoundaries,
  listAdvancesOutstandingByDriver,
  listAgeingBuckets,
  listBankedByDestination,
  listClosedTripsForReport,
  listLostDays,
  listLostDaysByMonth,
  listLostDaysByReason,
  listOffRoadRangesForVehicle,
  listPartnerCashPositions,
  listReceivables,
  listUsBoughtFuelFills,
  listVehicleUnavailabilityRangesForVehicle,
  sumDepositsHeld,
  sumGoodwillGiven,
  sumOverheadsForPeriod,
  sumVehicleCostsForPeriod,
  sumVehicleEarnedForDateRange,
  sumVehicleEarnedForPeriod,
  type AgeingRow,
  type GoodwillByTypeRow,
  type OffRoadRangeRow,
  type ReceivableRow,
} from "../queries/reports.js";
import {
  findVehicleForBusiness,
  listVehiclesForBusiness,
  type VehicleRow,
} from "../queries/vehicle.js";

type ReadDb = Reader | Writer | Tx;

async function requireVehicle(
  db: ReadDb,
  businessId: string,
  vehicleId: string,
): Promise<VehicleRow> {
  const vehicle = await findVehicleForBusiness(db, businessId, vehicleId);
  if (!vehicle) throw new NotFoundError("No such vehicle in this business");
  return vehicle;
}

function resolvePartyName(
  names: Awaited<ReturnType<typeof findPartyNames>>,
  partyType: ReceivableRow["partyType"],
  partyId: string,
): string | null {
  if (partyType === "customer") return names.customers.get(partyId) ?? null;
  if (partyType === "driver") return names.drivers.get(partyId) ?? null;
  return names.partners.get(partyId) ?? null;
}

/** UC-70: everything W-40/W-41 recognise for one vehicle in one accounting period; each owner's share of the profit, effective-dated as of the period's own end (INV-16). */
export interface VehicleMonthOwnerShare {
  userId: string;
  displayName: string | null;
  shareBp: number;
  profitShareMinor: bigint;
}

export interface VehicleMonthRow {
  vehicleId: string;
  registration: string;
  earnedMinor: bigint;
  costsMinor: bigint;
  profitMinor: bigint;
  ownerShares: VehicleMonthOwnerShare[];
}

export interface VehicleMonthReport {
  period: { id: string; periodStart: string; periodEnd: string };
  vehicles: VehicleMonthRow[];
}

async function computeVehicleMonthRow(
  db: ReadDb,
  businessId: string,
  vehicle: VehicleRow,
  periodId: string,
  periodEnd: string,
): Promise<VehicleMonthRow> {
  const earnedMinor = await sumVehicleEarnedForPeriod(db, vehicle.id, periodId);
  const costsMinor = await sumVehicleCostsForPeriod(db, vehicle.id, periodId);
  const profitMinor = earnedMinor - costsMinor;

  const shares = await findOwnershipSharesAsOf(db, vehicle.id, periodEnd);
  let ownerShares: VehicleMonthOwnerShare[] = [];
  if (shares.length > 0) {
    const names = await findPartyNames(
      db,
      businessId,
      [],
      [],
      shares.map((s) => s.userId),
    );
    const splitAmounts = splitInteger(
      profitMinor,
      shares.map((s) => BigInt(s.shareBp)),
    );
    ownerShares = shares.map((s, i) => ({
      userId: s.userId,
      displayName: names.partners.get(s.userId) ?? null,
      shareBp: s.shareBp,
      profitShareMinor: splitAmounts[i] as bigint,
    }));
  }

  return {
    vehicleId: vehicle.id,
    registration: vehicle.registration,
    earnedMinor,
    costsMinor,
    profitMinor,
    ownerShares,
  };
}

/**
 * UC-70: "per vehicle and combined" — the caller sums this array for the
 * combined total (the same pre-computed-lines convention `AllocationPreview`
 * already uses, UI §6), never re-derived server-side a second way.
 *
 * `allowedVehicleIds` (GAP-1/W-59/D-17): `undefined` means unrestricted —
 * every current caller but the handler below passes nothing, including
 * `sumAllTimeEarnedForUser` (partner.ts), which must keep reading every
 * vehicle for its own unrelated all-time figure. **Resolving *which* ids
 * belong here is the handler's job, never this function's** — this stays a
 * plain filter over an already-decided set, so a future caller can never
 * silently inherit a role-lookup this function was never meant to make.
 */
export async function getVehicleMonthReport(
  db: ReadDb,
  businessId: string,
  periodId: string,
  vehicleId: string | undefined,
  allowedVehicleIds?: readonly string[],
): Promise<VehicleMonthReport> {
  const period = await findPeriodBoundaries(db, businessId, periodId);
  if (!period) throw new NotFoundError("No such accounting period in this business");

  let vehicles: VehicleRow[];
  if (vehicleId) {
    const one = await requireVehicle(db, businessId, vehicleId);
    if (allowedVehicleIds && !allowedVehicleIds.includes(vehicleId)) {
      throw new ForbiddenCapabilityError("This vehicle is not shared with you");
    }
    vehicles = [one];
  } else {
    const all = await listVehiclesForBusiness(db, businessId);
    vehicles = allowedVehicleIds ? all.filter((v) => allowedVehicleIds.includes(v.id)) : all;
  }

  const rows = await Promise.all(
    vehicles.map((v) => computeVehicleMonthRow(db, businessId, v, periodId, period.periodEnd)),
  );

  return {
    period: { id: periodId, periodStart: period.periodStart, periodEnd: period.periodEnd },
    vehicles: rows,
  };
}

/** GAP-41/UC-66/W-32: this period's costs recorded with no vehicle — its own report-shaped total, not a client-side sum over a full expense list (which would be aggregation outside SQL on a money figure). */
export async function getOverheadsReport(
  db: ReadDb,
  businessId: string,
  periodId: string,
): Promise<{ totalMinor: bigint }> {
  const period = await findPeriodBoundaries(db, businessId, periodId);
  if (!period) throw new NotFoundError("No such accounting period in this business");

  const totalMinor = await sumOverheadsForPeriod(db, businessId, periodId);
  return { totalMinor };
}

/** UC-71: ranked by profit; profit-per-km is `null` (and excluded from a per-km ranking) for any trip with no closing odometer, never ranked at zero. */
export interface RankedTripRow {
  id: string;
  vehicleId: string;
  registration: string;
  agreedAmountMinor: bigint;
  costsMinor: bigint;
  driverFeeMinor: bigint;
  profitMinor: bigint;
  distanceKm: number | null;
  profitPerKm: number | null;
}

export async function getTripRankingReport(
  db: ReadDb,
  businessId: string,
): Promise<RankedTripRow[]> {
  const [trips, vehicles] = await Promise.all([
    listClosedTripsForReport(db, businessId),
    listVehiclesForBusiness(db, businessId),
  ]);
  const registrationByVehicle = new Map(vehicles.map((v) => [v.id, v.registration]));

  const rows = trips.map((t) => {
    const profitMinor = t.agreedAmountMinor - t.costsMinor - t.driverFeeMinor;
    const profitPerKm =
      t.distanceKm !== null && t.distanceKm > 0
        ? // eslint-disable-next-line no-restricted-syntax -- a display/ranking ratio (UC-71), not a stored or allocated amount — precision here never touches the ledger
          Number(profitMinor) / t.distanceKm
        : null;
    return {
      id: t.id,
      vehicleId: t.vehicleId,
      registration: registrationByVehicle.get(t.vehicleId) ?? "",
      agreedAmountMinor: t.agreedAmountMinor,
      costsMinor: t.costsMinor,
      driverFeeMinor: t.driverFeeMinor,
      profitMinor,
      distanceKm: t.distanceKm,
      profitPerKm,
    };
  });

  return rows.sort((a, b) =>
    a.profitMinor === b.profitMinor ? 0 : a.profitMinor < b.profitMinor ? 1 : -1,
  );
}

/** UC-72: only fuel *you* bought (W-20). `kmPerLitre` needs the *previous* fill's own odometer reading, so the first fill in any window — or any fill missing a reading — degrades to `null` rather than a misleading zero. */
export interface FuelEfficiencyPoint {
  spentOn: string;
  amountMinor: bigint;
  litres: number | null;
  kmPerLitre: number | null;
}

export async function getFuelEfficiencyReport(
  db: ReadDb,
  businessId: string,
  vehicleId: string,
  from: string,
  to: string,
): Promise<{ vehicleId: string; points: FuelEfficiencyPoint[] }> {
  await requireVehicle(db, businessId, vehicleId);
  const fills = await listUsBoughtFuelFills(db, businessId, vehicleId, from, to);

  const points = fills.map((fill, i): FuelEfficiencyPoint => {
    const previous = fills[i - 1];
    const kmPerLitre =
      previous !== undefined &&
      previous.readingKm !== null &&
      fill.readingKm !== null &&
      fill.litres !== null &&
      fill.litres > 0
        ? (fill.readingKm - previous.readingKm) / fill.litres
        : null;
    return {
      spentOn: fill.spentOn,
      amountMinor: fill.amountMinor,
      litres: fill.litres,
      kmPerLitre,
    };
  });

  return { vehicleId, points };
}

/** UC-74/DM §15: one row per party, resolved to a display name — `written_off` obligations are already excluded (the point of writing one off, UC-90). */
export async function getReceivablesReport(
  db: ReadDb,
  businessId: string,
): Promise<(ReceivableRow & { partyName: string | null })[]> {
  const rows = await listReceivables(db, businessId);
  const names = await findPartyNames(
    db,
    businessId,
    rows.filter((r) => r.partyType === "customer").map((r) => r.partyId),
    rows.filter((r) => r.partyType === "driver").map((r) => r.partyId),
    rows.filter((r) => r.partyType === "partner").map((r) => r.partyId),
  );
  return rows
    .map((r) => ({ ...r, partyName: resolvePartyName(names, r.partyType, r.partyId) }))
    .sort((a, b) =>
      a.outstandingMinor === b.outstandingMinor
        ? 0
        : a.outstandingMinor < b.outstandingMinor
          ? 1
          : -1,
    );
}

/** UC-78/DM §15: the UC-74 list, bucketed by age from each obligation's own `effective_due_on` — never one bucket per party's summed balance (DM §15's own stated reason). `asOfDate` is the business date, passed as a parameter (CLAUDE.md → Time). */
export async function getAgeingReport(
  db: ReadDb,
  businessId: string,
  asOfDate: string,
): Promise<(AgeingRow & { partyName: string | null })[]> {
  const rows = await listAgeingBuckets(db, businessId, asOfDate);
  const names = await findPartyNames(
    db,
    businessId,
    rows.filter((r) => r.partyType === "customer").map((r) => r.partyId),
    rows.filter((r) => r.partyType === "driver").map((r) => r.partyId),
    rows.filter((r) => r.partyType === "partner").map((r) => r.partyId),
  );
  return rows.map((r) => ({ ...r, partyName: resolvePartyName(names, r.partyType, r.partyId) }));
}

/**
 * UC-75/DM §15: what each partner holds, plus deposits held shown *beside*
 * it — never netted in (§6.13). GAP-70 adds `banked` and `driverAdvances` —
 * the same two subtrahends `heldMinor` already nets out, given their own
 * rows so a reader can see *where* the missing money went, not only that it
 * is missing. Kept arithmetically consistent with `heldMinor`'s own
 * simplification (queries/reports.ts's own doc comments), not a corrected
 * version of it.
 */
export async function getCashPositionReport(
  db: ReadDb,
  businessId: string,
): Promise<{
  partners: Awaited<ReturnType<typeof listPartnerCashPositions>>;
  depositsHeldMinor: bigint;
  banked: Awaited<ReturnType<typeof listBankedByDestination>>;
  driverAdvances: Awaited<ReturnType<typeof listAdvancesOutstandingByDriver>>;
}> {
  const [partners, depositsHeldMinor, banked, driverAdvances] = await Promise.all([
    listPartnerCashPositions(db, businessId),
    sumDepositsHeld(db, businessId),
    listBankedByDestination(db, businessId),
    listAdvancesOutstandingByDriver(db, businessId),
  ]);
  return { partners, depositsHeldMinor, banked, driverAdvances };
}

/**
 * UC-76/DM §15: per driver, resolved to a display name, in the three sibling
 * groupings UI §11.1 asks for — weekday (unchanged since Wave 1), month
 * (GAP-71, the primary "column per month" form) and reason (GAP-71, "a bus
 * that breaks down often" vs "a driver who takes Fridays off"). Three
 * separate arrays rather than one denser cube, per DM §15's own reasoning:
 * a driver active across six months and six reasons would otherwise explode
 * into up to 36 sparse rows to reassemble client-side. The denominator
 * shown anywhere is `ran + lost` (§1.2), never inflated by an off-pattern
 * or charter day — `byReason` alone has no `ran`/`leaseEligible`, since a
 * reason only exists for a lost day.
 */
export async function getLostDaysReport(
  db: ReadDb,
  businessId: string,
  from: string,
  to: string,
): Promise<{
  byWeekday: (Awaited<ReturnType<typeof listLostDays>>[number] & { driverName: string | null })[];
  byMonth: (Awaited<ReturnType<typeof listLostDaysByMonth>>[number] & {
    driverName: string | null;
  })[];
  byReason: (Awaited<ReturnType<typeof listLostDaysByReason>>[number] & {
    driverName: string | null;
  })[];
}> {
  const [byWeekdayRows, byMonthRows, byReasonRows] = await Promise.all([
    listLostDays(db, businessId, from, to),
    listLostDaysByMonth(db, businessId, from, to),
    listLostDaysByReason(db, businessId, from, to),
  ]);

  const driverIds = [
    ...new Set([
      ...byWeekdayRows.map((r) => r.driverId),
      ...byMonthRows.map((r) => r.driverId),
      ...byReasonRows.map((r) => r.driverId),
    ]),
  ];
  const names = await findPartyNames(db, businessId, [], driverIds);
  const nameFor = (driverId: string): string | null => names.drivers.get(driverId) ?? null;

  return {
    byWeekday: byWeekdayRows.map((r) => ({ ...r, driverName: nameFor(r.driverId) })),
    byMonth: byMonthRows.map((r) => ({ ...r, driverName: nameFor(r.driverId) })),
    byReason: byReasonRows.map((r) => ({ ...r, driverName: nameFor(r.driverId) })),
  };
}

/** UC-77: every waiver/auto-waiver/goodwill adjustment given in the window, and the same total broken down by `adjustment_type` (GAP-73) — never pooled with a write-off (W-28). */
export async function getGoodwillReport(
  db: ReadDb,
  businessId: string,
  from: string,
  to: string,
): Promise<{ totalMinor: bigint; byType: GoodwillByTypeRow[] }> {
  const byType = await sumGoodwillGiven(db, businessId, from, to);
  const totalMinor = byType.reduce((sum, r) => sum + r.totalMinor, 0n);
  return { totalMinor, byType };
}

/**
 * GAP-26: UC-79's off-road bucket now has two independent sources — an
 * incident's own `off_road_from`/`off_road_to` and a separately-logged
 * `vehicle_unavailability` outage — and nothing stops a manager recording
 * both for the same stretch (the accident that also gets tagged "in for
 * service"). Summing each range's own length would double-count that
 * overlap and overstate the bucket, the exact direction W-56 forbids, so
 * this unions the two sources' actual days instead. Bounded by the report
 * window's own length (a month, typically), never by row count.
 */
function countOffRoadDays(ranges: OffRoadRangeRow[], from: string, to: string): number {
  const days = new Set<string>();
  for (const range of ranges) {
    const clippedFrom = range.offRoadFrom > from ? range.offRoadFrom : from;
    const clippedTo = range.offRoadTo < to ? range.offRoadTo : to;
    for (let d = clippedFrom as BusinessDate; d <= clippedTo; d = addDays(d, 1)) {
      days.add(d);
    }
  }
  return days.size;
}

/**
 * UC-79: day-based figures for one vehicle in a window (W-56: always
 * computable). A day is earning if it ran on its daily lease, was on a
 * lease (arrangement 'A'), or was on a trip (arrangement 'C') —
 * non-overlapping by construction (INV-1: a vehicle cannot be double-booked).
 *
 * GAP-19: `revenuePerAvailableDayMinor` — "available" is `totalDays -
 * offRoadDays` (earning **and** idle both count; idle is exactly "what the
 * vehicle could have been earning and wasn't", UC-79's own definition), and
 * the revenue itself is `sumVehicleEarnedForDateRange`, never prorated
 * (W-25). `null`, not a guessed `0n`, when there are no available days at
 * all to divide by (the whole window off the road) — W-56's degrade rule
 * applies to a ratio exactly as it does to a missing reading.
 */
export async function getUtilisationReport(
  db: ReadDb,
  businessId: string,
  vehicleId: string,
  from: string,
  to: string,
): Promise<{
  vehicleId: string;
  from: string;
  to: string;
  earningDays: number;
  idleDays: number;
  offRoadDays: number;
  totalDays: number;
  revenuePerAvailableDayMinor: bigint | null;
}> {
  await requireVehicle(db, businessId, vehicleId);

  const [
    { ranDays },
    leaseDays,
    tripDays,
    incidentOffRoadRanges,
    unavailabilityRanges,
    earnedMinor,
  ] = await Promise.all([
    countEarningDaysForVehicle(db, businessId, vehicleId, from, to),
    countAllocatedDaysForVehicle(db, businessId, vehicleId, "A", from, to),
    countAllocatedDaysForVehicle(db, businessId, vehicleId, "C", from, to),
    listOffRoadRangesForVehicle(db, businessId, vehicleId, from, to),
    listVehicleUnavailabilityRangesForVehicle(db, businessId, vehicleId, from, to),
    sumVehicleEarnedForDateRange(db, vehicleId, from, to),
  ]);

  const offRoadDays = countOffRoadDays(
    [...incidentOffRoadRanges, ...unavailabilityRanges],
    from,
    to,
  );

  const totalDays = inclusiveDays(from as BusinessDate, to as BusinessDate);
  const earningDays = ranDays + leaseDays + tripDays;
  const idleDays = Math.max(0, totalDays - earningDays - offRoadDays);
  const availableDays = totalDays - offRoadDays;
  const revenuePerAvailableDayMinor =
    availableDays > 0 ? earnedMinor / BigInt(availableDays) : null;

  return {
    vehicleId,
    from,
    to,
    earningDays,
    idleDays,
    offRoadDays,
    totalDays,
    revenuePerAvailableDayMinor,
  };
}
