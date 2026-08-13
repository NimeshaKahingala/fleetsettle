import { newId } from "@fleetsettle/shared";
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

async function get(path: string, token: string) {
  return request(path, bearer(token));
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

  it("400 — GAP-121: a share names a member who is a manager, not a partner", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const manager = await mintUser(db, ctx, businessId, "manager");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await post("/api/ownership-share", token, {
      vehicleId,
      effectiveFrom: "2026-01-01",
      shares: [{ userId: manager.userId, shareBp: 10000 }],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "VALIDATION_ERROR" });

    // Confirms the rejected write left no partial row, the same guard the
    // INV-16 total-mismatch test above already carries for this table.
    const rows = await db
      .select()
      .from(ownershipShare)
      .where(eq(ownershipShare.vehicleId, vehicleId));
    expect(rows).toHaveLength(0);

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

  it("400 — GAP-121: the user is a manager, not a partner", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const manager = await mintUser(db, ctx, businessId, "manager");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await post("/api/capital-contribution", token, {
      userId: manager.userId,
      amountMinor: "100000",
      contributedOn: "2026-07-15",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "VALIDATION_ERROR" });

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

/** A2/GAP-9 test matrix. */
describe("list ownership shares (A2, F-1.3/UC-02)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — only the latest set is 'current', an earlier one is superseded", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const partner = await mintUser(db, ctx, businessId, "owner_manager");
    const token = await signAccessToken(owner.asgardeoSub);

    // `setOwnershipShares` (domain/partner.ts) only ever inserts — there is
    // no write path today that closes an old set's `effective_to`, so a
    // second `POST` for the same vehicle always 400s (`assert_shares_total`
    // sums every row whose date range contains the *new* row's own
    // `effective_from`, and the still-open first set would push the total
    // to 200%). Inserted directly here, with the older set's `effective_to`
    // already closed, to prove `effective_to IS NULL` alone correctly
    // isolates the current split once one exists — the same direct-insert
    // fixture pattern `reports.test.ts` already uses for this exact table.
    const oldShareIds = [newId(), newId()];
    const newShareIds = [newId(), newId()];
    await db.insert(ownershipShare).values([
      {
        id: oldShareIds[0]!,
        vehicleId,
        userId: owner.userId,
        shareBp: 5000,
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-01-31",
      },
      {
        id: oldShareIds[1]!,
        vehicleId,
        userId: partner.userId,
        shareBp: 5000,
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-01-31",
      },
      {
        id: newShareIds[0]!,
        vehicleId,
        userId: owner.userId,
        shareBp: 6000,
        effectiveFrom: "2026-02-01",
      },
      {
        id: newShareIds[1]!,
        vehicleId,
        userId: partner.userId,
        shareBp: 4000,
        effectiveFrom: "2026-02-01",
      },
    ]);
    ctx.trackCreatedOwnershipShares([...oldShareIds, ...newShareIds]);

    const res = await get("/api/ownership-share", token);
    expect(res.status).toBe(200);
    const body: Array<{ userId: string; shareBp: number; effectiveFrom: string }> =
      await res.json();
    expect(body).toHaveLength(2);
    expect(body.every((s) => s.effectiveFrom === "2026-02-01")).toBe(true);
    expect(body.map((s) => s.shareBp).sort()).toEqual([4000, 6000]);

    await ctx.cleanup();
  });

  it("filters by vehicleId — another vehicle's split never appears", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const otherVehicleId = await ctx.createVehicle(businessId, { registration: "Other Vehicle" });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const created = await post("/api/ownership-share", token, {
      vehicleId,
      effectiveFrom: "2026-01-01",
      shares: [{ userId: owner.userId, shareBp: 10000 }],
    });
    const createdBody: Array<{ id: string }> = await created.json();
    ctx.trackCreatedOwnershipShares(createdBody.map((s) => s.id));
    const otherCreated = await post("/api/ownership-share", token, {
      vehicleId: otherVehicleId,
      effectiveFrom: "2026-01-01",
      shares: [{ userId: owner.userId, shareBp: 10000 }],
    });
    const otherCreatedBody: Array<{ id: string }> = await otherCreated.json();
    ctx.trackCreatedOwnershipShares(otherCreatedBody.map((s) => s.id));

    const res = await get(`/api/ownership-share?vehicleId=${vehicleId}`, token);
    expect(res.status).toBe(200);
    const body: Array<{ vehicleId: string }> = await res.json();
    expect(body.map((s) => s.vehicleId)).toEqual([vehicleId]);

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request("/api/ownership-share");
    expect(res.status).toBe(401);
  });

  it("403 — a manager (not an owner) cannot read ownership shares", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const manager = await mintUser(db, ctx, businessId, "manager");
    const token = await signAccessToken(manager.asgardeoSub);

    const res = await get("/api/ownership-share", token);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

    await ctx.cleanup();
  });

  it("GAP-1/W-59/D-17 — an owner-manager sees only his own vehicle's split, a plain owner sees every vehicle's", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const ownedVehicle = await ctx.createVehicle(businessId, { registration: "OWNED-1" });
    const otherVehicle = await ctx.createVehicle(businessId, { registration: "OTHER-1" });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const ownerManager = await mintUser(db, ctx, businessId, "owner_manager");
    const ownerToken = await signAccessToken(owner.asgardeoSub);
    const ownerManagerToken = await signAccessToken(ownerManager.asgardeoSub);

    const shareId = newId();
    await db.insert(ownershipShare).values({
      id: shareId,
      vehicleId: ownedVehicle,
      userId: ownerManager.userId,
      shareBp: 10000,
      effectiveFrom: "2026-01-01",
    });
    ctx.trackCreatedOwnershipShares([shareId]);
    const otherShareId = newId();
    await db.insert(ownershipShare).values({
      id: otherShareId,
      vehicleId: otherVehicle,
      userId: owner.userId,
      shareBp: 10000,
      effectiveFrom: "2026-01-01",
    });
    ctx.trackCreatedOwnershipShares([otherShareId]);

    const scopedRes = await get("/api/ownership-share", ownerManagerToken);
    expect(scopedRes.status).toBe(200);
    const scopedBody: Array<{ vehicleId: string }> = await scopedRes.json();
    expect(scopedBody.map((s) => s.vehicleId)).toEqual([ownedVehicle]);

    const unscopedRes = await get("/api/ownership-share", ownerToken);
    expect(unscopedRes.status).toBe(200);
    const unscopedBody: Array<{ vehicleId: string }> = await unscopedRes.json();
    expect(unscopedBody.map((s) => s.vehicleId).sort()).toEqual(
      [ownedVehicle, otherVehicle].sort(),
    );

    await ctx.cleanup();
  });

  it("403 — GAP-1/W-59/D-17: an owner-manager explicitly names a vehicle he has no share in", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherVehicle = await ctx.createVehicle(businessId, { registration: "OTHER-2" });
    const ownerManager = await mintUser(db, ctx, businessId, "owner_manager");
    const token = await signAccessToken(ownerManager.asgardeoSub);

    const res = await get(`/api/ownership-share?vehicleId=${otherVehicle}`, token);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

    await ctx.cleanup();
  });
});

