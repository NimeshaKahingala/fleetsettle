import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { ownershipShare } from "../../src/db/schema.js";
import { mintLinkedDriver, mintUser, signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

async function post(path: string, token: string, body: unknown) {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

/** F-1.3/UC-02/INV-16 test matrix. */
describe("ownership shares (P7, F-1.3/UC-02)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — a 60/40 split totalling exactly 100%", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const partner = await mintUser(db, ctx, businessId, "owner_manager");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await post("/api/ownership-share", token, {
      vehicleId,
      effectiveFrom: "2026-01-01",
      shares: [
        { userId: owner.userId, shareBp: 6000 },
        { userId: partner.userId, shareBp: 4000 },
      ],
    });
    expect(res.status).toBe(201);
    const body: Array<{ id: string; userId: string; shareBp: number }> = await res.json();
    expect(body).toHaveLength(2);
    expect(body.map((s) => s.shareBp).sort()).toEqual([4000, 6000]);
    ctx.trackCreatedOwnershipShares(body.map((s) => s.id));

    await ctx.cleanup();
  });

  it("400 — shares that do not total 100% (INV-16)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await post("/api/ownership-share", token, {
      vehicleId,
      effectiveFrom: "2026-01-01",
      shares: [{ userId: owner.userId, shareBp: 6000 }],
    });
    expect(res.status).toBe(400);
    const body: { code: string } = await res.json();
    expect(body).toMatchObject({ code: "OWNERSHIP_SHARES_INVALID" });

    // The rejected transaction must not have left a partial row behind.
    const rows = await db
      .select()
      .from(ownershipShare)
      .where(eq(ownershipShare.vehicleId, vehicleId));
    expect(rows).toHaveLength(0);

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request("/api/ownership-share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "MISSING_TOKEN" });
  });

  it("403 — a manager (not an owner) cannot record ownership shares", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const manager = await mintUser(db, ctx, businessId, "manager");
    const token = await signAccessToken(manager.asgardeoSub);

    const res = await post("/api/ownership-share", token, {
      vehicleId,
      effectiveFrom: "2026-01-01",
      shares: [{ userId: manager.userId, shareBp: 10000 }],
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

    await ctx.cleanup();
  });

  it("404 — the vehicle belongs to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherVehicleId = await ctx.createVehicle(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await post("/api/ownership-share", token, {
      vehicleId: otherVehicleId,
      effectiveFrom: "2026-01-01",
      shares: [{ userId: owner.userId, shareBp: 10000 }],
    });
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("404 — a share names a user who is not a member of this business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);
    const stranger = await mintUser(db, ctx, await ctx.createBusiness({ name: "Other" }), "owner");

    const res = await post("/api/ownership-share", token, {
      vehicleId,
      effectiveFrom: "2026-01-01",
      shares: [{ userId: stranger.userId, shareBp: 10000 }],
    });
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });
});

/** F-1.3/UC-02/W-52 test matrix. */
describe("capital contribution (P7, F-1.3/UC-02)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — what a partner paid toward a vehicle", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await post("/api/capital-contribution", token, {
      vehicleId,
      userId: owner.userId,
      amountMinor: "500000000",
      contributedOn: "2026-07-15",
      note: "Down payment",
    });
    expect(res.status).toBe(201);
    const body: { id: string } = await res.json();
    expect(body).toMatchObject({
      vehicleId,
      userId: owner.userId,
      amountMinor: "500000000",
      note: "Down payment",
    });
    ctx.trackCreatedCapitalContribution(body.id);

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request("/api/capital-contribution", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "MISSING_TOKEN" });
  });

  it("403 — a manager (not an owner) cannot record a capital contribution", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const manager = await mintUser(db, ctx, businessId, "manager");
    const token = await signAccessToken(manager.asgardeoSub);

    const res = await post("/api/capital-contribution", token, {
      userId: manager.userId,
      amountMinor: "100000",
      contributedOn: "2026-07-15",
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

    await ctx.cleanup();
  });

  it("404 — the user is not a member of this business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);
    const stranger = await mintUser(db, ctx, await ctx.createBusiness({ name: "Other" }), "owner");

    const res = await post("/api/capital-contribution", token, {
      userId: stranger.userId,
      amountMinor: "100000",
      contributedOn: "2026-07-15",
    });
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("409 — a closed accounting period rejects the write", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    await ctx.closePeriod(periodId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await post("/api/capital-contribution", token, {
      userId: owner.userId,
      amountMinor: "100000",
      contributedOn: "2026-07-15",
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "PERIOD_CLOSED" });

    await ctx.cleanup();
  });
});

