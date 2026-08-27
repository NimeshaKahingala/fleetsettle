import {
  add,
  addCalendarMonths,
  newId,
  split,
  subtract,
  type BusinessDate,
  type Minor,
} from "@fleetsettle/shared";
import type { Reader, Writer } from "../db/client.js";
import { isPeriodClosedViolation, isUniqueViolation } from "../db/pg-error.js";
import {
  LoanClosedError,
  LoanPaymentAlreadyVoidedError,
  LoanPaymentExceedsRemainingError,
  NotFoundError,
  PeriodClosedError,
  ReplacesTargetAlreadyReplacedError,
  ReplacesTargetNotVoidedError,
  ValidationError,
} from "../errors/app-error.js";
import { resolvePeriodLinkage } from "../queries/accounting-period.js";
import { insertCapitalContribution } from "../queries/partner.js";
import { insertExpense, voidExpenseRow } from "../queries/expense.js";
import {
  insertPartnerPayout,
  voidPartnerPayoutRow,
  type NewPartnerPayout,
} from "../queries/partner.js";
import { setVehiclePurchaseCost } from "../queries/vehicle.js";
import {
  findLoanPaymentForBusiness,
  findVehicleLoanForBusiness,
  insertLoanPayment,
  insertVehicleLoan,
  listLivePaymentsForLoan,
  listOpenVehicleLoansForBusiness,
  setVehicleLoanClosedOn,
  voidLoanPaymentRow,
  type LoanPaymentRow,
  type VehicleLoanRow,
} from "../queries/vehicle-loan.js";

export interface RecordVehicleLoanInput {
  businessId: string;
  vehicleId: string;
  lender: string;
  principalMinor: Minor;
  totalRepayableMinor: Minor;
  termMonths: number;
  monthlyPaymentMinor?: Minor;
  paymentDay?: number;
  downPaymentMinor?: Minor;
  downPaymentByUserId?: string;
  liabilityOwnerUserId?: string;
  purchaseCostMinor?: Minor;
  startedOn: BusinessDate;
}

export interface RecordedVehicleLoan {
  loanId: string;
}

/**
 * F-12.1/UC-106, W-52/W-68/W-70. One transaction: the loan itself, an
 * optional down-payment `capital_contribution` (exactly one named owner,
 * never split), and an optional `purchase_cost_minor` side-write onto the
 * vehicle — all three are level 2+ (U-2) and any may be absent.
 */
export async function recordVehicleLoan(
  writer: Writer,
  input: RecordVehicleLoanInput,
): Promise<RecordedVehicleLoan> {
  const loanId = newId();
  try {
    await writer.transaction(async (tx) => {
      await insertVehicleLoan(tx, {
        id: loanId,
        vehicleId: input.vehicleId,
        lender: input.lender,
        ...(input.liabilityOwnerUserId !== undefined
          ? { liabilityOwner: input.liabilityOwnerUserId }
          : {}),
        principalMinor: input.principalMinor,
        totalRepayableMinor: input.totalRepayableMinor,
        termMonths: input.termMonths,
        ...(input.monthlyPaymentMinor !== undefined
          ? { monthlyPaymentMinor: input.monthlyPaymentMinor }
          : {}),
        ...(input.paymentDay !== undefined ? { paymentDay: input.paymentDay } : {}),
        ...(input.downPaymentMinor !== undefined
          ? { downPaymentMinor: input.downPaymentMinor }
          : {}),
        ...(input.downPaymentByUserId !== undefined
          ? { downPaymentByUserId: input.downPaymentByUserId }
          : {}),
        startedOn: input.startedOn,
      });

      if (input.purchaseCostMinor !== undefined) {
        await setVehiclePurchaseCost(tx, input.vehicleId, input.purchaseCostMinor);
      }

      // W-52/UC-106: a down payment writes exactly one capital_contribution,
      // by exactly one named owner, at registration — never split.
      if (input.downPaymentMinor !== undefined && input.downPaymentByUserId !== undefined) {
        const linkage = await resolvePeriodLinkage(tx, input.businessId, input.startedOn);
        if (!linkage) {
          throw new PeriodClosedError("No accounting period covers this business date yet");
        }
        await insertCapitalContribution(tx, {
          id: newId(),
          businessId: input.businessId,
          vehicleId: input.vehicleId,
          userId: input.downPaymentByUserId,
          amountMinor: input.downPaymentMinor,
          contributedOn: input.startedOn,
          note: `Down payment on a vehicle loan from ${input.lender}`,
          postedPeriodId: linkage.postedPeriodId,
          ...(linkage.belongsToPeriodId !== null
            ? { belongsToPeriodId: linkage.belongsToPeriodId }
            : {}),
        });
      }
    });
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    throw err;
  }
  return { loanId };
}

