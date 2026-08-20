import { newId, splitInteger, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { Reader, Writer } from "../db/client.js";
import {
  isExclusionViolation,
  isPeriodClosedViolation,
  isSharesNotFullViolation,
  isUniqueViolation,
} from "../db/pg-error.js";
import {
  BankingEventAlreadyVoidedError,
  CapitalContributionAlreadyVoidedError,
  ManagementAgreementOverlapsError,
  NotFoundError,
  OwnershipSharesInvalidError,
  PartnerPayoutAlreadyVoidedError,
  PeriodClosedError,
  ReplacesTargetAlreadyReplacedError,
  ReplacesTargetNotVoidedError,
} from "../errors/app-error.js";
import {
  findOpenPeriodRow,
  listAccountingPeriodsForBusiness,
  resolvePeriodLinkage,
} from "../queries/accounting-period.js";
import { sumOutOfPocketExpensesForUser } from "../queries/expense.js";
import {
  findBankingEventForBusiness,
  findCapitalContributionForBusiness,
  findPartnerPayoutForBusiness,
  insertBankingEvent,
  insertCapitalContribution,
  insertManagementFeeAgreement,
  insertOwnershipShares,
  insertPartnerPayout,
  listManagementFeeAgreementHistoryForManager,
  revokeManagementFeeAgreement,
  sumCapitalContributionsForUser,
  sumManagementFeeAsOfDate,
  sumPartnerPayoutsForUser,
  voidBankingEventRow,
  voidCapitalContributionRow,
  voidPartnerPayoutRow,
  type OwnershipShareRow,
} from "../queries/partner.js";
import {
  listOwnershipShareHistoryForVehicles,
  listPartnerCashPositions,
  sumVehicleCostsForPeriodsBulk,
  sumVehicleEarnedForPeriodsBulk,
} from "../queries/reports.js";
import { listVehiclesForBusiness } from "../queries/vehicle.js";
import { getVehicleMonthReport, readBulkMinor } from "./reports.js";

export interface SetOwnershipSharesInput {
  vehicleId: string;
  effectiveFrom: BusinessDate;
  shares: Array<{ userId: string; shareBp: number }>;
}

/**
 * F-1.3/UC-02, one bulk insert (IG §2): every owner's share for one
 * effective date. `assert_shares_total()` is a *deferred* constraint
 * trigger (migration 0001) — it fires at the end of this implicit
 * transaction, once all rows exist, which is exactly why a 60/40 split can
 * land as one legal multi-row change instead of rejecting the first row for
 * summing to less than 100% on its own.
 */
export async function setOwnershipShares(
  writer: Writer,
  input: SetOwnershipSharesInput,
): Promise<OwnershipShareRow[]> {
  const rows = input.shares.map((share) => ({
    id: newId(),
    vehicleId: input.vehicleId,
    userId: share.userId,
    shareBp: share.shareBp,
    effectiveFrom: input.effectiveFrom,
  }));

  try {
    // withActor (db/client.ts) only attributes writes inside a real
    // transaction — wrapped here for that reason as much as for the
    // deferred constraint trigger, which already needed one implicitly.
    await writer.transaction((tx) => insertOwnershipShares(tx, rows));
  } catch (err) {
    if (isSharesNotFullViolation(err)) throw new OwnershipSharesInvalidError();
    throw err;
  }

  return rows.map((row) => ({ ...row, effectiveTo: null }));
}

export interface RecordCapitalContributionInput {
  businessId: string;
  vehicleId?: string;
  userId: string;
  amountMinor: Minor;
  contributedOn: BusinessDate;
  note?: string;
  replacesId?: string;
}

export interface RecordedCapitalContribution {
  contributionId: string;
}

/**
 * F-1.3/UC-02/W-52: what he paid — the gap against what he owns
 * (`ownership_share`) is read elsewhere (P11), never resolved here.
 *
 * GAP-60/D-16: `replacesId`, when set, is F-8.5's "replace" half — see
 * `createExpense`'s own comment for the full shape (target must belong to
 * this business and already be voided; the partial unique index, migration
 * 0025, is the constraint stopping a second reply at the same voided row).
 */
export async function recordCapitalContribution(
  writer: Writer,
  input: RecordCapitalContributionInput,
): Promise<RecordedCapitalContribution> {
  const linkage = await resolvePeriodLinkage(writer, input.businessId, input.contributedOn);
  if (!linkage) throw new PeriodClosedError("No accounting period covers this business date yet");

  if (input.replacesId !== undefined) {
    const target = await findCapitalContributionForBusiness(
      writer,
      input.businessId,
      input.replacesId,
    );
    if (!target) throw new NotFoundError("No such capital contribution in this business");
    if (target.voidedAt === null) throw new ReplacesTargetNotVoidedError();
  }

  const contributionId = newId();
  try {
    // See setOwnershipShares's own comment — withActor only attributes
    // writes inside a real transaction.
    await writer.transaction((tx) =>
      insertCapitalContribution(tx, {
        id: contributionId,
        businessId: input.businessId,
        ...(input.vehicleId !== undefined ? { vehicleId: input.vehicleId } : {}),
        userId: input.userId,
        amountMinor: input.amountMinor,
        contributedOn: input.contributedOn,
        ...(input.note !== undefined ? { note: input.note } : {}),
        postedPeriodId: linkage.postedPeriodId,
        ...(linkage.belongsToPeriodId !== null
          ? { belongsToPeriodId: linkage.belongsToPeriodId }
          : {}),
        ...(input.replacesId !== undefined ? { replacesId: input.replacesId } : {}),
      }),
    );
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    if (isUniqueViolation(err, "capital_contribution_replaces_id_key")) {
      throw new ReplacesTargetAlreadyReplacedError();
    }
    throw err;
  }

  return { contributionId };
}

export interface VoidCapitalContributionInput {
  businessId: string;
  contributionId: string;
  reason: string;
  userId: string;
}

/** GAP-12/A9b/F-8.5/UC-96/W-50: the `voidExpense` shape — existence check → already-voided check → transaction (`withActor` only attributes inside a real one) → catch the period trigger. No child rows to unwind. */
export async function voidCapitalContribution(
  writer: Writer,
  input: VoidCapitalContributionInput,
): Promise<{ voidedAt: string }> {
  const existing = await findCapitalContributionForBusiness(
    writer,
    input.businessId,
    input.contributionId,
  );
  if (!existing) throw new NotFoundError("No such capital contribution in this business");
  if (existing.voidedAt !== null) throw new CapitalContributionAlreadyVoidedError();

  try {
    // `voidCapitalContributionRow`'s WHERE guards `voided_at IS NULL`, so a
    // losing race against a concurrent void returns undefined here rather
    // than clobbering the winner's own reason/actor (the same shape
    // `archiveDriverRow`/`archiveCustomerRow` already use).
    const voided = await writer.transaction((tx) =>
      voidCapitalContributionRow(tx, input.contributionId, {
        voidedReason: input.reason,
        voidedBy: input.userId,
      }),
    );
    if (!voided) throw new CapitalContributionAlreadyVoidedError();
    return voided;
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    throw err;
  }
}

export interface GrantManagementInput {
  vehicleId: string;
  managerUserId: string;
  monthlyFeeMinor?: Minor;
  effectiveFrom: BusinessDate;
}

export interface GrantedManagement {
  agreementId: string;
}

/** F-1.4/UC-03: sharing a vehicle with a manager, with an optional monthly fee — INV: no two agreements for the same vehicle and manager over overlapping dates (the EXCLUDE constraint, not a pre-check). */
export async function grantManagement(
  writer: Writer,
  input: GrantManagementInput,
): Promise<GrantedManagement> {
  const agreementId = newId();
  try {
    // See setOwnershipShares's own comment.
    await writer.transaction((tx) =>
      insertManagementFeeAgreement(tx, {
        id: agreementId,
        vehicleId: input.vehicleId,
        managerUserId: input.managerUserId,
        // eslint-disable-next-line no-restricted-syntax -- allow: a genuine zero fee ("manage it for me, no charge") is the fact, not a stand-in for a missing one
        monthlyAmountMinor: input.monthlyFeeMinor ?? 0n,
        effectiveFrom: input.effectiveFrom,
      }),
    );
  } catch (err) {
    if (
      isExclusionViolation(err, "management_fee_agreement_vehicle_id_manager_user_id_datera_excl")
    ) {
      throw new ManagementAgreementOverlapsError();
    }
    throw err;
  }

  return { agreementId };
}

/** F-1.4's "Revoke — access ends, everything they entered stays": sets `effective_to`, never deletes the row. */
export async function revokeManagement(
  writer: Writer,
  agreementId: string,
  effectiveTo: BusinessDate,
): Promise<void> {
  // See setOwnershipShares's own comment.
  await writer.transaction((tx) => revokeManagementFeeAgreement(tx, agreementId, effectiveTo));
}

export interface RecordBankingEventInput {
  businessId: string;
  fromUserId: string;
  amountRecordedMinor: Minor;
  amountCountedMinor: Minor;
  bankedOn: BusinessDate;
  destination: string;
  reference?: string;
  discrepancyBearer?: "absorbed" | "unattributed";
  createdBy: string;
  replacesId?: string;
}

export interface RecordedBankingEvent {
  bankingEventId: string;
  discrepancyMinor: Minor;
}

/**
 * F-7.4/UC-65/INV-23: the same money in a different place — never income, an
 * expense, or a payout. `discrepancy_minor` is a generated column (DB,
 * migration 0001); computed here too only to shape the response without a
 * second round trip, never written.
 *
 * GAP-60/D-16: `replacesId` — see `recordCapitalContribution`'s own comment
 * for the shape.
 */
export async function recordBankingEvent(
  writer: Writer,
  input: RecordBankingEventInput,
): Promise<RecordedBankingEvent> {
  const linkage = await resolvePeriodLinkage(writer, input.businessId, input.bankedOn);
  if (!linkage) throw new PeriodClosedError("No accounting period covers this business date yet");

  if (input.replacesId !== undefined) {
    const target = await findBankingEventForBusiness(writer, input.businessId, input.replacesId);
    if (!target) throw new NotFoundError("No such banking event in this business");
    if (target.voidedAt === null) throw new ReplacesTargetNotVoidedError();
  }

  const bankingEventId = newId();
  try {
    // See setOwnershipShares's own comment.
    await writer.transaction((tx) =>
      insertBankingEvent(tx, {
        id: bankingEventId,
        businessId: input.businessId,
        fromUserId: input.fromUserId,
        amountRecordedMinor: input.amountRecordedMinor,
        amountCountedMinor: input.amountCountedMinor,
        bankedOn: input.bankedOn,
        destination: input.destination,
        ...(input.reference !== undefined ? { reference: input.reference } : {}),
        ...(input.discrepancyBearer !== undefined
          ? { discrepancyBearer: input.discrepancyBearer }
          : {}),
        postedPeriodId: linkage.postedPeriodId,
        ...(linkage.belongsToPeriodId !== null
          ? { belongsToPeriodId: linkage.belongsToPeriodId }
          : {}),
        createdBy: input.createdBy,
        ...(input.replacesId !== undefined ? { replacesId: input.replacesId } : {}),
      }),
    );
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    if (isUniqueViolation(err, "banking_event_replaces_id_key")) {
      throw new ReplacesTargetAlreadyReplacedError();
    }
    throw err;
  }

  return {
    bankingEventId,
    discrepancyMinor: (input.amountRecordedMinor - input.amountCountedMinor) as Minor,
  };
}

export interface VoidBankingEventInput {
  businessId: string;
  bankingEventId: string;
  reason: string;
  userId: string;
}

/** GAP-12/A9b/F-8.5/UC-96/W-50: the `voidExpense` shape. No child rows to unwind — INV-23's unattributable shortfall lives on this row directly. */
export async function voidBankingEvent(
  writer: Writer,
  input: VoidBankingEventInput,
): Promise<{ voidedAt: string }> {
  const existing = await findBankingEventForBusiness(
    writer,
    input.businessId,
    input.bankingEventId,
  );
  if (!existing) throw new NotFoundError("No such banking event in this business");
  if (existing.voidedAt !== null) throw new BankingEventAlreadyVoidedError();

  try {
    // See voidCapitalContribution's own comment: the WHERE guard makes a
    // losing race return undefined instead of a clobbered row.
    const voided = await writer.transaction((tx) =>
      voidBankingEventRow(tx, input.bankingEventId, {
        voidedReason: input.reason,
        voidedBy: input.userId,
      }),
    );
    if (!voided) throw new BankingEventAlreadyVoidedError();
    return voided;
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    throw err;
  }
}

export interface RecordPartnerPayoutInput {
  businessId: string;
  userId: string;
  amountMinor: Minor;
  kind: "payout" | "partner_settlement";
  occurredOn: BusinessDate;
  replacesId?: string;
}

export interface RecordedPartnerPayout {
  payoutId: string;
}

/**
 * F-7.2/UC-63: never a cost of the vehicle — a payout, or a settlement
 * between partners that moves the current account, not the P&L.
 *
 * GAP-60/D-16: `replacesId` — see `recordCapitalContribution`'s own comment
 * for the shape.
 */
export async function recordPartnerPayout(
  writer: Writer,
  input: RecordPartnerPayoutInput,
): Promise<RecordedPartnerPayout> {
  const linkage = await resolvePeriodLinkage(writer, input.businessId, input.occurredOn);
  if (!linkage) throw new PeriodClosedError("No accounting period covers this business date yet");

  if (input.replacesId !== undefined) {
    const target = await findPartnerPayoutForBusiness(writer, input.businessId, input.replacesId);
    if (!target) throw new NotFoundError("No such payout in this business");
    if (target.voidedAt === null) throw new ReplacesTargetNotVoidedError();
  }

  const payoutId = newId();
  try {
    // See setOwnershipShares's own comment.
    await writer.transaction((tx) =>
      insertPartnerPayout(tx, {
        id: payoutId,
        businessId: input.businessId,
        userId: input.userId,
        amountMinor: input.amountMinor,
        kind: input.kind,
        occurredOn: input.occurredOn,
        postedPeriodId: linkage.postedPeriodId,
        ...(linkage.belongsToPeriodId !== null
          ? { belongsToPeriodId: linkage.belongsToPeriodId }
          : {}),
        ...(input.replacesId !== undefined ? { replacesId: input.replacesId } : {}),
      }),
    );
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    if (isUniqueViolation(err, "partner_payout_replaces_id_key")) {
      throw new ReplacesTargetAlreadyReplacedError();
    }
    throw err;
  }

  return { payoutId };
}

export interface VoidPartnerPayoutInput {
  businessId: string;
  payoutId: string;
  reason: string;
  userId: string;
}

/** GAP-12/A9b/F-8.5/UC-96/W-50: the `voidExpense` shape. No child rows to unwind — a payout or partner settlement is a standalone fact about cash that moved. */
export async function voidPartnerPayout(
  writer: Writer,
  input: VoidPartnerPayoutInput,
): Promise<{ voidedAt: string }> {
  const existing = await findPartnerPayoutForBusiness(writer, input.businessId, input.payoutId);
  if (!existing) throw new NotFoundError("No such payout in this business");
  if (existing.voidedAt !== null) throw new PartnerPayoutAlreadyVoidedError();

  try {
    // See voidCapitalContribution's own comment: the WHERE guard makes a
    // losing race return undefined instead of a clobbered row.
    const voided = await writer.transaction((tx) =>
      voidPartnerPayoutRow(tx, input.payoutId, {
        voidedReason: input.reason,
        voidedBy: input.userId,
      }),
    );
    if (!voided) throw new PartnerPayoutAlreadyVoidedError();
    return voided;
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    throw err;
  }
}

export interface PartnerSummary {
  userId: string;
  displayName: string | null;
  period: { id: string; periodStart: string; periodEnd: string };
  putIn: { contributionsMinor: Minor; outOfPocketMinor: Minor };
  takenOut: { payoutsMinor: Minor; settlementsMinor: Minor };
  earned: { profitShareMinor: Minor; managementFeeMinor: Minor };
  holdingMinor: Minor;
  balanceMinor: Minor;
}

/** One user's profit share out of a `getVehicleMonthReport` result — shared by the open-period `earned` figure and GAP-74's all-time loop below, so the two can never disagree about how a share is read off the report. */
function sumProfitShareForUser(
  vehicleMonth: Awaited<ReturnType<typeof getVehicleMonthReport>>,
  userId: string,
): bigint {
  return vehicleMonth.vehicles.reduce((sum, v) => {
    const share = v.ownerShares.find((s) => s.userId === userId);
    // eslint-disable-next-line no-restricted-syntax -- allow: no ownership_share row for this user on this vehicle is a real 0% share of it, not a missing figure (W-56 governs an unknown, not an absent one)
    return sum + (share?.profitShareMinor ?? 0n);
  }, 0n);
}

/**
 * GAP-74: profit share is a period fact, not a standing balance — no row
 * anywhere holds what a closed period already settled, so an all-time
 * figure means replaying every period this business has ever had. **Not**
 * the eventual shape — a snapshot taken at period close, so a closed
 * period's share becomes a settled fact recomputation cannot move
 * (INV-16's own instinct) — that needs a migration and a backfill and is
 * deliberately not this.
 *
 * GAP-145: originally shipped as a bounded loop calling `getVehicleMonthReport`
 * once per accounting period — `O(vehicles × periods)` round trips on the
 * exact endpoint that later hit Workers Free's 50-subrequest ceiling (`GET
 * /api/partner/{userId}`, 79 subrequests for one six-vehicle business, one
 * open period). Replaced with five flat queries regardless of how many
 * periods or vehicles this business has ever had: every vehicle, every
 * period's own earned/costs (grouped by vehicle *and* period in one round
 * trip each), the full ownership-share history, and the full
 * management-fee-agreement history for this manager. INV-16's
 * effective-dating — which shares applied as of a given period's own end —
 * is then evaluated per period in memory, the same replay the original
 * loop did, just without a round trip per period to do it.
 */
async function sumAllTimeEarnedForUser(
  db: Reader,
  businessId: string,
  userId: string,
): Promise<bigint> {
  const periods = await listAccountingPeriodsForBusiness(db, businessId);
  if (periods.length === 0) return 0n;

  const vehicles = await listVehiclesForBusiness(db, businessId);
  const vehicleIds = vehicles.map((v) => v.id);
  const periodIds = periods.map((p) => p.id);

  const [earnedByPeriod, costsByPeriod, sharesByVehicle, feeAgreements] = await Promise.all([
    sumVehicleEarnedForPeriodsBulk(db, vehicleIds, periodIds),
    sumVehicleCostsForPeriodsBulk(db, vehicleIds, periodIds),
    listOwnershipShareHistoryForVehicles(db, vehicleIds),
    listManagementFeeAgreementHistoryForManager(db, businessId, userId),
  ]);

  let total = 0n;
  for (const period of periods) {
    const earnedByVehicle = earnedByPeriod.get(period.id) ?? new Map<string, bigint>();
    const costsByVehicle = costsByPeriod.get(period.id) ?? new Map<string, bigint>();

    for (const vehicleId of vehicleIds) {
      const profitMinor =
        readBulkMinor(earnedByVehicle, vehicleId) - readBulkMinor(costsByVehicle, vehicleId);
      const shares = (sharesByVehicle.get(vehicleId) ?? []).filter(
        (s) =>
          s.effectiveFrom <= period.periodEnd &&
          (s.effectiveTo === null || s.effectiveTo >= period.periodEnd),
      );
      if (shares.length === 0) continue;
      const splitAmounts = splitInteger(
        profitMinor,
        shares.map((s) => BigInt(s.shareBp)),
      );
      const idx = shares.findIndex((s) => s.userId === userId);
      // No row for this user on this vehicle in this period is a real 0% share (W-56), not a missing figure — findIndex's -1 skips the add rather than reading a fabricated splitAmounts[-1].
      if (idx !== -1) total += splitAmounts[idx] as bigint;
    }

    total += feeAgreements
      .filter(
        (a) =>
          a.effectiveFrom <= period.periodEnd &&
          (a.effectiveTo === null || a.effectiveTo >= period.periodEnd),
      )
      .reduce((sum, a) => sum + a.monthlyAmountMinor, 0n);
  }
  return total;
}

/**
 * A2/GAP-9/GAP-4/UC-67/W-52/W-53/GAP-74: "one page per partner, four
 * lines, plus the one he actually reads" — composed entirely from reads
 * that already exist. `putIn`/`takenOut` are all-time; `earned` stays the
 * currently open period only, for the "this month" figures that read
 * beside it. `balanceMinor` is the new, separate all-time figure GAP-74
 * added — `putIn + earned(all periods) − takenOut`, never `holdingMinor`
 * netted in (W-2). Reused rather than duplicated: `getVehicleMonthReport`
 * for profit share (P11), `listPartnerCashPositions` for holding (P11).
 */
export async function getPartnerSummary(
  db: Reader,
  businessId: string,
  userId: string,
  displayName: string | null,
): Promise<PartnerSummary> {
  const period = await findOpenPeriodRow(db, businessId);
  if (!period) throw new NotFoundError("No open accounting period for this business");

  const [
    contributionsMinor,
    outOfPocketMinor,
    payoutTotals,
    managementFeeMinor,
    vehicleMonth,
    cashPositions,
    allTimeEarnedMinor,
  ] = await Promise.all([
    sumCapitalContributionsForUser(db, businessId, userId),
    sumOutOfPocketExpensesForUser(db, businessId, userId),
    sumPartnerPayoutsForUser(db, businessId, userId),
    sumManagementFeeAsOfDate(db, businessId, userId, period.periodEnd),
    getVehicleMonthReport(db, businessId, period.id, undefined),
    listPartnerCashPositions(db, businessId),
    sumAllTimeEarnedForUser(db, businessId, userId),
  ]);

  const profitShareMinor = sumProfitShareForUser(vehicleMonth, userId);

  // The handler only reaches here after confirming `userId` is an active
  // member of `businessId` (`findBusinessMemberUserId`) — the same
  // membership `listPartnerCashPositions` scopes its own rows to — so a
  // matching row is guaranteed here, not a `?? 0n` guess at a missing
  // figure (W-56).
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- see the comment above
  const holdingMinor = cashPositions.find((p) => p.userId === userId)!.heldMinor;

  const balanceMinor =
    contributionsMinor +
    outOfPocketMinor +
    allTimeEarnedMinor -
    payoutTotals.payoutsMinor -
    payoutTotals.settlementsMinor;

  return {
    userId,
    displayName,
    period,
    putIn: {
      contributionsMinor: contributionsMinor as Minor,
      outOfPocketMinor: outOfPocketMinor as Minor,
    },
    takenOut: {
      payoutsMinor: payoutTotals.payoutsMinor as Minor,
      settlementsMinor: payoutTotals.settlementsMinor as Minor,
    },
    earned: {
      profitShareMinor: profitShareMinor as Minor,
      managementFeeMinor: managementFeeMinor as Minor,
    },
    holdingMinor: holdingMinor as Minor,
    balanceMinor: balanceMinor as Minor,
  };
}