/** F-1.4/UC-03/W-53 test matrix. */
describe("management fee agreement (P7, F-1.4/UC-03)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — grant, then revoke", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const manager = await mintUser(db, ctx, businessId, "manager");
    const token = await signAccessToken(owner.asgardeoSub);

    const granted = await post("/api/management-fee-agreement", token, {
      vehicleId,
      managerUserId: manager.userId,
      monthlyFeeMinor: "1000000",
      effectiveFrom: "2026-01-01",
    });
    expect(granted.status).toBe(201);
    const grantedBody: { id: string; effectiveTo: string | null } = await granted.json();
    expect(grantedBody).toMatchObject({
      vehicleId,
      managerUserId: manager.userId,
      monthlyFeeMinor: "1000000",
      effectiveTo: null,
    });
    ctx.trackCreatedManagementFeeAgreement(grantedBody.id);

    const revoked = await post(`/api/management-fee-agreement/${grantedBody.id}/revoke`, token, {});
    expect(revoked.status).toBe(200);
    const revokedBody: { effectiveTo: string | null } = await revoked.json();
    expect(revokedBody.effectiveTo).not.toBeNull();

    await ctx.cleanup();
  });

  it("409 — a second agreement for the same vehicle and manager over an overlapping date range", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const manager = await mintUser(db, ctx, businessId, "manager");
    const token = await signAccessToken(owner.asgardeoSub);

    const first = await post("/api/management-fee-agreement", token, {
      vehicleId,
      managerUserId: manager.userId,
      effectiveFrom: "2026-01-01",
    });
    expect(first.status).toBe(201);
    const firstBody: { id: string } = await first.json();
    ctx.trackCreatedManagementFeeAgreement(firstBody.id);

    const second = await post("/api/management-fee-agreement", token, {
      vehicleId,
      managerUserId: manager.userId,
      effectiveFrom: "2026-02-01",
    });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ code: "MANAGEMENT_AGREEMENT_OVERLAPS" });

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request("/api/management-fee-agreement", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "MISSING_TOKEN" });
  });

  it("403 — a manager (not an owner) cannot grant a management agreement", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const manager = await mintUser(db, ctx, businessId, "manager");
    const token = await signAccessToken(manager.asgardeoSub);

    const res = await post("/api/management-fee-agreement", token, {
      vehicleId,
      managerUserId: manager.userId,
      effectiveFrom: "2026-01-01",
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

    await ctx.cleanup();
  });

  it("404 — revoking an agreement belonging to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherVehicleId = await ctx.createVehicle(otherBusinessId);
    const otherOwner = await mintUser(db, ctx, otherBusinessId, "owner");
    const otherManager = await mintUser(db, ctx, otherBusinessId, "manager");
    const otherToken = await signAccessToken(otherOwner.asgardeoSub);

    const created = await post("/api/management-fee-agreement", otherToken, {
      vehicleId: otherVehicleId,
      managerUserId: otherManager.userId,
      effectiveFrom: "2026-01-01",
    });
    const createdBody: { id: string } = await created.json();
    ctx.trackCreatedManagementFeeAgreement(createdBody.id);

    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await post(`/api/management-fee-agreement/${createdBody.id}/revoke`, token, {});
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });
});

