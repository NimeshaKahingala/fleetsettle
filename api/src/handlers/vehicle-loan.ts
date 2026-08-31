import { asBusinessDate, businessToday, toWire, type Minor } from "@fleetsettle/shared";
import type { RouteHandler } from "@hono/zod-openapi";
import {
  requireBusinessId,
  requireBusinessTimezone,
  requireCapability,
  requireUserId,
} from "../auth/context.js";
import {
  recordLoanPayment,
  recordVehicleLoan,
  settleVehicleLoan,
  voidLoanPayment,
  withDerivedFigures,
} from "../domain/vehicle-loan.js";
import { NotFoundError, ValidationError } from "../errors/app-error.js";
import { findBusinessMemberUserId } from "../queries/partner.js";
import { findVehicleForBusiness } from "../queries/vehicle.js";
import {
  findLoanPaymentForBusiness,
  findVehicleLoanForBusiness,
  listLoanPaymentsForLoan,
  type LoanPaymentRow,
} from "../queries/vehicle-loan.js";
import type {
  getVehicleLoanRoute,
  listLoanPaymentsRoute,
  recordLoanPaymentRoute,
  recordVehicleLoanRoute,
  settleVehicleLoanRoute,
  voidLoanPaymentRoute,
} from "../route-defs/vehicle-loan.js";
import type { Env } from "../types.js";
import type { VehicleLoanWithFigures } from "../domain/vehicle-loan.js";

// W-52/UC-107: a down payment names exactly one owner, and a named loan
// liability is a partner_payout target — both must be OWNERS, the same
// PARTNER_ROLES check handlers/partner.ts's own recordCapitalContribution
// makes for exactly the same reason.
const PARTNER_ROLES: ReadonlySet<string> = new Set(["owner", "owner_manager"]);

function assertIsPartner(member: { role: string }): void {
  if (!PARTNER_ROLES.has(member.role)) {
    throw new ValidationError("This member is not an owner or owner-manager");
  }
}

export function loanToResponse(loan: VehicleLoanWithFigures) {
  return {
    id: loan.id,
    vehicleId: loan.vehicleId,
    lender: loan.lender,
    liabilityOwnerUserId: loan.liabilityOwner,
    principalMinor: toWire(loan.principalMinor as Minor),
    totalRepayableMinor: toWire(loan.totalRepayableMinor as Minor),
    termMonths: loan.termMonths,
    monthlyPaymentMinor:
      loan.monthlyPaymentMinor !== null ? toWire(loan.monthlyPaymentMinor as Minor) : null,
    paymentDay: loan.paymentDay,
    amortisationMethod: loan.amortisationMethod as "flat",
    downPaymentMinor:
      loan.downPaymentMinor !== null ? toWire(loan.downPaymentMinor as Minor) : null,
    downPaymentByUserId: loan.downPaymentByUserId,
    startedOn: loan.startedOn,
    closedOn: loan.closedOn,
    remainingToPayMinor: toWire(loan.remainingToPayMinor),
    behindByMinor: loan.behindByMinor !== null ? toWire(loan.behindByMinor) : null,
  };
}

function paymentToResponse(row: LoanPaymentRow) {
  return {
    id: row.id,
    loanId: row.loanId,
    amountMinor: toWire(row.amountMinor as Minor),
    paidOn: row.paidOn,
    isSettlement: row.isSettlement,
    waivedMinor: toWire(row.waivedMinor as Minor),
    note: row.note,
    voidedAt: row.voidedAt,
    voidedReason: row.voidedReason,
    replacesId: row.replacesId,
  };
}

/** F-12.1/UC-106, W-52/W-70. `manageVehicleLoans` — owners only, a capital commitment. */
export const recordVehicleLoanHandler: RouteHandler<typeof recordVehicleLoanRoute, Env> = async (
  c,
) => {
  requireCapability(c, "manageVehicleLoans");
  const businessId = requireBusinessId(c);
  const today = businessToday(requireBusinessTimezone(c));
  const body = c.req.valid("json");
  const reader = c.get("reader");

  const vehicleRow = await findVehicleForBusiness(reader, businessId, body.vehicleId);
  if (!vehicleRow) throw new NotFoundError("No such vehicle in this business");

  if (body.downPaymentByUserId !== undefined) {
    const member = await findBusinessMemberUserId(reader, businessId, body.downPaymentByUserId);
    if (!member) throw new NotFoundError("No such partner in this business");
    assertIsPartner(member);
  }
  if (body.liabilityOwnerUserId !== undefined) {
    const member = await findBusinessMemberUserId(reader, businessId, body.liabilityOwnerUserId);
    if (!member) throw new NotFoundError("No such partner in this business");
    assertIsPartner(member);
  }

  const { loanId } = await recordVehicleLoan(c.get("writer"), {
    businessId,
    vehicleId: body.vehicleId,
    lender: body.lender,
    principalMinor: body.principalMinor,
    totalRepayableMinor: body.totalRepayableMinor,
    termMonths: body.termMonths,
    ...(body.monthlyPaymentMinor !== undefined
      ? { monthlyPaymentMinor: body.monthlyPaymentMinor }
      : {}),
    ...(body.paymentDay !== undefined ? { paymentDay: body.paymentDay } : {}),
    ...(body.downPaymentMinor !== undefined ? { downPaymentMinor: body.downPaymentMinor } : {}),
    ...(body.downPaymentByUserId !== undefined
      ? { downPaymentByUserId: body.downPaymentByUserId }
      : {}),
    ...(body.liabilityOwnerUserId !== undefined
      ? { liabilityOwnerUserId: body.liabilityOwnerUserId }
      : {}),
    ...(body.purchaseCostMinor !== undefined ? { purchaseCostMinor: body.purchaseCostMinor } : {}),
    startedOn: asBusinessDate(body.startedOn),
  });

  const loanRow = await findVehicleLoanForBusiness(reader, businessId, loanId);
  if (!loanRow) throw new NotFoundError();
  const withFigures = await withDerivedFigures(reader, businessId, loanRow, today);
  return c.json(loanToResponse(withFigures), 201);
};

