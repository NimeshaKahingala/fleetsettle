import { and, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
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

/**
 * The tenancy check every partner-facing field needs: `user_id` here means
 * an **active** `business_member`, never bare `app_user.id` (CLAUDE.md →
 * Tenancy). Filters `revoked_at IS NULL` — GAP-90: `listPartnerCashPositions`
 * already scopes to active members, and this guard disagreeing with it is
 * what let a revoked member's summary reach a `TypeError` instead of a 404.
 *
 * GAP-121: `role` is returned, not just existence — membership alone does
 * not mean "partner". A caller writing ownership, capital or a payout must
 * check the role is `owner`/`owner_manager` itself; `payment.ts`'s own
 * `partyType: "partner"` deliberately does not (UC-65 lets any active
 * member hold business cash), which is why this stays one shared query
 * rather than a role-baked-in variant.
 */
export async function findBusinessMemberUserId(
  db: ReadDb,
  businessId: string,
  userId: string,
): Promise<{ id: string; role: string } | undefined> {
  const rows = await db
    .select({ id: businessMember.userId, role: businessMember.role })
    .from(businessMember)
    .where(
      and(
        eq(businessMember.businessId, businessId),
        eq(businessMember.userId, userId),
        isNull(businessMember.revokedAt),
      ),
    )
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
  replacesId?: string;
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
  voidedAt: string | null;
  replacesId: string | null;
}

const CAPITAL_CONTRIBUTION_COLUMNS = {
  id: capitalContribution.id,
  businessId: capitalContribution.businessId,
  vehicleId: capitalContribution.vehicleId,
  userId: capitalContribution.userId,
  amountMinor: capitalContribution.amountMinor,
  contributedOn: capitalContribution.contributedOn,
  note: capitalContribution.note,
  voidedAt: capitalContribution.voidedAt,
  replacesId: capitalContribution.replacesId,
};

/** GAP-12/A9b: the void endpoint's own lookup — scoped by `businessId` (CLAUDE.md → Tenancy). */
export async function findCapitalContributionForBusiness(
  db: ReadDb,
  businessId: string,
  id: string,
): Promise<CapitalContributionRow | undefined> {
  const rows = await db
    .select(CAPITAL_CONTRIBUTION_COLUMNS)
    .from(capitalContribution)
    .where(and(eq(capitalContribution.id, id), eq(capitalContribution.businessId, businessId)))
    .limit(1);
  return rows[0];
}

/** F-8.5/UC-96/W-50: void, never delete — the `voidExpense` shape (`domain/expense.ts`). No child rows to unwind: a capital contribution is a standalone fact about what a partner paid in, nothing else derives from it. */
export async function voidCapitalContributionRow(
  db: WriteDb,
  id: string,
  values: { voidedReason: string; voidedBy: string },
): Promise<{ voidedAt: string } | undefined> {
  const rows = await db
    .update(capitalContribution)
    .set({ voidedAt: sql`now()`, voidedReason: values.voidedReason, voidedBy: values.voidedBy })
    .where(and(eq(capitalContribution.id, id), isNull(capitalContribution.voidedAt)))
    .returning({ voidedAt: capitalContribution.voidedAt });
  return rows[0] as { voidedAt: string } | undefined;
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
  replacesId?: string;
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
  voidedAt: string | null;
  replacesId: string | null;
}

const BANKING_EVENT_COLUMNS = {
  id: bankingEvent.id,
  businessId: bankingEvent.businessId,
  fromUserId: bankingEvent.fromUserId,
  amountRecordedMinor: bankingEvent.amountRecordedMinor,
  amountCountedMinor: bankingEvent.amountCountedMinor,
  bankedOn: bankingEvent.bankedOn,
  destination: bankingEvent.destination,
  reference: bankingEvent.reference,
  discrepancyMinor: bankingEvent.discrepancyMinor,
  discrepancyBearer: bankingEvent.discrepancyBearer,
  voidedAt: bankingEvent.voidedAt,
  replacesId: bankingEvent.replacesId,
};

/** GAP-12/A9b: the void endpoint's own lookup — scoped by `businessId` (CLAUDE.md → Tenancy). */
export async function findBankingEventForBusiness(
  db: ReadDb,
  businessId: string,
  id: string,
): Promise<BankingEventRow | undefined> {
  const rows = await db
    .select(BANKING_EVENT_COLUMNS)
    .from(bankingEvent)
    .where(and(eq(bankingEvent.id, id), eq(bankingEvent.businessId, businessId)))
    .limit(1);
  return rows[0] as BankingEventRow | undefined;
}

/** F-8.5/UC-96/W-50: void, never delete. No child rows to unwind — INV-23's unattributable shortfall attaches here directly, and voiding removes the whole event, shortfall included. */
export async function voidBankingEventRow(
  db: WriteDb,
  id: string,
  values: { voidedReason: string; voidedBy: string },
): Promise<{ voidedAt: string } | undefined> {
  const rows = await db
    .update(bankingEvent)
    .set({ voidedAt: sql`now()`, voidedReason: values.voidedReason, voidedBy: values.voidedBy })
    .where(and(eq(bankingEvent.id, id), isNull(bankingEvent.voidedAt)))
    .returning({ voidedAt: bankingEvent.voidedAt });
  return rows[0] as { voidedAt: string } | undefined;
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
  replacesId?: string;
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
  voidedAt: string | null;
  replacesId: string | null;
}

const PARTNER_PAYOUT_COLUMNS = {
  id: partnerPayout.id,
  businessId: partnerPayout.businessId,
  userId: partnerPayout.userId,
  amountMinor: partnerPayout.amountMinor,
  kind: partnerPayout.kind,
  occurredOn: partnerPayout.occurredOn,
  voidedAt: partnerPayout.voidedAt,
  replacesId: partnerPayout.replacesId,
};

/** GAP-12/A9b: the void endpoint's own lookup — scoped by `businessId` (CLAUDE.md → Tenancy). */
export async function findPartnerPayoutForBusiness(
  db: ReadDb,
  businessId: string,
  id: string,
): Promise<PartnerPayoutRow | undefined> {
  const rows = await db
    .select(PARTNER_PAYOUT_COLUMNS)
    .from(partnerPayout)
    .where(and(eq(partnerPayout.id, id), eq(partnerPayout.businessId, businessId)))
    .limit(1);
  return rows[0] as PartnerPayoutRow | undefined;
}

/** F-8.5/UC-96/W-50: void, never delete. No child rows to unwind — a payout or partner settlement is a standalone fact about cash that moved. */
export async function voidPartnerPayoutRow(
  db: WriteDb,
  id: string,
  values: { voidedReason: string; voidedBy: string },
): Promise<{ voidedAt: string } | undefined> {
  const rows = await db
    .update(partnerPayout)
    .set({ voidedAt: sql`now()`, voidedReason: values.voidedReason, voidedBy: values.voidedBy })
    .where(and(eq(partnerPayout.id, id), isNull(partnerPayout.voidedAt)))
    .returning({ voidedAt: partnerPayout.voidedAt });
  return rows[0] as { voidedAt: string } | undefined;
}

// ---------------------------------------------------------------------------
// A2/GAP-9/GAP-31: the five reads. Nothing about a partner has been
// renderable before this — every route above is POST-only.
// ---------------------------------------------------------------------------

export interface OwnershipShareListFilters {
  vehicleId?: string;
}

/**
 * A2: the currently active split — `effective_to IS NULL`. Safe *because*
 * of `assert_shares_total` (migration 0001, INV-16), not despite it: that
 * deferred trigger sums every row whose date range contains a given date
 * and rejects anything but exactly 10000bp, so two open-ended
 * (`effective_to IS NULL`) sets for the same vehicle can never coexist —
 * inserting a second one without first closing the first's range always
 * fails (every row's range is `[effective_from, ∞)`, which overlaps any
 * later `effective_from` outright). At most one open set per vehicle is
 * therefore structural, not a convention this query has to defend itself
 * against — the same filter `findOwnershipSharesAsOf` (queries/reports.ts)
 * already uses for "as of a date," simplified here for "as of now."
 *
 * No `business_id` column (same as `management_fee_agreement` below) —
 * tenancy is the `innerJoin(vehicle)`.
 */
export async function listOwnershipShares(
  db: ReadDb,
  businessId: string,
  filters: OwnershipShareListFilters = {},
): Promise<OwnershipShareRow[]> {
  return db
    .select({
      id: ownershipShare.id,
      vehicleId: ownershipShare.vehicleId,
      userId: ownershipShare.userId,
      shareBp: ownershipShare.shareBp,
      effectiveFrom: ownershipShare.effectiveFrom,
      effectiveTo: ownershipShare.effectiveTo,
    })
    .from(ownershipShare)
    .innerJoin(vehicle, eq(vehicle.id, ownershipShare.vehicleId))
    .where(
      and(
        eq(vehicle.businessId, businessId),
        isNull(ownershipShare.effectiveTo),
        filters.vehicleId !== undefined
          ? eq(ownershipShare.vehicleId, filters.vehicleId)
          : undefined,
      ),
    )
    .orderBy(ownershipShare.vehicleId, ownershipShare.userId);
}

export interface CapitalContributionListFilters {
  userId?: string;
  vehicleId?: string;
}

/** A2: newest-contributed-first, `business_id`-scoped directly (unlike shares/agreements, this table carries its own). */
export async function listCapitalContributions(
  db: ReadDb,
  businessId: string,
  filters: CapitalContributionListFilters = {},
): Promise<CapitalContributionRow[]> {
  return db
    .select({
      id: capitalContribution.id,
      businessId: capitalContribution.businessId,
      vehicleId: capitalContribution.vehicleId,
      userId: capitalContribution.userId,
      amountMinor: capitalContribution.amountMinor,
      contributedOn: capitalContribution.contributedOn,
      note: capitalContribution.note,
      voidedAt: capitalContribution.voidedAt,
      replacesId: capitalContribution.replacesId,
    })
    .from(capitalContribution)
    .where(
      and(
        eq(capitalContribution.businessId, businessId),
        filters.userId !== undefined ? eq(capitalContribution.userId, filters.userId) : undefined,
        filters.vehicleId !== undefined
          ? eq(capitalContribution.vehicleId, filters.vehicleId)
          : undefined,
      ),
    )
    .orderBy(desc(capitalContribution.contributedOn));
}

export interface ManagementFeeAgreementListFilters {
  vehicleId?: string;
  managerUserId?: string;
}

/** A2: **every agreement, revoked ones included** — F-1.4's "Revoke — access ends, everything they entered stays" means the read must return them, not filter them out. */
export async function listManagementFeeAgreements(
  db: ReadDb,
  businessId: string,
  filters: ManagementFeeAgreementListFilters = {},
): Promise<ManagementFeeAgreementRow[]> {
  return db
    .select(MANAGEMENT_FEE_AGREEMENT_COLUMNS)
    .from(managementFeeAgreement)
    .innerJoin(vehicle, eq(vehicle.id, managementFeeAgreement.vehicleId))
    .where(
      and(
        eq(vehicle.businessId, businessId),
        filters.vehicleId !== undefined
          ? eq(managementFeeAgreement.vehicleId, filters.vehicleId)
          : undefined,
        filters.managerUserId !== undefined
          ? eq(managementFeeAgreement.managerUserId, filters.managerUserId)
          : undefined,
      ),
    )
    .orderBy(managementFeeAgreement.vehicleId, desc(managementFeeAgreement.effectiveFrom));
}

export interface BankingEventListFilters {
  userId?: string;
}

/**
 * A2: newest-banked-first. Voided rows are not filtered here, deliberately —
 * W-50's convention is a voided record stays visible, struck through, with
 * its reason, the same treatment `listExpensesForVehicle` already gives a
 * voided expense. **Not yet returning `voidedAt`/`voidedReason` on the wire**
 * — this query and `voidBankingEventRow` (GAP-12/A9b) landed together, but
 * teaching this list's response schema and the client to render the strike-
 * through is its own item, the same shape GAP-81 already is for `voidExpense`
 * (a working backend with no caller yet).
 */
export async function listBankingEvents(
  db: ReadDb,
  businessId: string,
  filters: BankingEventListFilters = {},
): Promise<BankingEventRow[]> {
  const rows = await db
    .select({
      id: bankingEvent.id,
      businessId: bankingEvent.businessId,
      fromUserId: bankingEvent.fromUserId,
      amountRecordedMinor: bankingEvent.amountRecordedMinor,
      amountCountedMinor: bankingEvent.amountCountedMinor,
      bankedOn: bankingEvent.bankedOn,
      destination: bankingEvent.destination,
      reference: bankingEvent.reference,
      discrepancyBearer: bankingEvent.discrepancyBearer,
      voidedAt: bankingEvent.voidedAt,
      replacesId: bankingEvent.replacesId,
    })
    .from(bankingEvent)
    .where(
      and(
        eq(bankingEvent.businessId, businessId),
        filters.userId !== undefined ? eq(bankingEvent.fromUserId, filters.userId) : undefined,
      ),
    )
    .orderBy(desc(bankingEvent.bankedOn));
  // `discrepancy_minor` is a GENERATED ALWAYS column (migration 0001) —
  // computed here from the two real columns, the same way
  // `recordBankingEvent` (domain/partner.ts) computes it on write, rather
  // than trusting Drizzle's nullable type for a column Postgres never
  // actually leaves null.
  return rows.map((r) => ({
    ...r,
    discrepancyMinor: r.amountRecordedMinor - r.amountCountedMinor,
    discrepancyBearer: r.discrepancyBearer as BankingEventRow["discrepancyBearer"],
  }));
}

export interface PartnerPayoutListFilters {
  userId?: string;
  kind?: "payout" | "partner_settlement";
}

/** A2: newest-occurred-first. Same voided-row note as `listBankingEvents` above. */
export async function listPartnerPayouts(
  db: ReadDb,
  businessId: string,
  filters: PartnerPayoutListFilters = {},
): Promise<PartnerPayoutRow[]> {
  const rows = await db
    .select({
      id: partnerPayout.id,
      businessId: partnerPayout.businessId,
      userId: partnerPayout.userId,
      amountMinor: partnerPayout.amountMinor,
      kind: partnerPayout.kind,
      occurredOn: partnerPayout.occurredOn,
      voidedAt: partnerPayout.voidedAt,
      replacesId: partnerPayout.replacesId,
    })
    .from(partnerPayout)
    .where(
      and(
        eq(partnerPayout.businessId, businessId),
        filters.userId !== undefined ? eq(partnerPayout.userId, filters.userId) : undefined,
        filters.kind !== undefined ? eq(partnerPayout.kind, filters.kind) : undefined,
      ),
    )
    .orderBy(desc(partnerPayout.occurredOn));
  return rows.map((r) => ({ ...r, kind: r.kind as PartnerPayoutRow["kind"] }));
}

/** A2/UC-67 "put in": all-time, never reset — a contribution from years ago is still something this partner put in. */
export async function sumCapitalContributionsForUser(
  db: ReadDb,
  businessId: string,
  userId: string,
): Promise<bigint> {
  const rows = await db
    .select({ amountMinor: capitalContribution.amountMinor })
    .from(capitalContribution)
    .where(
      and(
        eq(capitalContribution.businessId, businessId),
        eq(capitalContribution.userId, userId),
        isNull(capitalContribution.voidedAt),
      ),
    );
  return rows.reduce((sum, row) => sum + row.amountMinor, 0n);
}

export interface PartnerPayoutTotals {
  payoutsMinor: bigint;
  settlementsMinor: bigint;
}

/** A2/UC-67 "taken out": all-time — a payout permanently reduces what this partner is owed, it does not reset month to month. */
export async function sumPartnerPayoutsForUser(
  db: ReadDb,
  businessId: string,
  userId: string,
): Promise<PartnerPayoutTotals> {
  const rows = await db
    .select({ amountMinor: partnerPayout.amountMinor, kind: partnerPayout.kind })
    .from(partnerPayout)
    .where(
      and(
        eq(partnerPayout.businessId, businessId),
        eq(partnerPayout.userId, userId),
        isNull(partnerPayout.voidedAt),
      ),
    );
  let payoutsMinor = 0n;
  let settlementsMinor = 0n;
  for (const row of rows) {
    if (row.kind === "payout") payoutsMinor += row.amountMinor;
    else settlementsMinor += row.amountMinor;
  }
  return { payoutsMinor, settlementsMinor };
}

/**
 * A2/UC-67/W-53 "earned: management fee" — summed directly from
 * `management_fee_agreement.monthly_amount_minor` for every agreement
 * active on `asOfDate`, deliberately **not** read from
 * `obligation WHERE kind = 'management_fee'` even though A10a
 * (domain/management-fee.ts) now populates that kind for real. Kept as the
 * agreement-table read on purpose: this figure is a manager's *earned*
 * total as of any date within a period (`getPartnerSummary` calls it once
 * per period in `sumAllTimeEarnedForUser`'s loop), while the generator only
 * ever posts one obligation per agreement per *period*, dated to the
 * period's start — the two are not the same shape, and switching this read
 * to the obligation table is a real question for whoever revisits it, not a
 * side effect of A10a landing.
 */
export async function sumManagementFeeAsOfDate(
  db: ReadDb,
  businessId: string,
  managerUserId: string,
  asOfDate: string,
): Promise<bigint> {
  const rows = await db
    .select({ monthlyAmountMinor: managementFeeAgreement.monthlyAmountMinor })
    .from(managementFeeAgreement)
    .innerJoin(vehicle, eq(vehicle.id, managementFeeAgreement.vehicleId))
    .where(
      and(
        eq(vehicle.businessId, businessId),
        eq(managementFeeAgreement.managerUserId, managerUserId),
        lte(managementFeeAgreement.effectiveFrom, asOfDate),
        or(
          isNull(managementFeeAgreement.effectiveTo),
          gte(managementFeeAgreement.effectiveTo, asOfDate),
        ),
      ),
    );
  return rows.reduce((sum, row) => sum + row.monthlyAmountMinor, 0n);
}

export interface ManagementFeeAgreementHistoryRow {
  effectiveFrom: string;
  effectiveTo: string | null;
  monthlyAmountMinor: bigint;
}

/**
 * GAP-145: `sumManagementFeeAsOfDate`'s own filter, minus `asOfDate` — every
 * agreement this manager has ever held in this business, one query, for
 * `sumAllTimeEarnedForUser` to evaluate per period in memory rather than
 * calling `sumManagementFeeAsOfDate` once per accounting period.
 */
export async function listManagementFeeAgreementHistoryForManager(
  db: ReadDb,
  businessId: string,
  managerUserId: string,
): Promise<ManagementFeeAgreementHistoryRow[]> {
  return db
    .select({
      effectiveFrom: managementFeeAgreement.effectiveFrom,
      effectiveTo: managementFeeAgreement.effectiveTo,
      monthlyAmountMinor: managementFeeAgreement.monthlyAmountMinor,
    })
    .from(managementFeeAgreement)
    .innerJoin(vehicle, eq(vehicle.id, managementFeeAgreement.vehicleId))
    .where(
      and(
        eq(vehicle.businessId, businessId),
        eq(managementFeeAgreement.managerUserId, managerUserId),
      ),
    );
}

export interface ManagementFeeAgreementForGeneration {
  id: string;
  vehicleId: string;
  managerUserId: string;
  monthlyAmountMinor: bigint;
}

/** A10a/GAP-39/W-53: every agreement effective on `asOfDate` (a period's own `period_start`), unscoped by manager — the generator raises one obligation per agreement, not per manager. The same effective-dated filter `sumManagementFeeAsOfDate` above uses, without narrowing to one `managerUserId`. */
export async function listManagementFeeAgreementsEffectiveAsOf(
  db: ReadDb,
  businessId: string,
  asOfDate: string,
): Promise<ManagementFeeAgreementForGeneration[]> {
  return db
    .select({
      id: managementFeeAgreement.id,
      vehicleId: managementFeeAgreement.vehicleId,
      managerUserId: managementFeeAgreement.managerUserId,
      monthlyAmountMinor: managementFeeAgreement.monthlyAmountMinor,
    })
    .from(managementFeeAgreement)
    .innerJoin(vehicle, eq(vehicle.id, managementFeeAgreement.vehicleId))
    .where(
      and(
        eq(vehicle.businessId, businessId),
        lte(managementFeeAgreement.effectiveFrom, asOfDate),
        or(
          isNull(managementFeeAgreement.effectiveTo),
          gte(managementFeeAgreement.effectiveTo, asOfDate),
        ),
      ),
    );
}
