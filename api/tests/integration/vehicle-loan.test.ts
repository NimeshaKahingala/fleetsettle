import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { capitalContribution, expense, partnerPayout, vehicle } from "../../src/db/schema.js";
import { mintUser, signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

async function postLoan(token: string, body: unknown) {
  return request("/api/vehicle-loan", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

async function getLoan(token: string, loanId: string) {
  return request(`/api/vehicle-loan/${loanId}`, bearer(token));
}

async function postPayment(token: string, loanId: string, body: unknown) {
  return request(`/api/vehicle-loan/${loanId}/payment`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

async function listPayments(token: string, loanId: string) {
  return request(`/api/vehicle-loan/${loanId}/payment`, bearer(token));
}

async function postSettle(token: string, loanId: string, body: unknown) {
  return request(`/api/vehicle-loan/${loanId}/settle`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

async function postVoidPayment(token: string, loanId: string, paymentId: string, body: unknown) {
  return request(`/api/vehicle-loan/${loanId}/payment/${paymentId}/void`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

interface LoanBody {
  id: string;
  vehicleId: string;
  liabilityOwnerUserId: string | null;
  principalMinor: string;
  totalRepayableMinor: string;
  remainingToPayMinor: string;
  behindByMinor: string | null;
  closedOn: string | null;
}

interface PaymentBody {
  id: string;
  loanId: string;
  amountMinor: string;
  isSettlement: boolean;
  waivedMinor: string;
  voidedAt: string | null;
}

/**
 * GAP-185/F-12, UC-106..UC-108, W-68/W-69/W-70, INV-43/44/45 test matrix.
 * The golden fixtures (134,000/15,000/7,500, FL §9.1) are untouched by this
 * feature — no existing money path is changed, only new tables and a new
 * expense category — so they are not re-run here; `npm run check` covers it.
 */
describe("vehicle loans (F-12)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("U-2 — saves on lender + principal + total repayable + term alone", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postLoan(token, {
      vehicleId,
      lender: "Peoples Leasing",
      principalMinor: "1000000",
      totalRepayableMinor: "1500000",
      termMonths: 50,
      startedOn: "2026-07-05",
    });
    expect(res.status).toBe(201);
    const body: LoanBody = await res.json();
    expect(body).toMatchObject({
      vehicleId,
      principalMinor: "1000000",
      totalRepayableMinor: "1500000",
      remainingToPayMinor: "1500000",
      behindByMinor: null,
      closedOn: null,
    });
    ctx.trackCreatedVehicleLoan(body.id);

    await ctx.cleanup();
  });

  it("F-12.2/INV-43/44/45 — a payment splits proportionally, the finance share posts as an ordinary expense, principal reduces remaining-to-pay alone", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    // principal 1,000,000 : finance 500,000 == 2 : 1
    const loanRes = await postLoan(token, {
      vehicleId,
      lender: "Peoples Leasing",
      principalMinor: "1000000",
      totalRepayableMinor: "1500000",
      termMonths: 50,
      startedOn: "2026-07-05",
    });
    const loan: LoanBody = await loanRes.json();
    ctx.trackCreatedVehicleLoan(loan.id);

    const paymentRes = await postPayment(token, loan.id, {
      amountMinor: "30000",
      paidOn: "2026-07-10",
    });
    expect(paymentRes.status).toBe(201);
    const payment: PaymentBody = await paymentRes.json();
    expect(payment).toMatchObject({ loanId: loan.id, amountMinor: "30000", isSettlement: false });

    // INV-43: the finance third (10,000) is a real expense; the principal
    // two-thirds (20,000) touches no expense/income row at all.
    const expenseRows = await db
      .select({
        amountMinor: expense.amountMinor,
        category: expense.category,
        borneBy: expense.borneBy,
        vehicleId: expense.vehicleId,
      })
      .from(expense)
      .where(eq(expense.vehicleId, vehicleId));
    expect(expenseRows).toHaveLength(1);
    expect(expenseRows[0]).toMatchObject({
      amountMinor: 10_000n,
      category: "finance",
      borneBy: "us",
      vehicleId,
    });

    const afterRes = await getLoan(token, loan.id);
    const after: LoanBody = await afterRes.json();
    expect(after.remainingToPayMinor).toBe("1470000");

    const listRes = await listPayments(token, loan.id);
    const list: PaymentBody[] = await listRes.json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: payment.id, amountMinor: "30000" });

    await ctx.cleanup();
  });

  it("F-12.2 — a payment exceeding what is left to pay is refused, naming the figure", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const loanRes = await postLoan(token, {
      vehicleId,
      lender: "Peoples Leasing",
      principalMinor: "100000",
      totalRepayableMinor: "150000",
      termMonths: 12,
      startedOn: "2026-07-05",
    });
    const loan: LoanBody = await loanRes.json();
    ctx.trackCreatedVehicleLoan(loan.id);

    const res = await postPayment(token, loan.id, { amountMinor: "200000", paidOn: "2026-07-10" });
    expect(res.status).toBe(409);
    const body: { code: string } = await res.json();
    expect(body).toMatchObject({ code: "LOAN_PAYMENT_EXCEEDS_REMAINING" });

    await ctx.cleanup();
  });

  it("F-12.3/W-69 — settling below principal outstanding writes waivedMinor and no money record for the difference", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const loanRes = await postLoan(token, {
      vehicleId,
      lender: "Peoples Leasing",
      principalMinor: "1000000",
      totalRepayableMinor: "1500000",
      termMonths: 50,
      startedOn: "2026-07-05",
    });
    const loan: LoanBody = await loanRes.json();
    ctx.trackCreatedVehicleLoan(loan.id);

    // Settlement of 400,000 against a full 1,000,000 principal outstanding
    // (no ordinary payments yet) — well below outstanding, so the whole
    // difference (600,000) is waived, and no expense/payout is written.
    const settleRes = await postSettle(token, loan.id, {
      settlementAmountMinor: "400000",
      settledOn: "2026-07-15",
    });
    expect(settleRes.status).toBe(201);
    const settlement: PaymentBody = await settleRes.json();
    expect(settlement).toMatchObject({ isSettlement: true, waivedMinor: "600000" });

    const expenseRows = await db
      .select({ id: expense.id })
      .from(expense)
      .where(eq(expense.vehicleId, vehicleId));
    expect(expenseRows).toHaveLength(0);

    const closedRes = await getLoan(token, loan.id);
    const closed: LoanBody = await closedRes.json();
    expect(closed.closedOn).toBe("2026-07-15");

    // A second payment against a closed loan is refused.
    const blockedRes = await postPayment(token, loan.id, {
      amountMinor: "1000",
      paidOn: "2026-07-20",
    });
    expect(blockedRes.status).toBe(409);
    expect(await blockedRes.json()).toMatchObject({ code: "LOAN_CLOSED" });

    // Voiding the settlement reopens the loan.
    const voidRes = await postVoidPayment(token, loan.id, settlement.id, {
      reason: "entered against the wrong loan",
    });
    expect(voidRes.status).toBe(200);
    const reopenedRes = await getLoan(token, loan.id);
    const reopened: LoanBody = await reopenedRes.json();
    expect(reopened.closedOn).toBeNull();
    expect(reopened.remainingToPayMinor).toBe("1500000");

    await ctx.cleanup();
  });

  it("F-12.1/W-52 — a down payment writes exactly one capital_contribution, by the named owner", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postLoan(token, {
      vehicleId,
      lender: "Peoples Leasing",
      principalMinor: "1000000",
      totalRepayableMinor: "1500000",
      termMonths: 50,
      downPaymentMinor: "2000000",
      downPaymentByUserId: owner.userId,
      purchaseCostMinor: "3000000",
      startedOn: "2026-07-05",
    });
    expect(res.status).toBe(201);
    const loan: LoanBody = await res.json();
    ctx.trackCreatedVehicleLoan(loan.id);

    const contributions = await db
      .select({
        id: capitalContribution.id,
        amountMinor: capitalContribution.amountMinor,
        userId: capitalContribution.userId,
      })
      .from(capitalContribution)
      .where(eq(capitalContribution.vehicleId, vehicleId));
    expect(contributions).toHaveLength(1);
    expect(contributions[0]).toMatchObject({ amountMinor: 2_000_000n, userId: owner.userId });
    ctx.trackCreatedCapitalContribution(contributions[0]!.id);

    const vehicleRows = await db
      .select({ purchaseCostMinor: vehicle.purchaseCostMinor })
      .from(vehicle)
      .where(eq(vehicle.id, vehicleId));
    expect(vehicleRows[0]?.purchaseCostMinor).toBe(3_000_000n);

    await ctx.cleanup();
  });

  it("F-12.1/UC-107 — a named-owner liability writes a loan_on_behalf payout instead of an expense", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const loanRes = await postLoan(token, {
      vehicleId,
      lender: "Peoples Leasing",
      principalMinor: "1000000",
      totalRepayableMinor: "1500000",
      termMonths: 50,
      liabilityOwnerUserId: owner.userId,
      startedOn: "2026-07-05",
    });
    const loan: LoanBody = await loanRes.json();
    ctx.trackCreatedVehicleLoan(loan.id);
    expect(loan.liabilityOwnerUserId).toBe(owner.userId);

    const paymentRes = await postPayment(token, loan.id, {
      amountMinor: "30000",
      paidOn: "2026-07-10",
    });
    expect(paymentRes.status).toBe(201);

    const expenseRows = await db
      .select({ id: expense.id })
      .from(expense)
      .where(eq(expense.vehicleId, vehicleId));
    expect(expenseRows).toHaveLength(0);

    const payoutRows = await db
      .select({
        amountMinor: partnerPayout.amountMinor,
        kind: partnerPayout.kind,
        userId: partnerPayout.userId,
      })
      .from(partnerPayout)
      .where(eq(partnerPayout.userId, owner.userId));
    expect(payoutRows).toHaveLength(1);
    // The whole payment (30,000) is a drawing against his own debt — never
    // just the finance third — per the design's own "Liability owner" table.
    expect(payoutRows[0]).toMatchObject({
      amountMinor: 30_000n,
      kind: "loan_on_behalf",
      userId: owner.userId,
    });

    await ctx.cleanup();
  });

  it("404 — a loan belonging to another business", async () => {
    const ctxA = new TestContext(db);
    const businessA = await ctxA.createBusiness();
    await ctxA.createOpenPeriod(businessA);
    const vehicleA = await ctxA.createVehicle(businessA);
    const ownerA = await mintUser(db, ctxA, businessA, "owner");
    const tokenA = await signAccessToken(ownerA.asgardeoSub);

    const loanRes = await postLoan(tokenA, {
      vehicleId: vehicleA,
      lender: "Peoples Leasing",
      principalMinor: "100000",
      totalRepayableMinor: "150000",
      termMonths: 12,
      startedOn: "2026-07-05",
    });
    const loan: LoanBody = await loanRes.json();
    ctxA.trackCreatedVehicleLoan(loan.id);

    const ctxB = new TestContext(db);
    const businessB = await ctxB.createBusiness();
    const ownerB = await mintUser(db, ctxB, businessB, "owner");
    const tokenB = await signAccessToken(ownerB.asgardeoSub);

    const res = await getLoan(tokenB, loan.id);
    expect(res.status).toBe(404);

    await ctxA.cleanup();
    await ctxB.cleanup();
  });

  it("404 — voiding a payment through a different loan's own URL, Gitar review PR #130 (a payment that exists but under the wrong loan is indistinguishable from one that doesn't)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const loanARes = await postLoan(token, {
      vehicleId,
      lender: "Peoples Leasing",
      principalMinor: "100000",
      totalRepayableMinor: "150000",
      termMonths: 12,
      startedOn: "2026-07-05",
    });
    const loanA: LoanBody = await loanARes.json();
    ctx.trackCreatedVehicleLoan(loanA.id);

    const loanBRes = await postLoan(token, {
      vehicleId,
      lender: "Commercial Leasing",
      principalMinor: "50000",
      totalRepayableMinor: "75000",
      termMonths: 12,
      startedOn: "2026-07-05",
    });
    const loanB: LoanBody = await loanBRes.json();
    ctx.trackCreatedVehicleLoan(loanB.id);

    const paymentRes = await postPayment(token, loanA.id, {
      amountMinor: "10000",
      paidOn: "2026-07-10",
    });
    const payment: PaymentBody = await paymentRes.json();

    // Real payment id, real loan id — just the wrong pairing.
    const res = await postVoidPayment(token, loanB.id, payment.id, { reason: "wrong loan" });
    expect(res.status).toBe(404);

    const stillLive = await listPayments(token, loanA.id);
    const stillLiveBody: PaymentBody[] = await stillLive.json();
    expect(stillLiveBody.find((p) => p.id === payment.id)?.voidedAt).toBeNull();

    await ctx.cleanup();
  });

  it("403 — a manager cannot record a vehicle loan (manageVehicleLoans is owners only)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const manager = await mintUser(db, ctx, businessId, "manager");
    const token = await signAccessToken(manager.asgardeoSub);

    const res = await postLoan(token, {
      vehicleId,
      lender: "Peoples Leasing",
      principalMinor: "100000",
      totalRepayableMinor: "150000",
      termMonths: 12,
      startedOn: "2026-07-05",
    });
    expect(res.status).toBe(403);

    await ctx.cleanup();
  });

  it("F-12.2 — a manager can record a payment, and PERIOD_CLOSED is refused with no open period", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const manager = await mintUser(db, ctx, businessId, "manager");
    const ownerToken = await signAccessToken(owner.asgardeoSub);
    const managerToken = await signAccessToken(manager.asgardeoSub);

    const loanRes = await postLoan(ownerToken, {
      vehicleId,
      lender: "Peoples Leasing",
      principalMinor: "100000",
      totalRepayableMinor: "150000",
      termMonths: 12,
      startedOn: "2026-07-05",
    });
    const loan: LoanBody = await loanRes.json();
    ctx.trackCreatedVehicleLoan(loan.id);

    await ctx.closePeriod(periodId);

    const res = await postPayment(managerToken, loan.id, {
      amountMinor: "10000",
      paidOn: "2026-07-10",
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "PERIOD_CLOSED" });

    await ctx.cleanup();
  });
});
