import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { mintUser, signAccessToken } from "../support/auth.js";
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
