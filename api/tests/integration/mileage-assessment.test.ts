import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { mintLinkedDriver, mintUser, signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

async function postLease(token: string, body: unknown) {
  return request("/api/lease", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

async function postBillingPeriod(token: string, leaseId: string) {
  return request(`/api/lease/${leaseId}/billing-period`, {
    method: "POST",
    headers: bearer(token).headers,
  });
}

async function listBillingPeriods(token: string, leaseId: string) {
  return request(`/api/lease/${leaseId}/billing-period`, bearer(token));
}

async function postOdometerReading(token: string, body: unknown) {
  return request("/api/mileage-assessment", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

interface MileageAssessmentResponseBody {
  id: string;
  drivenKm: number;
  combinedAllowanceKm: number;
  excessKm: number;
  excessAmountMinor: string;
  isEstimated: boolean;
  autoWaived: boolean;
  obligationId: string | null;
  splits: Array<{ billingPeriodId: string; apportionedKm: number; apportionedExcessMinor: string }>;
}

/**
 * P5, F-2.3/UC-14. §7.3's own worked example, reproduced through the real
 * endpoints rather than re-derived: a car let open-ended from 12 January,
 * billed monthly, limit 100km/day, excess 25/km. G-3 is this test's own
 * "Done means" bar (TRACKER.md P5) — days 31/28/31/30, allowances
 * 3,100/2,800/3,100/3,000, excesses 3,500 / nothing / combined 7,500 split
 * 152/148 and marked estimated.
 */
describe("mileage assessment (P5, F-2.3/UC-14) — G-3 reproduces exactly", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("reproduces §7.3 exactly across four billing periods", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId, { periodStart: "2026-01-01", periodEnd: "2026-12-31" });
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "A");
    const customerId = await ctx.createCustomer(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    // F-2.1: start the lease. One transaction writes the handover reading
    // (0km) and generates billing period 1 — 12 Jan to 11 Feb, 31 days,
    // allowance 100 * 31 = 3,100, rent 70,000 (W-25: fixed regardless).
    const leaseRes = await postLease(token, {
      vehicleId,
      customerId,
      startDate: "2026-01-12",
      billingDay: 12,
      rentAmountMinor: "70000",
      mileageDailyLimitKm: 100,
      mileageExcessRateMinor: "25",
      odometerReadingKm: 0,
      odometerSource: "in_person",
    });
    expect(leaseRes.status).toBe(201);
    const { id: leaseId }: { id: string } = await leaseRes.json();
    ctx.trackCreatedLease(leaseId);

    const periodsAfterCreate: Array<{ seq: number; daysCount: number; allowanceKm: number }> =
      await (await listBillingPeriods(token, leaseId)).json();
    expect(periodsAfterCreate).toHaveLength(1);
    expect(periodsAfterCreate[0]).toMatchObject({ seq: 1, daysCount: 31, allowanceKm: 3100 });

    // F-2.3: reading at the end of period 1 — 3,240 driven against a 3,100
    // allowance is 140 over, charged at 25/km = 3,500.
    const assess1 = await postOdometerReading(token, {
      leaseId,
      readingKm: 3240,
      readOn: "2026-02-11",
      source: "in_person",
    });
    expect(assess1.status).toBe(201);
    const body1: MileageAssessmentResponseBody = await assess1.json();
    expect(body1).toMatchObject({
      drivenKm: 3240,
      combinedAllowanceKm: 3100,
      excessKm: 140,
      excessAmountMinor: "3500",
      isEstimated: false,
      autoWaived: false,
    });
    expect(body1.obligationId).not.toBeNull();
    expect(body1.splits).toEqual([]);

    // Period 2 — 12 Feb to 11 Mar, 28 days, allowance 2,800.
    const period2Res = await postBillingPeriod(token, leaseId);
    expect(period2Res.status).toBe(201);
    expect(await period2Res.json()).toMatchObject({ seq: 2, daysCount: 28, allowanceKm: 2800 });

    // Reading at the end of period 2 — 2,650 driven, under the 2,800
    // allowance: nothing charged, the 150km forfeited with no carry-forward.
    const assess2 = await postOdometerReading(token, {
      leaseId,
      readingKm: 3240 + 2650,
      readOn: "2026-03-11",
      source: "in_person",
    });
    expect(assess2.status).toBe(201);
    const body2: MileageAssessmentResponseBody = await assess2.json();
    expect(body2).toMatchObject({
      drivenKm: 2650,
      combinedAllowanceKm: 2800,
      excessKm: 0,
      excessAmountMinor: "0",
      isEstimated: false,
    });
    expect(body2.obligationId).toBeNull();

    // Period 3 (12 Mar–11 Apr, 31 days, allowance 3,100) — no reading taken.
    const period3Res = await postBillingPeriod(token, leaseId);
    expect(period3Res.status).toBe(201);
    expect(await period3Res.json()).toMatchObject({ seq: 3, daysCount: 31, allowanceKm: 3100 });

    // Period 4 (12 Apr–11 May, 30 days, allowance 3,000).
    const period4Res = await postBillingPeriod(token, leaseId);
    expect(period4Res.status).toBe(201);
    expect(await period4Res.json()).toMatchObject({ seq: 4, daysCount: 30, allowanceKm: 3000 });

    // The next reading combines periods 3 and 4 against their combined
    // allowance of 6,100: 6,400 driven is 300 over, 7,500 charged, split
    // 152/148 by days (31/30) and marked estimated.
    const assess3 = await postOdometerReading(token, {
      leaseId,
      readingKm: 3240 + 2650 + 6400,
      readOn: "2026-05-11",
      source: "in_person",
    });
    expect(assess3.status).toBe(201);
    const body3: MileageAssessmentResponseBody = await assess3.json();
    expect(body3).toMatchObject({
      drivenKm: 6400,
      combinedAllowanceKm: 6100,
      excessKm: 300,
      excessAmountMinor: "7500",
      isEstimated: true,
      autoWaived: false,
    });
    expect(body3.obligationId).not.toBeNull();
    expect(body3.splits).toHaveLength(2);
    const [bigger, smaller] = [...body3.splits].sort((a, b) => b.apportionedKm - a.apportionedKm);
    if (!bigger || !smaller) throw new Error("expected exactly two splits");
    expect(bigger).toMatchObject({ apportionedKm: 152, apportionedExcessMinor: "3800" });
    expect(smaller).toMatchObject({ apportionedKm: 148, apportionedExcessMinor: "3700" });
    expect(bigger.apportionedKm + smaller.apportionedKm).toBe(300);
    expect(BigInt(bigger.apportionedExcessMinor) + BigInt(smaller.apportionedExcessMinor)).toBe(
      7500n,
    );

    await ctx.cleanup();
  });

  it("auto-waives an excess at or below the business's threshold (F-2.4)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId, { periodStart: "2026-01-01", periodEnd: "2026-12-31" });
    await ctx.setAutoWaiveThreshold(businessId, 5000n);
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "A");
    const customerId = await ctx.createCustomer(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const leaseRes = await postLease(token, {
      vehicleId,
      customerId,
      startDate: "2026-01-12",
      billingDay: 12,
      rentAmountMinor: "70000",
      mileageDailyLimitKm: 100,
      mileageExcessRateMinor: "25",
      odometerReadingKm: 0,
      odometerSource: "in_person",
    });
    expect(leaseRes.status).toBe(201);
    const { id: leaseId }: { id: string } = await leaseRes.json();
    ctx.trackCreatedLease(leaseId);

    // 140km over * 25 = 3,500 — at or below the 5,000 threshold.
    const res = await postOdometerReading(token, {
      leaseId,
      readingKm: 3240,
      readOn: "2026-02-11",
      source: "in_person",
    });
    expect(res.status).toBe(201);
    const body: MileageAssessmentResponseBody = await res.json();
    expect(body).toMatchObject({ excessAmountMinor: "3500", autoWaived: true });
    expect(body.obligationId).not.toBeNull();

    await ctx.cleanup();
  });

  it("is idempotent — the same lease and date is a no-op replay, not a duplicate assessment", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId, { periodStart: "2026-01-01", periodEnd: "2026-12-31" });
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "A");
    const customerId = await ctx.createCustomer(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const leaseRes = await postLease(token, {
      vehicleId,
      customerId,
      startDate: "2026-01-12",
      billingDay: 12,
      rentAmountMinor: "70000",
      mileageDailyLimitKm: 100,
      mileageExcessRateMinor: "25",
      odometerReadingKm: 0,
      odometerSource: "in_person",
    });
    const { id: leaseId }: { id: string } = await leaseRes.json();
    ctx.trackCreatedLease(leaseId);

    const body = { leaseId, readingKm: 3240, readOn: "2026-02-11", source: "in_person" };
    const first = await postOdometerReading(token, body);
    expect(first.status).toBe(201);
    const firstJson: MileageAssessmentResponseBody = await first.json();

    const second = await postOdometerReading(token, body);
    expect(second.status).toBe(200);
    const secondJson: MileageAssessmentResponseBody = await second.json();
    expect(secondJson.id).toBe(firstJson.id);
    expect(secondJson).toMatchObject({ excessAmountMinor: "3500" });

    await ctx.cleanup();
  });

  it("400 — the reading moved backwards", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId, { periodStart: "2026-01-01", periodEnd: "2026-12-31" });
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "A");
    const customerId = await ctx.createCustomer(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const leaseRes = await postLease(token, {
      vehicleId,
      customerId,
      startDate: "2026-01-12",
      billingDay: 12,
      rentAmountMinor: "70000",
      mileageDailyLimitKm: 100,
      mileageExcessRateMinor: "25",
      odometerReadingKm: 500,
      odometerSource: "in_person",
    });
    const { id: leaseId }: { id: string } = await leaseRes.json();
    ctx.trackCreatedLease(leaseId);

    const res = await postOdometerReading(token, {
      leaseId,
      readingKm: 100,
      readOn: "2026-02-11",
      source: "in_person",
    });
    expect(res.status).toBe(400);

    await ctx.cleanup();
  });

  it("GAP-164: 400 with a clear message, not a 500, for a reading dated on the lease's own handover date", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId, { periodStart: "2026-01-01", periodEnd: "2026-12-31" });
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "A");
    const customerId = await ctx.createCustomer(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    // The handover reading is written directly by startLease (lease.ts),
    // never through assessMileage — so it has no mileage_assessment behind
    // it. A later submission dated on that same day used to fall through to
    // a doomed second insert and surface a raw unique-violation as a 500.
    const leaseRes = await postLease(token, {
      vehicleId,
      customerId,
      startDate: "2026-01-12",
      billingDay: 12,
      rentAmountMinor: "70000",
      mileageDailyLimitKm: 100,
      mileageExcessRateMinor: "25",
      odometerReadingKm: 0,
      odometerSource: "in_person",
    });
    const { id: leaseId }: { id: string } = await leaseRes.json();
    ctx.trackCreatedLease(leaseId);

    const res = await postOdometerReading(token, {
      leaseId,
      readingKm: 0,
      readOn: "2026-01-12",
      source: "in_person",
    });
    expect(res.status).toBe(400);
    const body: { code: string; error: string } = await res.json();
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.error).toMatch(/already exists/);

    await ctx.cleanup();
  });

  it("400 — no prior odometer reading (a mileage limit added after the lease started, via renew)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId, { periodStart: "2026-01-01", periodEnd: "2026-12-31" });
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "A");
    const customerId = await ctx.createCustomer(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const leaseRes = await postLease(token, {
      vehicleId,
      customerId,
      startDate: "2026-01-12",
      billingDay: 12,
      rentAmountMinor: "70000",
    });
    const { id: leaseId }: { id: string } = await leaseRes.json();
    ctx.trackCreatedLease(leaseId);

    await request(`/api/lease/${leaseId}/renew`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...bearer(token).headers },
      body: JSON.stringify({
        rentAmountMinor: "70000",
        mileageDailyLimitKm: 100,
        mileageExcessRateMinor: "25",
      }),
    });

    const res = await postOdometerReading(token, {
      leaseId,
      readingKm: 100,
      readOn: "2026-02-11",
      source: "in_person",
    });
    expect(res.status).toBe(400);

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await postOdometerReading("", {
      leaseId: "11111111-1111-4111-8111-111111111111",
      readingKm: 100,
      readOn: "2026-02-11",
      source: "in_person",
    });
    expect(res.status).toBe(401);
  });

  it("403 — a linked driver cannot record an odometer reading", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId, { periodStart: "2026-01-01", periodEnd: "2026-12-31" });
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await postOdometerReading(token, {
      leaseId: "11111111-1111-4111-8111-111111111111",
      readingKm: 100,
      readOn: "2026-02-11",
      source: "in_person",
    });
    expect(res.status).toBe(403);

    await ctx.cleanup();
  });

  it("404 — the lease belongs to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId, { periodStart: "2026-01-01", periodEnd: "2026-12-31" });
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherVehicleId = await ctx.createVehicle(otherBusinessId);
    const otherCustomerId = await ctx.createCustomer(otherBusinessId);
    const otherLeaseId = await ctx.createLease(otherBusinessId, otherVehicleId, otherCustomerId, {
      status: "active",
      mileageDailyLimitKm: 100,
      mileageExcessRateMinor: 25n,
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postOdometerReading(token, {
      leaseId: otherLeaseId,
      readingKm: 100,
      readOn: "2026-02-11",
      source: "in_person",
    });
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("409 — a closed accounting period rejects the write", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId, {
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
    });
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "A");
    const customerId = await ctx.createCustomer(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const leaseRes = await postLease(token, {
      vehicleId,
      customerId,
      startDate: "2026-01-12",
      billingDay: 12,
      rentAmountMinor: "70000",
      mileageDailyLimitKm: 100,
      mileageExcessRateMinor: "25",
      odometerReadingKm: 0,
      odometerSource: "in_person",
    });
    const { id: leaseId }: { id: string } = await leaseRes.json();
    ctx.trackCreatedLease(leaseId);

    await ctx.closePeriod(periodId);

    const res = await postOdometerReading(token, {
      leaseId,
      readingKm: 3240,
      readOn: "2026-02-11",
      source: "in_person",
    });
    expect(res.status).toBe(409);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "PERIOD_CLOSED" });

    await ctx.cleanup();
  });
});
