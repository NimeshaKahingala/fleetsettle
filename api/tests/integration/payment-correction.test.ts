import { and, eq, isNull } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { obligation, paymentAllocation, paymentCorrection } from "../../src/db/schema.js";
import { mintUser, signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

async function postPayment(token: string, body: unknown) {
  return request("/api/payment", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

async function postCorrection(token: string, paymentId: string, body: unknown) {
  return request(`/api/payment/${paymentId}/correct`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

interface PaymentResponseBody {
  id: string;
  allocations: Array<{ obligationId: string; amountMinor: string }>;
}

interface CorrectionResponseBody {
  correctionId: string;
  paymentId: string;
  differenceMinor: string;
  bearer: "back_to_arrears" | "absorbed_loss";
  payment: { id: string; amountMinor: string; status: "active" | "corrected" | "reversed" };
}

/**
 * F-8.2/UC-93/W-36/W-37. "The amount is editable rather than the receipt
 * being cancelled, only the difference moves." `bearer` decides whether the
 * obligation the payment settled comes back into arrears (INV-22) or the
 * business absorbs the gap instead.
 */
describe("correct a payment (P9, F-8.2/UC-93)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  async function setUpFullySettledObligation(ctx: TestContext) {
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const customerId = await ctx.createCustomer(businessId);
    const obligationId = await ctx.createObligation(businessId, periodId, {
      partyType: "customer",
      customerId,
      amountMinor: 70_000n,
      dueOn: "2026-07-12",
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const paymentRes = await postPayment(token, {
      partyType: "customer",
      partyId: customerId,
      amountMinor: "70000",
      occurredOn: "2026-07-15",
    });
    expect(paymentRes.status).toBe(201);
    const paymentBody: PaymentResponseBody = await paymentRes.json();
    ctx.trackCreatedPayment(paymentBody.id);

    return { businessId, periodId, obligationId, token, paymentId: paymentBody.id };
  }

  async function readObligation(obligationId: string) {
    const rows = await db
      .select({
        amountMinor: obligation.amountMinor,
        settledMinor: obligation.settledMinor,
        status: obligation.status,
      })
      .from(obligation)
      .where(eq(obligation.id, obligationId));
    return rows[0];
  }

  /** GAP-229: the live (non-voided) allocation total is the other half of a payment's unallocated credit — `payment.amountMinor - this` — the same formula `credit-forward.ts` reads. */
  async function readAllocatedTotal(paymentId: string): Promise<bigint> {
    const rows = await db
      .select({ amountMinor: paymentAllocation.amountMinor })
      .from(paymentAllocation)
      .where(and(eq(paymentAllocation.paymentId, paymentId), isNull(paymentAllocation.voidedAt)));
    return rows.reduce((sum, r) => sum + r.amountMinor, 0n);
  }

  /**
   * GAP-229's own example: an obligation smaller than the payment that
   * settled it leaves the surplus as unallocated credit (F-2.2). `partyType`
   * drives which direction the obligation and the payment settle in —
   * `"customer"` for `owed_to_us`/`received`, `"driver"` for `owed_by_us`/`paid`.
   */
  async function setUpObligationWithCredit(
    ctx: TestContext,
    partyType: "customer" | "driver",
    obligationAmountMinor: bigint,
    paymentAmountMinor: bigint,
  ) {
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const isCustomer = partyType === "customer";
    const partyId = isCustomer
      ? await ctx.createCustomer(businessId)
      : await ctx.createDriver(businessId);
    const obligationId = await ctx.createObligation(businessId, periodId, {
      direction: isCustomer ? "owed_to_us" : "owed_by_us",
      partyType,
      ...(isCustomer ? { customerId: partyId } : { driverId: partyId }),
      amountMinor: obligationAmountMinor,
      dueOn: "2026-07-12",
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const paymentRes = await postPayment(token, {
      direction: isCustomer ? "received" : "paid",
      partyType,
      partyId,
      amountMinor: paymentAmountMinor.toString(),
      occurredOn: "2026-07-15",
    });
    expect(paymentRes.status).toBe(201);
    const paymentBody: PaymentResponseBody = await paymentRes.json();
    ctx.trackCreatedPayment(paymentBody.id);

    return { businessId, periodId, partyId, obligationId, token, paymentId: paymentBody.id };
  }

  it("back_to_arrears — the shortfall returns to the party's arrears (INV-22)", async () => {
    const ctx = new TestContext(db);
    const { obligationId, token, paymentId } = await setUpFullySettledObligation(ctx);

    const res = await postCorrection(token, paymentId, {
      differenceMinor: "2000",
      bearer: "back_to_arrears",
      reason: "counted 2,000 short at banking",
      correctedOn: "2026-07-20",
    });
    expect(res.status).toBe(200);
    const body: CorrectionResponseBody = await res.json();
    expect(body).toMatchObject({
      paymentId,
      differenceMinor: "2000",
      bearer: "back_to_arrears",
      payment: { id: paymentId, amountMinor: "68000", status: "corrected" },
    });
    ctx.trackCreatedPaymentCorrection(body.correctionId);

    const after = await readObligation(obligationId);
    expect(after).toMatchObject({
      amountMinor: 70_000n,
      settledMinor: 68_000n,
      status: "part_paid",
    });

    await ctx.cleanup();
  });

  it("absorbed_loss — the obligation stays fully settled; the business eats the gap", async () => {
    const ctx = new TestContext(db);
    const { obligationId, token, paymentId } = await setUpFullySettledObligation(ctx);

    const res = await postCorrection(token, paymentId, {
      differenceMinor: "2000",
      bearer: "absorbed_loss",
      reason: "a bad note accepted at handover",
      correctedOn: "2026-07-20",
    });
    expect(res.status).toBe(200);
    const body: CorrectionResponseBody = await res.json();
    expect(body).toMatchObject({
      bearer: "absorbed_loss",
      payment: { id: paymentId, amountMinor: "68000", status: "corrected" },
    });
    ctx.trackCreatedPaymentCorrection(body.correctionId);

    const after = await readObligation(obligationId);
    expect(after).toMatchObject({ amountMinor: 70_000n, settledMinor: 70_000n, status: "paid" });

    await ctx.cleanup();
  });

  it("correcting the full amount reverses the payment (status='reversed')", async () => {
    const ctx = new TestContext(db);
    const { token, paymentId } = await setUpFullySettledObligation(ctx);

    const res = await postCorrection(token, paymentId, {
      differenceMinor: "70000",
      bearer: "back_to_arrears",
      reason: "the whole handover turned out to be a bounced cheque",
      correctedOn: "2026-07-20",
    });
    expect(res.status).toBe(200);
    const body: CorrectionResponseBody = await res.json();
    expect(body.payment).toMatchObject({ amountMinor: "0", status: "reversed" });
    ctx.trackCreatedPaymentCorrection(body.correctionId);

    await ctx.cleanup();
  });

  it("409 — a fully reversed payment cannot be corrected again", async () => {
    const ctx = new TestContext(db);
    const { token, paymentId } = await setUpFullySettledObligation(ctx);

    const first = await postCorrection(token, paymentId, {
      differenceMinor: "70000",
      bearer: "back_to_arrears",
      reason: "fully reversed",
      correctedOn: "2026-07-20",
    });
    const firstBody: CorrectionResponseBody = await first.json();
    ctx.trackCreatedPaymentCorrection(firstBody.correctionId);

    const second = await postCorrection(token, paymentId, {
      differenceMinor: "1",
      bearer: "back_to_arrears",
      reason: "should not be possible",
      correctedOn: "2026-07-21",
    });
    expect(second.status).toBe(409);
    const body: { code: string } = await second.json();
    expect(body).toMatchObject({ code: "PAYMENT_ALREADY_REVERSED" });

    await ctx.cleanup();
  });

  it("400 — differenceMinor exceeds the payment's current recorded amount", async () => {
    const ctx = new TestContext(db);
    const { token, paymentId } = await setUpFullySettledObligation(ctx);

    const res = await postCorrection(token, paymentId, {
      differenceMinor: "70001",
      bearer: "back_to_arrears",
      reason: "more than was ever recorded",
      correctedOn: "2026-07-20",
    });
    expect(res.status).toBe(400);

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await postCorrection("", "11111111-1111-4111-8111-111111111111", {
      differenceMinor: "1",
      bearer: "back_to_arrears",
      reason: "x",
      correctedOn: "2026-07-20",
    });
    expect(res.status).toBe(401);
  });

  it("403 — a manager cannot reverse a receipt (owners only)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const manager = await mintUser(db, ctx, businessId, "manager");
    const token = await signAccessToken(manager.asgardeoSub);

    const res = await postCorrection(token, "11111111-1111-4111-8111-111111111111", {
      differenceMinor: "1",
      bearer: "back_to_arrears",
      reason: "x",
      correctedOn: "2026-07-20",
    });
    expect(res.status).toBe(403);

    await ctx.cleanup();
  });

  it("404 — the payment belongs to another business", async () => {
    const ctx = new TestContext(db);
    const other = new TestContext(db);
    const { paymentId } = await setUpFullySettledObligation(other);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postCorrection(token, paymentId, {
      differenceMinor: "1",
      bearer: "back_to_arrears",
      reason: "x",
      correctedOn: "2026-07-20",
    });
    expect(res.status).toBe(404);

    await ctx.cleanup();
    await other.cleanup();
  });

  it("GAP-14 — two sequential back_to_arrears corrections against one payment both unwind, and the correction rows sum to the total", async () => {
    const ctx = new TestContext(db);
    const { obligationId, token, paymentId } = await setUpFullySettledObligation(ctx);

    const first = await postCorrection(token, paymentId, {
      differenceMinor: "20000",
      bearer: "back_to_arrears",
      reason: "first shortfall found at banking",
      correctedOn: "2026-07-20",
    });
    expect(first.status).toBe(200);
    const firstBody: CorrectionResponseBody = await first.json();
    expect(firstBody.payment).toMatchObject({ amountMinor: "50000", status: "corrected" });
    ctx.trackCreatedPaymentCorrection(firstBody.correctionId);

    const afterFirst = await readObligation(obligationId);
    expect(afterFirst).toMatchObject({
      amountMinor: 70_000n,
      settledMinor: 50_000n,
      status: "part_paid",
    });

    // The second correction unwinds allocations the first already reduced
    // — the same payment, corrected a second time, not a fresh mistake.
    const second = await postCorrection(token, paymentId, {
      differenceMinor: "10000",
      bearer: "back_to_arrears",
      reason: "a second shortfall found the following week",
      correctedOn: "2026-07-27",
    });
    expect(second.status).toBe(200);
    const secondBody: CorrectionResponseBody = await second.json();
    expect(secondBody.payment).toMatchObject({ amountMinor: "40000", status: "corrected" });
    ctx.trackCreatedPaymentCorrection(secondBody.correctionId);

    const afterSecond = await readObligation(obligationId);
    expect(afterSecond).toMatchObject({
      amountMinor: 70_000n,
      settledMinor: 40_000n,
      status: "part_paid",
    });

    // INV-21: two rows, one per correction, never an edit to either —
    // and they sum to the total corrected off the payment (30,000).
    const correctionRows = await db
      .select({ differenceMinor: paymentCorrection.differenceMinor })
      .from(paymentCorrection)
      .where(eq(paymentCorrection.paymentId, paymentId));
    expect(correctionRows).toHaveLength(2);
    const totalCorrected = correctionRows.reduce((sum, r) => sum + r.differenceMinor, 0n);
    expect(totalCorrected).toBe(30_000n);

    await ctx.cleanup();
  });

  it("succeeds even after the payment's own period has closed (migration 0006)", async () => {
    const ctx = new TestContext(db);
    const { businessId, periodId, token, paymentId } = await setUpFullySettledObligation(ctx);
    await ctx.closePeriod(periodId);
    await ctx.createOpenPeriod(businessId, { periodStart: "2026-08-01", periodEnd: "2026-08-31" });

    const res = await postCorrection(token, paymentId, {
      differenceMinor: "2000",
      bearer: "back_to_arrears",
      reason: "found after July closed",
      correctedOn: "2026-08-05",
    });
    expect(res.status).toBe(200);
    const body: CorrectionResponseBody = await res.json();
    ctx.trackCreatedPaymentCorrection(body.correctionId);

    await ctx.cleanup();
  });

  /**
   * GAP-229/F-8.2's credit-first bullet: a correction must draw on this
   * payment's own unallocated credit before it reopens anything the
   * obligation already shows as settled. The review's own example — 45,000
   * owed, 50,000 paid, corrected to 49,000 — is the first row: the whole
   * 1,000 difference is smaller than the 5,000 credit, so nothing reopens
   * and the obligation stays fully paid.
   */
  it.each([
    {
      label: "the difference is smaller than the credit — nothing reopens",
      differenceMinor: "1000",
      expectedPaymentAmountMinor: "49000",
      expectedAllocatedMinor: 45_000n,
      expectedObligation: { settledMinor: 45_000n, status: "paid" as const },
    },
    {
      label: "the difference exactly equals the credit — nothing reopens",
      differenceMinor: "5000",
      expectedPaymentAmountMinor: "45000",
      expectedAllocatedMinor: 45_000n,
      expectedObligation: { settledMinor: 45_000n, status: "paid" as const },
    },
    {
      label: "the difference exceeds the credit — only the excess reopens",
      differenceMinor: "6000",
      expectedPaymentAmountMinor: "44000",
      expectedAllocatedMinor: 44_000n,
      expectedObligation: { settledMinor: 44_000n, status: "part_paid" as const },
    },
  ])(
    "back_to_arrears, customer — $label",
    async ({
      differenceMinor,
      expectedPaymentAmountMinor,
      expectedAllocatedMinor,
      expectedObligation,
    }) => {
      const ctx = new TestContext(db);
      const { obligationId, token, paymentId } = await setUpObligationWithCredit(
        ctx,
        "customer",
        45_000n,
        50_000n,
      );

      const res = await postCorrection(token, paymentId, {
        differenceMinor,
        bearer: "back_to_arrears",
        reason: "found short at banking, less than the surplus already held",
        correctedOn: "2026-07-20",
      });
      expect(res.status).toBe(200);
      const body: CorrectionResponseBody = await res.json();
      expect(body.payment).toMatchObject({
        amountMinor: expectedPaymentAmountMinor,
        status: "corrected",
      });
      ctx.trackCreatedPaymentCorrection(body.correctionId);

      expect(await readAllocatedTotal(paymentId)).toBe(expectedAllocatedMinor);
      const after = await readObligation(obligationId);
      expect(after).toMatchObject({ amountMinor: 45_000n, ...expectedObligation });

      await ctx.cleanup();
    },
  );

  /**
   * GAP-229: `absorbed_loss` unwinds nothing today (W-37) and needs no
   * change — this pins that down with the same credit-bearing payment the
   * `back_to_arrears` cases above use, so a future edit to the shared
   * `unwindAllocations` helper cannot silently start touching this branch.
   */
  it.each(["1000", "5000", "6000"])(
    "absorbed_loss, customer — a %s difference against a credit-bearing payment still unwinds nothing",
    async (differenceMinor) => {
      const ctx = new TestContext(db);
      const { obligationId, token, paymentId } = await setUpObligationWithCredit(
        ctx,
        "customer",
        45_000n,
        50_000n,
      );

      const res = await postCorrection(token, paymentId, {
        differenceMinor,
        bearer: "absorbed_loss",
        reason: "the business absorbs this regardless of the surplus held",
        correctedOn: "2026-07-20",
      });
      expect(res.status).toBe(200);
      const body: CorrectionResponseBody = await res.json();
      ctx.trackCreatedPaymentCorrection(body.correctionId);

      expect(await readAllocatedTotal(paymentId)).toBe(45_000n);
      const after = await readObligation(obligationId);
      expect(after).toMatchObject({ amountMinor: 45_000n, settledMinor: 45_000n, status: "paid" });

      await ctx.cleanup();
    },
  );

  it("back_to_arrears, driver — a driver_fee payment's own credit is drawn first before the excess reopens it", async () => {
    const ctx = new TestContext(db);
    const { obligationId, token, paymentId } = await setUpObligationWithCredit(
      ctx,
      "driver",
      45_000n,
      50_000n,
    );

    const res = await postCorrection(token, paymentId, {
      differenceMinor: "6000",
      bearer: "back_to_arrears",
      reason: "overpaid the driver by 6,000, only 1,000 beyond what was already surplus",
      correctedOn: "2026-07-20",
    });
    expect(res.status).toBe(200);
    const body: CorrectionResponseBody = await res.json();
    expect(body.payment).toMatchObject({ amountMinor: "44000", status: "corrected" });
    ctx.trackCreatedPaymentCorrection(body.correctionId);

    expect(await readAllocatedTotal(paymentId)).toBe(44_000n);
    const after = await readObligation(obligationId);
    expect(after).toMatchObject({
      amountMinor: 45_000n,
      settledMinor: 44_000n,
      status: "part_paid",
    });

    await ctx.cleanup();
  });

  /**
   * GAP-229: the credit a correction must draw on first is not only what
   * this payment left unallocated at the moment it was taken — GAP-5b can
   * have drawn part of it forward onto a second obligation since. A trip
   * created against a customer already sitting on credit settles itself
   * from that credit on the spot (`credit-forward.ts`), leaving a second,
   * newer `payment_allocation` row against the same payment. The
   * unallocated total this correction must respect is what's left after
   * that draw, not the original surplus.
   */
  it("back_to_arrears, customer — credit already drawn forward by a second obligation (GAP-5b) is respected", async () => {
    const ctx = new TestContext(db);
    const { businessId, partyId, obligationId, token, paymentId } = await setUpObligationWithCredit(
      ctx,
      "customer",
      40_000n,
      50_000n,
    );
    // 10,000 credit left. A new trip_fare of 6,000 draws 6,000 of it forward
    // (GAP-5b), leaving 4,000 unallocated.
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "C");
    const tripRes = await request("/api/trip", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...bearer(token).headers },
      body: JSON.stringify({
        vehicleId,
        customerId: partyId,
        startDate: "2026-07-16",
        endDate: "2026-07-16",
        agreedAmountMinor: "6000",
      }),
    });
    expect(tripRes.status).toBe(201);
    const tripBody: { id: string } = await tripRes.json();
    ctx.trackCreatedTrip(tripBody.id);

    const tripObligationRows = await db
      .select({ id: obligation.id, settledMinor: obligation.settledMinor })
      .from(obligation)
      .where(and(eq(obligation.sourceType, "trip"), eq(obligation.sourceId, tripBody.id)));
    expect(tripObligationRows).toMatchObject([{ settledMinor: 6_000n }]);
    const tripObligationId = tripObligationRows[0]!.id;
    expect(await readAllocatedTotal(paymentId)).toBe(46_000n);

    // Only 4,000 unallocated remains. A 5,000 correction is 1,000 beyond
    // it — that excess unwinds the newest allocation first (the trip's
    // own, GAP-14's convention), not the original rent obligation.
    const res = await postCorrection(token, paymentId, {
      differenceMinor: "5000",
      bearer: "back_to_arrears",
      reason: "found short at banking, more than the credit left after the trip drew on it",
      correctedOn: "2026-07-20",
    });
    expect(res.status).toBe(200);
    const body: CorrectionResponseBody = await res.json();
    expect(body.payment).toMatchObject({ amountMinor: "45000", status: "corrected" });
    ctx.trackCreatedPaymentCorrection(body.correctionId);

    expect(await readAllocatedTotal(paymentId)).toBe(45_000n);
    const rentAfter = await readObligation(obligationId);
    expect(rentAfter).toMatchObject({
      amountMinor: 40_000n,
      settledMinor: 40_000n,
      status: "paid",
    });
    const tripAfter = await readObligation(tripObligationId);
    expect(tripAfter).toMatchObject({
      amountMinor: 6_000n,
      settledMinor: 5_000n,
      status: "part_paid",
    });

    await ctx.cleanup();
  });

  /**
   * GAP-229 review finding, 14 Sept 2026: `absorbed_loss` never touches
   * allocations (only `back_to_arrears` calls `unwindAllocations`), so it
   * can reduce `payment.amountMinor` below what is already allocated —
   * exactly what this test's own first correction does. Without clamping
   * `unallocatedMinor` at zero, a later `back_to_arrears` correction on the
   * same payment reads that negative figure as extra credit and unwinds
   * more than its own `differenceMinor`, reopening arrears the party does
   * not owe (INV-22). Confirmed failing against the pre-clamp code first.
   */
  it("back_to_arrears, customer — credit already negative from a prior absorbed_loss correction unwinds only its own differenceMinor", async () => {
    const ctx = new TestContext(db);
    const { obligationId, token, paymentId } = await setUpObligationWithCredit(
      ctx,
      "customer",
      45_000n,
      50_000n,
    );

    // absorbed_loss never touches allocations — this alone drives
    // paymentAmountMinor (42,000) below allocatedMinor (45,000).
    const absorbed = await postCorrection(token, paymentId, {
      differenceMinor: "8000",
      bearer: "absorbed_loss",
      reason: "a bad note accepted at handover, the business eats it",
      correctedOn: "2026-07-18",
    });
    expect(absorbed.status).toBe(200);
    const absorbedBody: CorrectionResponseBody = await absorbed.json();
    expect(absorbedBody.payment).toMatchObject({ amountMinor: "42000", status: "corrected" });
    ctx.trackCreatedPaymentCorrection(absorbedBody.correctionId);
    expect(await readAllocatedTotal(paymentId)).toBe(45_000n);

    const res = await postCorrection(token, paymentId, {
      differenceMinor: "2000",
      bearer: "back_to_arrears",
      reason: "found short at banking, after the earlier absorbed loss",
      correctedOn: "2026-07-20",
    });
    expect(res.status).toBe(200);
    const body: CorrectionResponseBody = await res.json();
    expect(body.payment).toMatchObject({ amountMinor: "40000", status: "corrected" });
    ctx.trackCreatedPaymentCorrection(body.correctionId);

    // Correct (clamped): unallocatedMinor is max(0, 42,000-45,000) = 0, so
    // the full 2,000 unwinds. Pre-fix, unallocatedMinor was -3,000 and
    // remaining became 2,000-(-3,000) = 5,000 — five times too much.
    expect(await readAllocatedTotal(paymentId)).toBe(43_000n);
    const after = await readObligation(obligationId);
    expect(after).toMatchObject({
      amountMinor: 45_000n,
      settledMinor: 43_000n,
      status: "part_paid",
    });

    await ctx.cleanup();
  });
});
