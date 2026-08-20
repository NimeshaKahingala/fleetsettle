import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { mintLinkedDriver, mintUser, signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

async function postAdjustment(token: string, body: unknown) {
  return request("/api/adjustment", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

/**
 * F-2.4/UC-15/W-17 test matrix. A waiver raises `waived_minor` only — the
 * original amount stays "charged" — every other type changes `amount_minor`
 * itself. INV-14: a waiver never shares a bucket with a write-off (P10's own
 * table, not touched here at all).
 */
describe("adjust or waive an obligation (P4, F-2.4/UC-15)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — a waiver raises waived_minor and leaves amount_minor as originally charged", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);
    const obligationId = await ctx.createObligation(businessId, periodId, {
      driverId,
      amountMinor: 340_00n,
    });

    const res = await postAdjustment(token, {
      obligationId,
      adjustmentType: "waiver",
      amountMinor: "34000",
      sign: -1,
      reason: "Below the auto-waive threshold, waived by hand",
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      id: obligationId,
      amountMinor: "34000",
      waivedMinor: "34000",
      status: "waived",
    });

    await ctx.cleanup();
  });

  it("happy path — a late fee increases amount_minor itself, not waived_minor", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);
    const obligationId = await ctx.createObligation(businessId, periodId, {
      driverId,
      amountMinor: 500_00n,
    });

    const res = await postAdjustment(token, {
      obligationId,
      adjustmentType: "late_fee",
      amountMinor: "10000",
      sign: 1,
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      amountMinor: "60000",
      waivedMinor: "0",
      status: "pending",
    });

    await ctx.cleanup();
  });

  it("403 — a manual waiver above the auto-waive threshold needs an owner, not a manager", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const obligationId = await ctx.createObligation(businessId, periodId, {
      driverId,
      amountMinor: 500_000_00n,
    });
    const manager = await mintUser(db, ctx, businessId, "manager");
    const token = await signAccessToken(manager.asgardeoSub);

    // businessSettings.autoWaiveThresholdMinor defaults to 0 (OQ-3) — any positive waiver is "above threshold".
    const res = await postAdjustment(token, {
      obligationId,
      adjustmentType: "waiver",
      amountMinor: "100000",
      sign: -1,
    });
    expect(res.status).toBe(403);

    await ctx.cleanup();
  });

  it("400 — a waiver with sign +1 is rejected at the schema (a waiver always reduces what is owed)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const obligationId = await ctx.createObligation(businessId, periodId, { driverId });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postAdjustment(token, {
      obligationId,
      adjustmentType: "waiver",
      amountMinor: "10000",
      sign: 1,
    });
    expect(res.status).toBe(400);

    await ctx.cleanup();
  });

  it("400 — waiving more than remains unsettled on the obligation", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const obligationId = await ctx.createObligation(businessId, periodId, {
      driverId,
      amountMinor: 10_000n,
      settledMinor: 5_000n,
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postAdjustment(token, {
      obligationId,
      adjustmentType: "waiver",
      amountMinor: "6000",
      sign: -1,
    });
    expect(res.status).toBe(400);

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await postAdjustment("", {});
    expect(res.status).toBe(401);
  });

  it("404 — the obligation belongs to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherPeriodId = await ctx.createOpenPeriod(otherBusinessId);
    const otherDriverId = await ctx.createDriver(otherBusinessId);
    const otherObligationId = await ctx.createObligation(otherBusinessId, otherPeriodId, {
      driverId: otherDriverId,
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postAdjustment(token, {
      obligationId: otherObligationId,
      adjustmentType: "goodwill",
      amountMinor: "1000",
      sign: -1,
    });
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("409 — a closed accounting period rejects the write", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const obligationId = await ctx.createObligation(businessId, periodId, { driverId });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    await ctx.closePeriod(periodId);

    const res = await postAdjustment(token, {
      obligationId,
      adjustmentType: "goodwill",
      amountMinor: "1000",
      sign: -1,
    });
    expect(res.status).toBe(409);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "PERIOD_CLOSED" });

    await ctx.cleanup();
  });
});

async function getAdjustments(token: string, obligationId: string) {
  return request(`/api/adjustment?obligationId=${obligationId}`, bearer(token));
}

describe("GET /api/adjustment (GAP-147)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — every adjustment against this obligation, newest first", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);
    const obligationId = await ctx.createObligation(businessId, periodId, {
      driverId,
      amountMinor: 340_00n,
    });

    const firstRes = await postAdjustment(token, {
      obligationId,
      adjustmentType: "late_fee",
      amountMinor: "1000",
      sign: 1,
      reason: "Paid three days late",
    });
    expect(firstRes.status).toBe(201);
    const secondRes = await postAdjustment(token, {
      obligationId,
      adjustmentType: "goodwill",
      amountMinor: "500",
      sign: -1,
      reason: "Vehicle broke down for a day",
    });
    expect(secondRes.status).toBe(201);

    const res = await getAdjustments(token, obligationId);
    expect(res.status).toBe(200);
    const body: Array<{
      id: string;
      obligationId: string;
      adjustmentType: string;
      amountMinor: string;
      sign: -1 | 1;
      reason: string | null;
      voidedAt: string | null;
      voidedReason: string | null;
    }> = await res.json();
    expect(body).toHaveLength(2);
    // Newest first — the goodwill adjustment recorded after the late fee.
    expect(body[0]).toMatchObject({
      obligationId,
      adjustmentType: "goodwill",
      amountMinor: "500",
      sign: -1,
      reason: "Vehicle broke down for a day",
      voidedAt: null,
    });
    expect(body[1]).toMatchObject({ adjustmentType: "late_fee", amountMinor: "1000", sign: 1 });

    await ctx.cleanup();
  });

  it("a voided adjustment stays in the list, struck through with its reason (W-50)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);
    const obligationId = await ctx.createObligation(businessId, periodId, {
      driverId,
      amountMinor: 340_00n,
    });

    const createRes = await postAdjustment(token, {
      obligationId,
      adjustmentType: "late_fee",
      amountMinor: "1000",
      sign: 1,
    });
    const created: { adjustmentId: string } = await createRes.json();

    const voidRes = await request(`/api/adjustment/${created.adjustmentId}/void`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...bearer(token).headers },
      body: JSON.stringify({ reason: "Entered against the wrong obligation" }),
    });
    expect(voidRes.status).toBe(200);

    const res = await getAdjustments(token, obligationId);
    const body: Array<{ voidedAt: string | null; voidedReason: string | null }> = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0]?.voidedAt).not.toBeNull();
    expect(body[0]?.voidedReason).toBe("Entered against the wrong obligation");

    await ctx.cleanup();
  });

  it("404 — an obligation belonging to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherPeriodId = await ctx.createOpenPeriod(otherBusinessId);
    const otherDriverId = await ctx.createDriver(otherBusinessId);
    const otherObligationId = await ctx.createObligation(otherBusinessId, otherPeriodId, {
      driverId: otherDriverId,
      amountMinor: 100_00n,
    });

    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await getAdjustments(token, otherObligationId);
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await getAdjustments("", "11111111-1111-4111-8111-111111111111");
    expect(res.status).toBe(401);
  });

  it("403 — a linked driver cannot view adjustments (W-49)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await getAdjustments(token, "11111111-1111-4111-8111-111111111111");
    expect(res.status).toBe(403);

    await ctx.cleanup();
  });
});