/**
 * F-12.1's own fixed ratio (W-68): every payment splits `principal :
 * finance = principalMinor : (totalRepayableMinor − principalMinor)`,
 * through the shared largest-remainder `split()` so the parts always add
 * back (INV-45) — independently per payment, never a stored schedule.
 */
function splitPayment(
  loan: VehicleLoanRow,
  amountMinor: Minor,
): { principal: Minor; finance: Minor } {
  const financeTotal = subtract(loan.totalRepayableMinor as Minor, loan.principalMinor as Minor);
  const [principal, finance] = split(amountMinor, [loan.principalMinor, financeTotal]);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- split() with two weights always returns two parts
  return { principal: principal!, finance: finance! };
}

/** F-12.4: "remaining to pay" — total repayable minus the full amount of every live payment, the figure on the lender's letter. Never re-derives principal/finance for this one. */
function remainingToPay(loan: VehicleLoanRow, livePayments: readonly LoanPaymentRow[]): Minor {
  const paid = livePayments.reduce((sum, p) => add(sum, p.amountMinor as Minor), 0n as Minor);
  const remaining = subtract(loan.totalRepayableMinor as Minor, paid);
  return (remaining < 0n ? 0n : remaining) as Minor;
}

/**
 * F-12.4: "instalments due since the loan started minus everything paid."
 * One subtraction, deliberately soft (spec: "not modelled: which specific
 * month was missed"). `null` when there is no monthly figure to compare
 * against — W-56, never a fabricated zero. Once closed, nothing further can
 * come due.
 */
function behindBy(
  loan: VehicleLoanRow,
  livePayments: readonly LoanPaymentRow[],
  today: BusinessDate,
): Minor | null {
  if (loan.monthlyPaymentMinor === null) return null;
  if (loan.closedOn !== null) return 0n as Minor;

  let instalments = 0;
  for (let n = 1; n <= loan.termMonths; n++) {
    if (addCalendarMonths(loan.startedOn as BusinessDate, n) > today) break;
    instalments++;
  }
  const monthly = loan.monthlyPaymentMinor as Minor;
  const dueRaw = monthly * BigInt(instalments);
  const due = (dueRaw > loan.totalRepayableMinor ? loan.totalRepayableMinor : dueRaw) as Minor;
  const paid = livePayments.reduce((sum, p) => add(sum, p.amountMinor as Minor), 0n as Minor);
  const gap = subtract(due, paid);
  return (gap < 0n ? 0n : gap) as Minor;
}

export interface VehicleLoanWithFigures extends VehicleLoanRow {
  remainingToPayMinor: Minor;
  behindByMinor: Minor | null;
}

/** F-12.4: every figure here is derived on read, never stored (DM §4.4). */
export async function withDerivedFigures(
  reader: Reader,
  loan: VehicleLoanRow,
  today: BusinessDate,
): Promise<VehicleLoanWithFigures> {
  const livePayments = await listLivePaymentsForLoan(reader, loan.id);
  return {
    ...loan,
    remainingToPayMinor: remainingToPay(loan, livePayments),
    behindByMinor: behindBy(loan, livePayments, today),
  };
}