/** F-7.4/UC-65/INV-23 test matrix. */
describe("banking event (P7, F-7.4/UC-65)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — no discrepancy", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await post("/api/banking-event", token, {
      amountRecordedMinor: "5000000",
      amountCountedMinor: "5000000",
      bankedOn: "2026-07-20",
      destination: "BOC current account",
    });
    expect(res.status).toBe(201);
    const body: { id: string } = await res.json();
    expect(body).toMatchObject({
      amountRecordedMinor: "5000000",
      amountCountedMinor: "5000000",
      discrepancyMinor: "0",
      discrepancyBearer: null,
    });
    ctx.trackCreatedBankingEvent(body.id);

    await ctx.cleanup();
  });

  it("happy path — a pooled shortfall absorbed as a cash-handling loss (INV-23)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await post("/api/banking-event", token, {
      amountRecordedMinor: "30000000",
      amountCountedMinor: "29700000",
      bankedOn: "2026-07-20",
      destination: "BOC current account",
      discrepancyBearer: "absorbed",
    });
    expect(res.status).toBe(201);
    const body: { id: string } = await res.json();
    expect(body).toMatchObject({
      discrepancyMinor: "300000",
      discrepancyBearer: "absorbed",
    });
    ctx.trackCreatedBankingEvent(body.id);

    await ctx.cleanup();
  });

  it("400 — a discrepancy with no bearer chosen", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await post("/api/banking-event", token, {
      amountRecordedMinor: "30000000",
      amountCountedMinor: "29700000",
      bankedOn: "2026-07-20",
      destination: "BOC current account",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "VALIDATION_ERROR" });

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request("/api/banking-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "MISSING_TOKEN" });
  });

  it("403 — a linked driver cannot record a banking event", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await post("/api/banking-event", token, {
      amountRecordedMinor: "100000",
      amountCountedMinor: "100000",
      bankedOn: "2026-07-20",
      destination: "BOC current account",
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

    await ctx.cleanup();
  });

  it("409 — a closed accounting period rejects the write", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    await ctx.closePeriod(periodId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await post("/api/banking-event", token, {
      amountRecordedMinor: "100000",
      amountCountedMinor: "100000",
      bankedOn: "2026-07-20",
      destination: "BOC current account",
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "PERIOD_CLOSED" });

    await ctx.cleanup();
  });
});

/** F-7.2/UC-63 test matrix. */
describe("partner payout (P7, F-7.2/UC-63)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — a payout is recorded, never as a vehicle cost", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await post("/api/partner-payout", token, {
      userId: owner.userId,
      amountMinor: "2000000",
      kind: "payout",
      occurredOn: "2026-07-25",
    });
    expect(res.status).toBe(201);
    const body: { id: string } = await res.json();
    expect(body).toMatchObject({
      userId: owner.userId,
      amountMinor: "2000000",
      kind: "payout",
    });
    ctx.trackCreatedPartnerPayout(body.id);

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request("/api/partner-payout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "MISSING_TOKEN" });
  });

  it("403 — a manager (not an owner) cannot record a partner payout", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const manager = await mintUser(db, ctx, businessId, "manager");
    const token = await signAccessToken(manager.asgardeoSub);

    const res = await post("/api/partner-payout", token, {
      userId: manager.userId,
      amountMinor: "100000",
      kind: "payout",
      occurredOn: "2026-07-25",
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

    await ctx.cleanup();
  });

  it("404 — the user is not a member of this business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);
    const stranger = await mintUser(db, ctx, await ctx.createBusiness({ name: "Other" }), "owner");

    const res = await post("/api/partner-payout", token, {
      userId: stranger.userId,
      amountMinor: "100000",
      kind: "payout",
      occurredOn: "2026-07-25",
    });
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("409 — a closed accounting period rejects the write", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    await ctx.closePeriod(periodId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await post("/api/partner-payout", token, {
      userId: owner.userId,
      amountMinor: "100000",
      kind: "payout",
      occurredOn: "2026-07-25",
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "PERIOD_CLOSED" });

    await ctx.cleanup();
  });
});