/** A2/GAP-9/W-52 test matrix. */
describe("list capital contributions (A2, F-1.3/UC-02)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — newest first, tenant isolated", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    await ctx.createOpenPeriod(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);
    const otherOwner = await mintUser(db, ctx, otherBusinessId, "owner");
    const otherToken = await signAccessToken(otherOwner.asgardeoSub);

    const earlier = await post("/api/capital-contribution", token, {
      userId: owner.userId,
      amountMinor: "100000",
      contributedOn: "2026-07-01",
    });
    const earlierBody: { id: string } = await earlier.json();
    ctx.trackCreatedCapitalContribution(earlierBody.id);
    const later = await post("/api/capital-contribution", token, {
      userId: owner.userId,
      amountMinor: "200000",
      contributedOn: "2026-07-15",
    });
    const laterBody: { id: string } = await later.json();
    ctx.trackCreatedCapitalContribution(laterBody.id);
    const otherRes = await post("/api/capital-contribution", otherToken, {
      userId: otherOwner.userId,
      amountMinor: "999999",
      contributedOn: "2026-07-10",
    });
    const otherResBody: { id: string } = await otherRes.json();
    ctx.trackCreatedCapitalContribution(otherResBody.id);

    const res = await get("/api/capital-contribution", token);
    expect(res.status).toBe(200);
    const body: Array<{ amountMinor: string; contributedOn: string }> = await res.json();
    expect(body.map((c) => c.contributedOn)).toEqual(["2026-07-15", "2026-07-01"]);

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request("/api/capital-contribution");
    expect(res.status).toBe(401);
  });

  it("403 — a manager (not an owner) cannot read capital contributions", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const manager = await mintUser(db, ctx, businessId, "manager");
    const token = await signAccessToken(manager.asgardeoSub);

    const res = await get("/api/capital-contribution", token);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

    await ctx.cleanup();
  });

  it("GAP-1/W-59/D-17 — an owner-manager sees his own vehicle's contribution and every business-wide (no-vehicle) one, never another vehicle's", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const ownedVehicle = await ctx.createVehicle(businessId, { registration: "OWNED-3" });
    const otherVehicle = await ctx.createVehicle(businessId, { registration: "OTHER-3" });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const ownerManager = await mintUser(db, ctx, businessId, "owner_manager");
    const ownerToken = await signAccessToken(owner.asgardeoSub);
    const ownerManagerToken = await signAccessToken(ownerManager.asgardeoSub);

    const shareId = newId();
    await db.insert(ownershipShare).values({
      id: shareId,
      vehicleId: ownedVehicle,
      userId: ownerManager.userId,
      shareBp: 10000,
      effectiveFrom: "2026-01-01",
    });
    ctx.trackCreatedOwnershipShares([shareId]);

    const ownedContribution = await post("/api/capital-contribution", ownerToken, {
      vehicleId: ownedVehicle,
      userId: owner.userId,
      amountMinor: "100000",
      contributedOn: "2026-07-01",
    });
    const ownedBody: { id: string } = await ownedContribution.json();
    ctx.trackCreatedCapitalContribution(ownedBody.id);

    const otherContribution = await post("/api/capital-contribution", ownerToken, {
      vehicleId: otherVehicle,
      userId: owner.userId,
      amountMinor: "200000",
      contributedOn: "2026-07-02",
    });
    const otherBody: { id: string } = await otherContribution.json();
    ctx.trackCreatedCapitalContribution(otherBody.id);

    const businessWideContribution = await post("/api/capital-contribution", ownerToken, {
      userId: owner.userId,
      amountMinor: "300000",
      contributedOn: "2026-07-03",
    });
    const businessWideBody: { id: string } = await businessWideContribution.json();
    ctx.trackCreatedCapitalContribution(businessWideBody.id);

    const res = await get("/api/capital-contribution", ownerManagerToken);
    expect(res.status).toBe(200);
    const body: Array<{ id: string; vehicleId: string | null }> = await res.json();
    expect(body.map((c) => c.id).sort()).toEqual([businessWideBody.id, ownedBody.id].sort());
    expect(body.map((c) => c.id)).not.toContain(otherBody.id);

    await ctx.cleanup();
  });

  it("403 — GAP-1/W-59/D-17: an owner-manager explicitly names a vehicle he has no share in", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const otherVehicle = await ctx.createVehicle(businessId, { registration: "OTHER-4" });
    const ownerManager = await mintUser(db, ctx, businessId, "owner_manager");
    const token = await signAccessToken(ownerManager.asgardeoSub);

    const res = await get(`/api/capital-contribution?vehicleId=${otherVehicle}`, token);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

    await ctx.cleanup();
  });
});

