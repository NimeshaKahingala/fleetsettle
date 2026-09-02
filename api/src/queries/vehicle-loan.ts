import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import { loanPayment, vehicle, vehicleLoan } from "../db/schema.js";

type WriteDb = Writer | Tx;
type ReadDb = Reader | Writer | Tx;

export interface NewVehicleLoan {
  id: string;
  vehicleId: string;
  lender: string;
  liabilityOwner?: string;
  principalMinor: bigint;
  totalRepayableMinor: bigint;
  termMonths: number;
  monthlyPaymentMinor?: bigint;
  paymentDay?: number;
  downPaymentMinor?: bigint;
  downPaymentByUserId?: string;
  startedOn: string;
}

/** GAP-185/F-12.1: scoped through `vehicleId`, no `businessId` of its own — the same shape `ownershipShare`/`managementFeeAgreement` already carry. */
export async function insertVehicleLoan(db: WriteDb, values: NewVehicleLoan): Promise<void> {
  await db.insert(vehicleLoan).values(values);
}

export interface VehicleLoanRow {
  id: string;
  vehicleId: string;
  lender: string;
  liabilityOwner: string | null;
  principalMinor: bigint;
  totalRepayableMinor: bigint;
  termMonths: number;
  monthlyPaymentMinor: bigint | null;
  paymentDay: number | null;
  amortisationMethod: string;
  downPaymentMinor: bigint | null;
  downPaymentByUserId: string | null;
  startedOn: string;
  closedOn: string | null;
}

const VEHICLE_LOAN_COLUMNS = {
  id: vehicleLoan.id,
  vehicleId: vehicleLoan.vehicleId,
  lender: vehicleLoan.lender,
  liabilityOwner: vehicleLoan.liabilityOwner,
  principalMinor: vehicleLoan.principalMinor,
  totalRepayableMinor: vehicleLoan.totalRepayableMinor,
  termMonths: vehicleLoan.termMonths,
  monthlyPaymentMinor: vehicleLoan.monthlyPaymentMinor,
  paymentDay: vehicleLoan.paymentDay,
  amortisationMethod: vehicleLoan.amortisationMethod,
  downPaymentMinor: vehicleLoan.downPaymentMinor,
  downPaymentByUserId: vehicleLoan.downPaymentByUserId,
  startedOn: vehicleLoan.startedOn,
  closedOn: vehicleLoan.closedOn,
};

/** No `businessId` column on `vehicle_loan` — tenancy is proven by joining through `vehicle`, the same reason `managementFeeAgreement`'s own lookup needs the join (CLAUDE.md → Tenancy). */
/**
 * `forUpdate` (GAP-185/Gitar PR #130 review): `recordLoanPayment` and
 * `settleVehicleLoan` both read every live payment and refuse an
 * overpayment, but nothing serialised two concurrent calls against the
 * *same* loan — the same "lock must be on the parent" shape GAP-178's
 * deposit double-draw fix already established elsewhere in this schema.
 * Locking `loan_payment` rows would miss a loan with no payments yet (a
 * loan on its very first payment has nothing to lock); the loan row itself
 * is the one thing guaranteed to exist and to be shared by every payment
 * against it.
 */
export async function findVehicleLoanForBusiness(
  db: ReadDb,
  businessId: string,
  loanId: string,
  forUpdate = false,
): Promise<VehicleLoanRow | undefined> {
  const query = db
    .select(VEHICLE_LOAN_COLUMNS)
    .from(vehicleLoan)
    .innerJoin(vehicle, eq(vehicle.id, vehicleLoan.vehicleId))
    .where(and(eq(vehicleLoan.id, loanId), eq(vehicle.businessId, businessId)))
    .limit(1);
  // `of: vehicleLoan` — this query joins `vehicle` only to prove tenancy;
  // locking it too would contend with unrelated vehicle writes (a service
  // interval edit, an arrangement change) that have nothing to do with a
  // loan payment.
  const rows = await (forUpdate ? query.for("update", { of: vehicleLoan }) : query);
  return rows[0];
}

/** F-1.5-style vehicle-scoped list — every loan against this vehicle, newest-started-first, open and closed alike. */
export async function listVehicleLoansForVehicle(
  db: ReadDb,
  businessId: string,
  vehicleId: string,
): Promise<VehicleLoanRow[]> {
  const rows = await db
    .select(VEHICLE_LOAN_COLUMNS)
    .from(vehicleLoan)
    .innerJoin(vehicle, eq(vehicle.id, vehicleLoan.vehicleId))
    .where(and(eq(vehicleLoan.vehicleId, vehicleId), eq(vehicle.businessId, businessId)))
    .orderBy(desc(vehicleLoan.startedOn));
  return rows;
}

/** GAP-186/UC-109: every open loan across the whole business — no vehicle scope — for summing instalments due into the distributable-cash report. */
export async function listOpenVehicleLoansForBusiness(
  db: ReadDb,
  businessId: string,
): Promise<VehicleLoanRow[]> {
  const rows = await db
    .select(VEHICLE_LOAN_COLUMNS)
    .from(vehicleLoan)
    .innerJoin(vehicle, eq(vehicle.id, vehicleLoan.vehicleId))
    .where(and(isNull(vehicleLoan.closedOn), eq(vehicle.businessId, businessId)));
  return rows;
}

/** F-12.3: settle-and-close sets it; voiding a settlement clears it again, reopening the loan (INV-43's own reversal). */
export async function setVehicleLoanClosedOn(
  db: WriteDb,
  loanId: string,
  closedOn: string | null,
): Promise<void> {
  await db.update(vehicleLoan).set({ closedOn }).where(eq(vehicleLoan.id, loanId));
}

