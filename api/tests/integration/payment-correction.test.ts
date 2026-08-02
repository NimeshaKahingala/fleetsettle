import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { obligation } from "../../src/db/schema.js";
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
});
