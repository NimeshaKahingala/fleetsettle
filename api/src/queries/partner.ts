import { and, eq } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import {
  bankingEvent,
  businessMember,
  capitalContribution,
  managementFeeAgreement,
  ownershipShare,
  partnerPayout,
  vehicle,
} from "../db/schema.js";

type WriteDb = Writer | Tx;
type ReadDb = Reader | Writer | Tx;

/** The tenancy check every partner-facing field needs: `user_id` here means a `business_member`, never bare `app_user.id` (CLAUDE.md → Tenancy). */
export async function findBusinessMemberUserId(
  db: ReadDb,
  businessId: string,
  userId: string,
): Promise<{ id: string } | undefined> {
  const rows = await db
    .select({ id: businessMember.userId })
    .from(businessMember)
    .where(and(eq(businessMember.businessId, businessId), eq(businessMember.userId, userId)))
    .limit(1);
  return rows[0];
}

export interface NewOwnershipShare {
  id: string;
  vehicleId: string;
  userId: string;
  shareBp: number;
  effectiveFrom: string;
}

/** UC-02/INV-16: one row per owner, one bulk insert (IG §2) — `assert_shares_total()` (migration 0001) is the truth that they sum to 10000 bp, not this function. */
export async function insertOwnershipShares(
  db: WriteDb,
  values: NewOwnershipShare[],
): Promise<void> {
  if (values.length === 0) return;
  await db.insert(ownershipShare).values(values);
}

export interface OwnershipShareRow {
  id: string;
  vehicleId: string;
  userId: string;
  shareBp: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface NewCapitalContribution {
  id: string;
  businessId: string;
  vehicleId?: string;
  userId: string;
  amountMinor: bigint;
  contributedOn: string;
  note?: string;
  postedPeriodId: string;
  belongsToPeriodId?: string;
}

/** UC-02/W-52: what he PAID — a claim against `ownership_share` (what he OWNS), never a bigger slice. */
export async function insertCapitalContribution(
  db: WriteDb,
  values: NewCapitalContribution,
): Promise<void> {
  await db.insert(capitalContribution).values(values);
}

export interface CapitalContributionRow {
  id: string;
  businessId: string;
  vehicleId: string | null;
  userId: string;
  amountMinor: bigint;
  contributedOn: string;
  note: string | null;
}

export interface NewManagementFeeAgreement {
  id: string;
  vehicleId: string;
  managerUserId: string;
  monthlyAmountMinor: bigint;
  effectiveFrom: string;
}

/** F-1.4/UC-03: sharing a vehicle with a manager — `management_fee_agreement` carries no `business_id` (scoped via `vehicle_id`, the same as `ownership_share`). */
export async function insertManagementFeeAgreement(
  db: WriteDb,
  values: NewManagementFeeAgreement,
): Promise<void> {
  await db.insert(managementFeeAgreement).values(values);
}

export interface ManagementFeeAgreementRow {
  id: string;
  vehicleId: string;
  managerUserId: string;
  monthlyAmountMinor: bigint;
  effectiveFrom: string;
  effectiveTo: string | null;
}

const MANAGEMENT_FEE_AGREEMENT_COLUMNS = {
  id: managementFeeAgreement.id,
  vehicleId: managementFeeAgreement.vehicleId,
  managerUserId: managementFeeAgreement.managerUserId,
  monthlyAmountMinor: managementFeeAgreement.monthlyAmountMinor,
  effectiveFrom: managementFeeAgreement.effectiveFrom,
  effectiveTo: managementFeeAgreement.effectiveTo,
};

/** No `business_id` column on this table — tenancy is proven by joining through `vehicle` (the same reason `vehicle_arrangement`/`ownership_share` need the join too). */
export async function findManagementFeeAgreementForBusiness(
  db: ReadDb,
  businessId: string,
  id: string,
): Promise<ManagementFeeAgreementRow | undefined> {
  const rows = await db
    .select(MANAGEMENT_FEE_AGREEMENT_COLUMNS)
    .from(managementFeeAgreement)
    .innerJoin(vehicle, eq(vehicle.id, managementFeeAgreement.vehicleId))
    .where(and(eq(managementFeeAgreement.id, id), eq(vehicle.businessId, businessId)))
    .limit(1);
  return rows[0];
}

/** F-1.4's "Revoke — access ends, everything they entered stays": sets `effective_to`, never deletes the row. */
export async function revokeManagementFeeAgreement(
  db: WriteDb,
  id: string,
  effectiveTo: string,
): Promise<void> {
  await db
    .update(managementFeeAgreement)
    .set({ effectiveTo })
    .where(eq(managementFeeAgreement.id, id));
}

export interface NewBankingEvent {
  id: string;
  businessId: string;
  fromUserId: string;
  amountRecordedMinor: bigint;
  amountCountedMinor: bigint;
  bankedOn: string;
  destination: string;
  reference?: string;
  discrepancyBearer?: "absorbed" | "unattributed";
  postedPeriodId: string;
  belongsToPeriodId?: string;
  createdBy?: string;
}

/** F-7.4/UC-65/INV-23: banking is the same money in a different place — not income, not an expense, not a payout (§1.5). */
export async function insertBankingEvent(db: WriteDb, values: NewBankingEvent): Promise<void> {
  await db.insert(bankingEvent).values(values);
}

export interface BankingEventRow {
  id: string;
  businessId: string;
  fromUserId: string;
  amountRecordedMinor: bigint;
  amountCountedMinor: bigint;
  bankedOn: string;
  destination: string;
  reference: string | null;
  discrepancyMinor: bigint;
  discrepancyBearer: "absorbed" | "unattributed" | "attributed_to_receipt" | null;
}

export interface NewPartnerPayout {
  id: string;
  businessId: string;
  userId: string;
  amountMinor: bigint;
  kind: "payout" | "partner_settlement";
  occurredOn: string;
  postedPeriodId: string;
  belongsToPeriodId?: string;
}

/** F-7.2/UC-63: never a cost of the vehicle — a payout, or a settlement between partners that moves the current account, not the P&L. */
export async function insertPartnerPayout(db: WriteDb, values: NewPartnerPayout): Promise<void> {
  await db.insert(partnerPayout).values(values);
}

export interface PartnerPayoutRow {
  id: string;
  businessId: string;
  userId: string;
  amountMinor: bigint;
  kind: "payout" | "partner_settlement";
  occurredOn: string;
}