/**
 * GAP-186/UC-109. One loan's own contribution to "instalments due" —
 * overdue plus the next one falling due (Q-5, COMBINED-PLAN-2026-08-23.md),
 * capped so it never claims more is due than is actually left to pay.
 * `null` when this loan has no monthly figure to add a "next" instalment
 * to — the same absence `behindByMinor` itself already carries.
 */
function loanInstalmentsDue(withFigures: VehicleLoanWithFigures): Minor | null {
  if (withFigures.behindByMinor === null || withFigures.monthlyPaymentMinor === null) return null;
  const nextDue = add(withFigures.behindByMinor, withFigures.monthlyPaymentMinor as Minor);
  return nextDue > withFigures.remainingToPayMinor ? withFigures.remainingToPayMinor : nextDue;
}

/**
 * GAP-186/UC-109: the sum of every open loan's own instalments-due figure.
 * `null` — degrading the whole distributable-cash report, never a
 * fabricated 0 — the moment any open loan cannot contribute one (W-56: "a
 * distributable figure computed from a partial read is the single most
 * expensive wrong number... because someone acts on it by moving money").
 * A loan with no monthly schedule is exactly that partial a read — checked
 * against every loan's own row before any per-loan payment query runs, so
 * the degrade case never touches the database at all. Otherwise every
 * loan's payments are read in parallel — each is an independent query, and
 * the null-degrade check runs after all of them settle, not as a
 * short-circuit that would skip some.
 */
export async function sumInstalmentsDueForBusiness(
  reader: Reader,
  businessId: string,
  today: BusinessDate,
): Promise<Minor | null> {
  const loans = await listOpenVehicleLoansForBusiness(reader, businessId);
  if (loans.some((loan) => loan.monthlyPaymentMinor === null)) return null;

  const dues = await Promise.all(
    loans.map(async (loan) => loanInstalmentsDue(await withDerivedFigures(reader, loan, today))),
  );
  let total = 0n as Minor;
  for (const due of dues) {
    if (due === null) return null;
    total = add(total, due);
  }
  return total;
}

export interface RecordLoanPaymentInput {
  businessId: string;
  userId: string;
  loanId: string;
  amountMinor: Minor;
  paidOn: BusinessDate;
  note?: string;
  replacesId?: string;
}

export interface RecordedLoanPayment {
  paymentId: string;
}

/**
 * F-12.2/UC-107, INV-43/44/45. One transaction (INV-44): the `loan_payment`
 * row and its finance cost — an ordinary `expense` (category `finance`,
 * `borne_by: 'us'`, UC §6.7) when the business carries the debt, or a
 * `partner_payout` of kind `loan_on_behalf` against the named owner when it
 * doesn't (UC-107) — never both, and never an expense at all for the
 * principal share (INV-43).
 */