export interface NewLoanPayment {
  id: string;
  businessId: string;
  loanId: string;
  amountMinor: bigint;
  paidOn: string;
  isSettlement?: boolean;
  waivedMinor?: bigint;
  note?: string;
  postedPeriodId: string;
  belongsToPeriodId?: string;
  replacesId?: string;
  expenseId?: string;
  partnerPayoutId?: string;
}

/** A money table (DM §10's conventions apply). */
export async function insertLoanPayment(db: WriteDb, values: NewLoanPayment): Promise<void> {
  await db.insert(loanPayment).values(values);
}

export interface LoanPaymentRow {
  id: string;
  businessId: string;
  loanId: string;
  amountMinor: bigint;
  paidOn: string;
  isSettlement: boolean;
  waivedMinor: bigint;
  note: string | null;
  postedPeriodId: string;
  belongsToPeriodId: string | null;
  voidedAt: string | null;
  voidedReason: string | null;
  replacesId: string | null;
  expenseId: string | null;
  partnerPayoutId: string | null;
}

const LOAN_PAYMENT_COLUMNS = {
  id: loanPayment.id,
  businessId: loanPayment.businessId,
  loanId: loanPayment.loanId,
  amountMinor: loanPayment.amountMinor,
  paidOn: loanPayment.paidOn,
  isSettlement: loanPayment.isSettlement,
  waivedMinor: loanPayment.waivedMinor,
  note: loanPayment.note,
  postedPeriodId: loanPayment.postedPeriodId,
  belongsToPeriodId: loanPayment.belongsToPeriodId,
  voidedAt: loanPayment.voidedAt,
  voidedReason: loanPayment.voidedReason,
  replacesId: loanPayment.replacesId,
  expenseId: loanPayment.expenseId,
  partnerPayoutId: loanPayment.partnerPayoutId,
};

/** Scoped by `businessId` — the same tenancy shape every P2+ read gets. */
export async function findLoanPaymentForBusiness(
  db: ReadDb,
  businessId: string,
  paymentId: string,
): Promise<LoanPaymentRow | undefined> {
  const rows = await db
    .select(LOAN_PAYMENT_COLUMNS)
    .from(loanPayment)
    .where(and(eq(loanPayment.id, paymentId), eq(loanPayment.businessId, businessId)))
    .limit(1);
  return rows[0];
}

/**
 * F-12.2/F-12.4: every live payment against this loan, oldest first —
 * "remaining to pay" and "behind by" are both derived from this sum, never
 * stored (DM §4.4).
 *
 * N7 (evaluation, GAP-190): `businessId` filters here directly rather than
 * relying only on the caller having already resolved `loanId` through
 * `findVehicleLoanForBusiness` — `loan_payment` carries its own
 * `business_id` (unlike `vehicle_loan`, which joins through `vehicle`), so
 * there is no reason not to use it. Every existing call site already had
 * `businessId` in scope.
 *
 * M-6, 31 Aug 2026: `orderBy` tie-broken on `id` (UUIDv7, so insertion
 * order) — same reasoning `queries/obligation.ts`'s own three fixes carry:
 * two payments dated the same day would otherwise render in whatever order
 * Postgres happens to return them.
 */
export async function listLivePaymentsForLoan(
  db: ReadDb,
  businessId: string,
  loanId: string,
): Promise<LoanPaymentRow[]> {
  const rows = await db
    .select(LOAN_PAYMENT_COLUMNS)
    .from(loanPayment)
    .where(
      and(
        eq(loanPayment.loanId, loanId),
        eq(loanPayment.businessId, businessId),
        isNull(loanPayment.voidedAt),
      ),
    )
    .orderBy(loanPayment.paidOn, loanPayment.id);
  return rows;
}

/**
 * F-12.2's own list: every payment ever recorded against this loan, oldest
 * first, live and voided alike (W-50: never deleted) — the read a manager
 * needs to find one to void.
 *
 * M-6/NL-2, 31 Aug 2026: gains `businessId` (defence in depth — its own
 * caller, `listLoanPaymentsHandler`, already resolves `loanId` through
 * `findVehicleLoanForBusiness` first, the same pattern this file's own N7
 * comment above already argues for) and the same `id` tie-break as its
 * sibling above.
 */
export async function listLoanPaymentsForLoan(
  db: ReadDb,
  businessId: string,
  loanId: string,
): Promise<LoanPaymentRow[]> {
  const rows = await db
    .select(LOAN_PAYMENT_COLUMNS)
    .from(loanPayment)
    .where(and(eq(loanPayment.loanId, loanId), eq(loanPayment.businessId, businessId)))
    .orderBy(loanPayment.paidOn, loanPayment.id);
  return rows;
}

/** F-8.5/UC-96/W-50: void, never delete — the `voidExpense` shape. */
export async function voidLoanPaymentRow(
  db: WriteDb,
  paymentId: string,
  values: { voidedReason: string; voidedBy: string },
): Promise<{ voidedAt: string } | undefined> {
  const rows = await db
    .update(loanPayment)
    .set({ voidedAt: sql`now()`, voidedReason: values.voidedReason, voidedBy: values.voidedBy })
    .where(and(eq(loanPayment.id, paymentId), isNull(loanPayment.voidedAt)))
    .returning({ voidedAt: loanPayment.voidedAt });
  return rows[0] as { voidedAt: string } | undefined;
}