/** A2/GAP-9 test matrix. */
describe("list management fee agreements (A2, F-1.4/UC-03)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — a revoked agreement is returned, not filtered out", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const manager = await mintUser(db, ctx, businessId, "manager");
    const token = await signAccessToken(owner.asgardeoSub);

    const granted = await post("/api/management-fee-agreement", token, {
      vehicleId,
      managerUserId: manager.userId,
      effectiveFrom: "2026-01-01",
    });
    const grantedBody: { id: string } = await granted.json();
    ctx.trackCreatedManagementFeeAgreement(grantedBody.id);

    const revoked = await post(`/api/management-fee-agreement/${grantedBody.id}/revoke`, token, {});
    expect(revoked.status).toBe(200);

    const res = await get("/api/management-fee-agreement", token);
    expect(res.status).toBe(200);
    const body: Array<{ id: string; effectiveTo: string | null }> = await res.json();
    expect(body.map((a) => a.id)).toContain(grantedBody.id);
    const revokedRow = body.find((a) => a.id === grantedBody.id);
    expect(revokedRow?.effectiveTo).not.toBeNull();

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request("/api/management-fee-agreement");
    expect(res.status).toBe(401);
  });

  it("403 — a manager (not an owner) cannot read management agreements", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const manager = await mintUser(db, ctx, businessId, "manager");
    const token = await signAccessToken(manager.asgardeoSub);

    const res = await get("/api/management-fee-agreement", token);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

    await ctx.cleanup();
  });
});