/** F-12.4. `viewReports` — a manager sees this too (W-70). */
export const getVehicleLoanHandler: RouteHandler<typeof getVehicleLoanRoute, Env> = async (c) => {
  requireCapability(c, "viewReports");
  const businessId = requireBusinessId(c);
  const today = businessToday(requireBusinessTimezone(c));
  const { id } = c.req.valid("param");
  const reader = c.get("reader");

  const loanRow = await findVehicleLoanForBusiness(reader, businessId, id);
  if (!loanRow) throw new NotFoundError("No such loan in this business");

  const withFigures = await withDerivedFigures(reader, businessId, loanRow, today);
  return c.json(loanToResponse(withFigures), 200);
};

/** F-12.2/UC-107, INV-43/44/45. `dailyOperations` — the manager pays it. */
export const recordLoanPaymentHandler: RouteHandler<typeof recordLoanPaymentRoute, Env> = async (
  c,
) => {
  requireCapability(c, "dailyOperations");
  const businessId = requireBusinessId(c);
  const userId = requireUserId(c);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");

  // No pre-fetch here — recordLoanPayment locks and re-checks the loan
  // itself, inside its own transaction (Gitar review, PR #130). A read
  // here first would only add a second, unlocked, already-stale view.
  const { paymentId } = await recordLoanPayment(c.get("writer"), {
    businessId,
    userId,
    loanId: id,
    amountMinor: body.amountMinor,
    paidOn: asBusinessDate(body.paidOn),
    ...(body.note !== undefined ? { note: body.note } : {}),
    ...(body.replacesId !== undefined ? { replacesId: body.replacesId } : {}),
  });

  return c.json(
    {
      id: paymentId,
      loanId: id,
      amountMinor: toWire(body.amountMinor),
      paidOn: body.paidOn,
      isSettlement: false,
      waivedMinor: toWire(0n as Minor),
      note: body.note ?? null,
      voidedAt: null,
      voidedReason: null,
      replacesId: body.replacesId ?? null,
    },
    201,
  );
};

/** F-12.2/F-12.4: `viewReports` — the same gate reading the loan itself uses. */
export const listLoanPaymentsHandler: RouteHandler<typeof listLoanPaymentsRoute, Env> = async (
  c,
) => {
  requireCapability(c, "viewReports");
  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");
  const reader = c.get("reader");

  const loanRow = await findVehicleLoanForBusiness(reader, businessId, id);
  if (!loanRow) throw new NotFoundError("No such loan in this business");

  const rows = await listLoanPaymentsForLoan(reader, businessId, id);
  return c.json(rows.map(paymentToResponse), 200);
};

/** F-12.3/UC-108, W-69. `dailyOperations` — owner or manager, per F-12.3's own actor line. */
export const settleVehicleLoanHandler: RouteHandler<typeof settleVehicleLoanRoute, Env> = async (
  c,
) => {
  requireCapability(c, "dailyOperations");
  const businessId = requireBusinessId(c);
  const userId = requireUserId(c);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const reader = c.get("reader");

  // No pre-fetch here, same reasoning as recordLoanPaymentHandler
  // (Gitar review, PR #130) — settleVehicleLoan locks and re-checks the
  // loan itself.
  const { paymentId } = await settleVehicleLoan(c.get("writer"), {
    businessId,
    userId,
    loanId: id,
    settlementAmountMinor: body.settlementAmountMinor,
    settledOn: asBusinessDate(body.settledOn),
    ...(body.note !== undefined ? { note: body.note } : {}),
  });

  const paymentRow = await findLoanPaymentForBusiness(reader, businessId, paymentId);
  if (!paymentRow) throw new NotFoundError();
  return c.json(paymentToResponse(paymentRow), 201);
};

/** F-12.3's own void. `dailyOperations` — the same gate recording one uses. */
export const voidLoanPaymentHandler: RouteHandler<typeof voidLoanPaymentRoute, Env> = async (c) => {
  requireCapability(c, "dailyOperations");
  const businessId = requireBusinessId(c);
  const userId = requireUserId(c);
  const { id, paymentId } = c.req.valid("param");
  const body = c.req.valid("json");

  const result = await voidLoanPayment(c.get("writer"), {
    businessId,
    loanId: id,
    paymentId,
    reason: body.reason,
    userId,
  });

  return c.json(result, 200);
};
