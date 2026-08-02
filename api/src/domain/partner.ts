import { newId, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { Writer } from "../db/client.js";
import {
  isExclusionViolation,
  isPeriodClosedViolation,
  isSharesNotFullViolation,
} from "../db/pg-error.js";
import {
  ManagementAgreementOverlapsError,
  OwnershipSharesInvalidError,
  PeriodClosedError,
} from "../errors/app-error.js";
import { resolvePeriodLinkage } from "../queries/accounting-period.js";
import {
  insertBankingEvent,
  insertCapitalContribution,
  insertManagementFeeAgreement,
  insertOwnershipShares,
  insertPartnerPayout,
  revokeManagementFeeAgreement,
  type OwnershipShareRow,
} from "../queries/partner.js";

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
    await insertOwnershipShares(writer, rows);
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
}

export interface RecordedCapitalContribution {
  contributionId: string;
}

/** F-1.3/UC-02/W-52: what he paid — the gap against what he owns (`ownership_share`) is read elsewhere (P11), never resolved here. */
export async function recordCapitalContribution(
  writer: Writer,
  input: RecordCapitalContributionInput,
): Promise<RecordedCapitalContribution> {
  const linkage = await resolvePeriodLinkage(writer, input.businessId, input.contributedOn);
  if (!linkage) throw new PeriodClosedError("No accounting period covers this business date yet");

  const contributionId = newId();
  try {
    await insertCapitalContribution(writer, {
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
    });
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    throw err;
  }

  return { contributionId };
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
    await insertManagementFeeAgreement(writer, {
      id: agreementId,
      vehicleId: input.vehicleId,
      managerUserId: input.managerUserId,
      // eslint-disable-next-line no-restricted-syntax -- allow: a genuine zero fee ("manage it for me, no charge") is the fact, not a stand-in for a missing one
      monthlyAmountMinor: input.monthlyFeeMinor ?? 0n,
      effectiveFrom: input.effectiveFrom,
    });
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
  await revokeManagementFeeAgreement(writer, agreementId, effectiveTo);
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
}

export interface RecordedBankingEvent {
  bankingEventId: string;
  discrepancyMinor: Minor;
}

/** F-7.4/UC-65/INV-23: the same money in a different place — never income, an expense, or a payout. `discrepancy_minor` is a generated column (DB, migration 0001); computed here too only to shape the response without a second round trip, never written. */
export async function recordBankingEvent(
  writer: Writer,
  input: RecordBankingEventInput,
): Promise<RecordedBankingEvent> {
  const linkage = await resolvePeriodLinkage(writer, input.businessId, input.bankedOn);
  if (!linkage) throw new PeriodClosedError("No accounting period covers this business date yet");

  const bankingEventId = newId();
  try {
    await insertBankingEvent(writer, {
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
    });
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    throw err;
  }

  return {
    bankingEventId,
    discrepancyMinor: (input.amountRecordedMinor - input.amountCountedMinor) as Minor,
  };
}

export interface RecordPartnerPayoutInput {
  businessId: string;
  userId: string;
  amountMinor: Minor;
  kind: "payout" | "partner_settlement";
  occurredOn: BusinessDate;
}

export interface RecordedPartnerPayout {
  payoutId: string;
}

/** F-7.2/UC-63: never a cost of the vehicle — a payout, or a settlement between partners that moves the current account, not the P&L. */
export async function recordPartnerPayout(
  writer: Writer,
  input: RecordPartnerPayoutInput,
): Promise<RecordedPartnerPayout> {
  const linkage = await resolvePeriodLinkage(writer, input.businessId, input.occurredOn);
  if (!linkage) throw new PeriodClosedError("No accounting period covers this business date yet");

  const payoutId = newId();
  try {
    await insertPartnerPayout(writer, {
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
    });
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    throw err;
  }

  return { payoutId };
}