/** A2/GAP-9 test matrix. */
describe("list banking events (A2, F-7.4/UC-65)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — newest-banked-first, a manager (not owners-only) can read it", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const manager = await mintUser(db, ctx, businessId, "manager");
    const ownerToken = await signAccessToken(owner.asgardeoSub);
    const managerToken = await signAccessToken(manager.asgardeoSub);

    const earlier = await post("/api/banking-event", ownerToken, {
      amountRecordedMinor: "1000000",
      amountCountedMinor: "1000000",
      bankedOn: "2026-07-10",
      destination: "BOC current account",
    });
    const earlierBody: { id: string } = await earlier.json();
    ctx.trackCreatedBankingEvent(earlierBody.id);
    const later = await post("/api/banking-event", ownerToken, {
      amountRecordedMinor: "2000000",
      amountCountedMinor: "2000000",
      bankedOn: "2026-07-20",
      destination: "BOC current account",
    });
    const laterBody: { id: string } = await later.json();
    ctx.trackCreatedBankingEvent(laterBody.id);

    const res = await get("/api/banking-event", managerToken);
    expect(res.status).toBe(200);
    const body: Array<{ bankedOn: string }> = await res.json();
    expect(body.map((e) => e.bankedOn)).toEqual(["2026-07-20", "2026-07-10"]);

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request("/api/banking-event");
    expect(res.status).toBe(401);
  });

  it("403 — a linked driver cannot read banking events", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await get("/api/banking-event", token);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

    await ctx.cleanup();
  });
});

/** A2/GAP-9 test matrix. */
describe("list partner payouts (A2, F-7.2/UC-63)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — newest-occurred-first, filtered by kind", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const payout = await post("/api/partner-payout", token, {
      userId: owner.userId,
      amountMinor: "500000",
      kind: "payout",
      occurredOn: "2026-07-10",
    });
    const payoutBody: { id: string } = await payout.json();
    ctx.trackCreatedPartnerPayout(payoutBody.id);
    const settlement = await post("/api/partner-payout", token, {
      userId: owner.userId,
      amountMinor: "300000",
      kind: "partner_settlement",
      occurredOn: "2026-07-20",
    });
    const settlementBody: { id: string } = await settlement.json();
    ctx.trackCreatedPartnerPayout(settlementBody.id);

    const res = await get("/api/partner-payout?kind=payout", token);
    expect(res.status).toBe(200);
    const body: Array<{ kind: string }> = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ kind: "payout" });

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request("/api/partner-payout");
    expect(res.status).toBe(401);
  });

  it("403 — a manager (not an owner) cannot read partner payouts", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const manager = await mintUser(db, ctx, businessId, "manager");
    const token = await signAccessToken(manager.asgardeoSub);

    const res = await get("/api/partner-payout", token);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

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

  it("400 — GAP-121: managerUserId names a passive owner (UC-03: reports only, no data entry)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const passiveOwner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await post("/api/management-fee-agreement", token, {
      vehicleId,
      managerUserId: passiveOwner.userId,
      effectiveFrom: "2026-01-01",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "VALIDATION_ERROR" });

    await ctx.cleanup();
  });

  it("happy path — GAP-121, UC-64: an owner-manager can hold a management fee agreement on a vehicle he doesn't own", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const ownerManager = await mintUser(db, ctx, businessId, "owner_manager");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await post("/api/management-fee-agreement", token, {
      vehicleId,
      managerUserId: ownerManager.userId,
      monthlyFeeMinor: "1000000",
      effectiveFrom: "2026-01-01",
    });
    expect(res.status).toBe(201);
    const body: { id: string } = await res.json();
    ctx.trackCreatedManagementFeeAgreement(body.id);

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

  it("400 — GAP-121: the user is a manager, not a partner", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const manager = await mintUser(db, ctx, businessId, "manager");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await post("/api/partner-payout", token, {
      userId: manager.userId,
      amountMinor: "100000",
      kind: "payout",
      occurredOn: "2026-07-25",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "VALIDATION_ERROR" });

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