export async function recordLoanPayment(
  writer: Writer,
  input: RecordLoanPaymentInput,
): Promise<RecordedLoanPayment> {
  const paymentId = newId();
  try {
    await writer.transaction(async (tx) => {
      // Gitar review, PR #130: locked here, inside the transaction, not by
      // the caller beforehand — two concurrent payments against the same
      // loan must serialise on this row, the same "lock the parent" shape
      // GAP-178's deposit double-draw fix already established. A lock taken
      // before the transaction opens (or on a copy read outside it) still
      // lets both readers see the same stale remaining-to-pay.
      const loan = await findVehicleLoanForBusiness(tx, input.businessId, input.loanId, true);
      if (!loan) throw new NotFoundError("No such loan in this business");
      if (loan.closedOn !== null) throw new LoanClosedError();

      const linkage = await resolvePeriodLinkage(tx, input.businessId, input.paidOn);
      if (!linkage) {
        throw new PeriodClosedError("No accounting period covers this business date yet");
      }

      const livePayments = await listLivePaymentsForLoan(tx, loan.id);
      const remaining = remainingToPay(loan, livePayments);
      if (input.amountMinor > remaining) {
        throw new LoanPaymentExceedsRemainingError(
          `This payment (${input.amountMinor.toString()}) exceeds the ${remaining.toString()} left to pay — settle and close instead if this is meant to end the loan`,
        );
      }

      // GAP-190/N4: every other W-50 table validates its own replacesId
      // (see recordWriteOffRecovery's own comment); loan_payment never did.
      if (input.replacesId !== undefined) {
        const target = await findLoanPaymentForBusiness(tx, input.businessId, input.replacesId);
        if (!target) throw new NotFoundError("No such loan payment in this business");
        if (target.voidedAt === null) throw new ReplacesTargetNotVoidedError();
        if (target.loanId !== input.loanId) {
          throw new ValidationError("replacesId names a payment against a different loan");
        }
      }

      let expenseId: string | undefined;
      let partnerPayoutId: string | undefined;
      if (loan.liabilityOwner !== null) {
        // Design's own "Liability owner" table: the *whole* payment is a
        // drawing against his own debt, not the business's cost — the
        // principal/finance split only matters for the balance the
        // business itself carries. No expense at all in this branch.
        partnerPayoutId = newId();
        const payout: NewPartnerPayout = {
          id: partnerPayoutId,
          businessId: input.businessId,
          userId: loan.liabilityOwner,
          amountMinor: input.amountMinor,
          kind: "loan_on_behalf",
          occurredOn: input.paidOn,
          postedPeriodId: linkage.postedPeriodId,
          ...(linkage.belongsToPeriodId !== null
            ? { belongsToPeriodId: linkage.belongsToPeriodId }
            : {}),
        };
        await insertPartnerPayout(tx, payout);
      } else {
        const { finance } = splitPayment(loan, input.amountMinor);
        if (finance > 0n) {
          expenseId = newId();
          await insertExpense(tx, {
            id: expenseId,
            businessId: input.businessId,
            vehicleId: loan.vehicleId,
            category: "finance",
            amountMinor: finance,
            spentOn: input.paidOn,
            borneBy: "us",
            postedPeriodId: linkage.postedPeriodId,
            ...(linkage.belongsToPeriodId !== null
              ? { belongsToPeriodId: linkage.belongsToPeriodId }
              : {}),
            createdBy: input.userId,
          });
        }
      }

      await insertLoanPayment(tx, {
        id: paymentId,
        businessId: input.businessId,
        loanId: loan.id,
        amountMinor: input.amountMinor,
        paidOn: input.paidOn,
        postedPeriodId: linkage.postedPeriodId,
        ...(linkage.belongsToPeriodId !== null
          ? { belongsToPeriodId: linkage.belongsToPeriodId }
          : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        ...(input.replacesId !== undefined ? { replacesId: input.replacesId } : {}),
        ...(expenseId !== undefined ? { expenseId } : {}),
        ...(partnerPayoutId !== undefined ? { partnerPayoutId } : {}),
      });
    });
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    if (isUniqueViolation(err, "loan_payment_replaces_id_key")) {
      throw new ReplacesTargetAlreadyReplacedError();
    }
    throw err;
  }
  return { paymentId };
}

export interface SettleVehicleLoanInput {
  businessId: string;
  userId: string;
  loanId: string;
  settlementAmountMinor: Minor;
  settledOn: BusinessDate;
  note?: string;
}

export interface SettledVehicleLoan {
  paymentId: string;
}

/**
 * F-12.3/UC-108, W-69/INV-43/INV-45. The closing payment assigns principal =
 * whatever principal remains (derived from every live *ordinary* payment's
 * own split — a prior, since-voided settlement is excluded automatically,
 * since it is no longer live), so the loan's totals land exactly on
 * `principalMinor`/the finance total by construction, absorbing every
 * earlier rounding. Settlement below principal outstanding writes **no**
 * money record for the difference — `waived_minor` is a fact about the
 * loan, never an expense, a payout, or an adjustment.
 */
export async function settleVehicleLoan(
  writer: Writer,
  input: SettleVehicleLoanInput,
): Promise<SettledVehicleLoan> {
  const paymentId = newId();
  try {
    await writer.transaction(async (tx) => {
      // Gitar review, PR #130: same reasoning as recordLoanPayment's own
      // lock — a settlement and an ordinary payment racing the same loan
      // must serialise on it too, not just two payments against each other.
      const loan = await findVehicleLoanForBusiness(tx, input.businessId, input.loanId, true);
      if (!loan) throw new NotFoundError("No such loan in this business");
      if (loan.closedOn !== null) throw new LoanClosedError();

      const linkage = await resolvePeriodLinkage(tx, input.businessId, input.settledOn);
      if (!linkage) {
        throw new PeriodClosedError("No accounting period covers this business date yet");
      }

      // Gitar review, PR #130, considered rather than assumed away: this
      // split() reuse is deliberate, not a leftover from before the
      // liability-owner fix. The principal:finance ratio is fixed by the
      // loan agreement itself (W-68, set once at creation) — a property of
      // what was borrowed, not of who is paying it down. A loan_on_behalf
      // loan's principalOutstanding/waivedMinor stay meaningful precisely
      // because the design calls the balance "tracked as a memo" rather
      // than untracked: the lender's forgiveness is still a fact about the
      // loan, even though no expense/payout ever records the split itself
      // for this branch (recordLoanPayment/settleVehicleLoan's own "whole
      // payment is a drawing" rule only decides which money record gets
      // written, never what the loan's own numbers mean).
      const livePayments = await listLivePaymentsForLoan(tx, loan.id);

      // GAP-190/N1: the same ceiling recordLoanPayment already enforces —
      // without it, a settlement larger than what is actually left to pay
      // flows straight into financeMinor below, which can then exceed the
      // loan's own finance total. `0032`'s `CHECK (total_repayable_minor >=
      // principal_minor)` never sees this write, so nothing in the schema
      // catches it.
      const remaining = remainingToPay(loan, livePayments);
      if (input.settlementAmountMinor > remaining) {
        throw new LoanPaymentExceedsRemainingError(
          `This settlement (${input.settlementAmountMinor.toString()}) exceeds the ` +
            `${remaining.toString()} left to pay`,
        );
      }

      const principalPaid = livePayments
        .filter((p) => !p.isSettlement)
        .reduce(
          (sum, p) => add(sum, splitPayment(loan, p.amountMinor as Minor).principal),
          0n as Minor,
        );
      const principalOutstanding = subtract(loan.principalMinor as Minor, principalPaid);

      const financeMinor =
        input.settlementAmountMinor >= principalOutstanding
          ? subtract(input.settlementAmountMinor, principalOutstanding)
          : (0n as Minor);
      const waivedMinor =
        input.settlementAmountMinor >= principalOutstanding
          ? (0n as Minor)
          : subtract(principalOutstanding, input.settlementAmountMinor);

      let expenseId: string | undefined;
      let partnerPayoutId: string | undefined;
      if (loan.liabilityOwner !== null) {
        // Same "whole payment is a drawing" rule recordLoanPayment applies —
        // what he actually paid the lender, not the finance share alone.
        if (input.settlementAmountMinor > 0n) {
          partnerPayoutId = newId();
          await insertPartnerPayout(tx, {
            id: partnerPayoutId,
            businessId: input.businessId,
            userId: loan.liabilityOwner,
            amountMinor: input.settlementAmountMinor,
            kind: "loan_on_behalf",
            occurredOn: input.settledOn,
            postedPeriodId: linkage.postedPeriodId,
            ...(linkage.belongsToPeriodId !== null
              ? { belongsToPeriodId: linkage.belongsToPeriodId }
              : {}),
          });
        }
      } else if (financeMinor > 0n) {
        expenseId = newId();
        await insertExpense(tx, {
          id: expenseId,
          businessId: input.businessId,
          vehicleId: loan.vehicleId,
          category: "finance",
          amountMinor: financeMinor,
          spentOn: input.settledOn,
          borneBy: "us",
          postedPeriodId: linkage.postedPeriodId,
          ...(linkage.belongsToPeriodId !== null
            ? { belongsToPeriodId: linkage.belongsToPeriodId }
            : {}),
          createdBy: input.userId,
        });
      }

      await insertLoanPayment(tx, {
        id: paymentId,
        businessId: input.businessId,
        loanId: loan.id,
        amountMinor: input.settlementAmountMinor,
        paidOn: input.settledOn,
        isSettlement: true,
        waivedMinor,
        postedPeriodId: linkage.postedPeriodId,
        ...(linkage.belongsToPeriodId !== null
          ? { belongsToPeriodId: linkage.belongsToPeriodId }
          : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        ...(expenseId !== undefined ? { expenseId } : {}),
        ...(partnerPayoutId !== undefined ? { partnerPayoutId } : {}),
      });

      await setVehicleLoanClosedOn(tx, loan.id, input.settledOn);
    });
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    throw err;
  }
  return { paymentId };
}

export interface VoidLoanPaymentInput {
  businessId: string;
  loanId: string;
  paymentId: string;
  reason: string;
  userId: string;
}

export interface VoidedLoanPayment {
  id: string;
  voidedAt: string;
}

/**
 * F-12.3's own void: "clears closed_on and reopens the loan, voiding its
 * finance cost with it" — otherwise a mistaken settlement leaves a loan
 * permanently closed with a live balance. Voiding an ordinary (non-
 * settlement) payment cascades its own finance expense/payout the same way,
 * but leaves the loan's `closed_on` untouched (it was never set by an
 * ordinary payment). Voiding a payment whose finance cost sits in a closed
 * period is refused with `PERIOD_CLOSED`, the same answer every other money
 * record gives (caught from `voidExpenseRow`'s/`voidPartnerPayoutRow`'s own
 * period trigger).
 */
export async function voidLoanPayment(
  writer: Writer,
  input: VoidLoanPaymentInput,
): Promise<VoidedLoanPayment> {
  try {
    return await writer.transaction(async (tx) => {
      // GAP-190/N3: the parent loan is locked here first, the same shape
      // recordLoanPayment/settleVehicleLoan already use — a void racing a
      // payment or another void against the same loan must serialise on
      // this row too, not just payments against each other. Read outside
      // the transaction (the shape this used to have), both sides could
      // work from the same stale remaining-to-pay.
      const loan = await findVehicleLoanForBusiness(tx, input.businessId, input.loanId, true);
      if (!loan) throw new NotFoundError("No such loan in this business");

      const payment = await findLoanPaymentForBusiness(tx, input.businessId, input.paymentId);
      // Gitar review, PR #130: the route names both a loan and a payment
      // (`/{id}/payment/{paymentId}/void`) — a payment that exists but belongs
      // to a different loan is indistinguishable from one that doesn't exist
      // at all, the same "cross-tenant is 404" reasoning applied one level
      // down from business_id to loan_id.
      if (!payment || payment.loanId !== input.loanId) {
        throw new NotFoundError("No such loan payment in this business");
      }
      if (payment.voidedAt !== null) throw new LoanPaymentAlreadyVoidedError();

      if (payment.expenseId !== null) {
        await voidExpenseRow(tx, payment.expenseId, {
          voidedReason: input.reason,
          voidedBy: input.userId,
        });
      }
      if (payment.partnerPayoutId !== null) {
        await voidPartnerPayoutRow(tx, payment.partnerPayoutId, {
          voidedReason: input.reason,
          voidedBy: input.userId,
        });
      }

      const voided = await voidLoanPaymentRow(tx, input.paymentId, {
        voidedReason: input.reason,
        voidedBy: input.userId,
      });
      if (!voided) throw new LoanPaymentAlreadyVoidedError();

      if (payment.isSettlement) {
        await setVehicleLoanClosedOn(tx, payment.loanId, null);
      }

      return { id: input.paymentId, voidedAt: voided.voidedAt };
    });
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    throw err;
  }
}
