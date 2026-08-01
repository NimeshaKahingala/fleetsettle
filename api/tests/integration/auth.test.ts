import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { mintUser, mintLinkedDriver, signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

/**
 * TRACKER.md P1 "Done means": happy path · 401 missing header · 401 verifier
 * throws · 403 capability · 404 for another business, plus the linked-driver
 * class (W-49's hard boundary) — a driver token gets 404 for another
 * driver's row, same as a foreign business would.
 */
describe("auth boundary (P1)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.end();
  });

  it("happy path — a verified owner resolves to their business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await request("/api/me", bearer(token));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: owner.userId, businessId, role: "owner" });

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request("/api/me");
    expect(res.status).toBe(401);
    const body: { code: string } = await res.json();
    expect(body).toMatchObject({ code: "MISSING_TOKEN" });
  });

  it("401 — the verifier rejects a token it did not sign", async () => {
    const res = await request("/api/me", bearer("not-a-real-jwt"));
    expect(res.status).toBe(401);
    const body: { code: string } = await res.json();
    expect(body).toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("401 — a correctly-signed token with the wrong audience", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub, { audience: "someone-elses-app" });

    const res = await request("/api/me", bearer(token));
    expect(res.status).toBe(401);

    await ctx.cleanup();
  });

  it("404 — a verified identity with no business_member and no linked driver row", async () => {
    const token = await signAccessToken("test-sub-nobody-knows-this-user");
    const res = await request("/api/me", bearer(token));
    expect(res.status).toBe(404);
  });

  it("403 — a manager lacks closePeriod, 200 — an owner and an owner_manager have it", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const manager = await mintUser(db, ctx, businessId, "manager");
    const owner = await mintUser(db, ctx, businessId, "owner");
    const ownerManager = await mintUser(db, ctx, businessId, "owner_manager");

    const managerRes = await request("/api/_probe/close-period", {
      method: "POST",
      ...bearer(await signAccessToken(manager.asgardeoSub)),
    });
    expect(managerRes.status).toBe(403);
    const managerBody: { code: string } = await managerRes.json();
    expect(managerBody).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

    const ownerRes = await request("/api/_probe/close-period", {
      method: "POST",
      ...bearer(await signAccessToken(owner.asgardeoSub)),
    });
    expect(ownerRes.status).toBe(200);

    const ownerManagerRes = await request("/api/_probe/close-period", {
      method: "POST",
      ...bearer(await signAccessToken(ownerManager.asgardeoSub)),
    });
    expect(ownerManagerRes.status).toBe(200);

    await ctx.cleanup();
  });

  it("404 — a vehicle belonging to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const ownVehicle = await ctx.createVehicle(businessId);
    const otherVehicle = await ctx.createVehicle(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const ownRes = await request(`/api/_probe/vehicle/${ownVehicle}`, bearer(token));
    expect(ownRes.status).toBe(200);

    const otherRes = await request(`/api/_probe/vehicle/${otherVehicle}`, bearer(token));
    expect(otherRes.status).toBe(404);

    await ctx.cleanup();
  });

  it("404 — a linked driver reading another driver's row (W-49's hard boundary)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const ownDriverId = await ctx.createDriver(businessId, { name: "Own Driver" });
    const otherDriverId = await ctx.createDriver(businessId, { name: "Other Driver" });
    const linked = await mintLinkedDriver(db, ctx, ownDriverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const ownRes = await request(`/api/_probe/driver/${ownDriverId}`, bearer(token));
    expect(ownRes.status).toBe(200);

    const otherRes = await request(`/api/_probe/driver/${otherDriverId}`, bearer(token));
    expect(otherRes.status).toBe(404);

    await ctx.cleanup();
  });

  it("a linked driver has no closePeriod capability either", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await request("/api/_probe/close-period", { method: "POST", ...bearer(token) });
    expect(res.status).toBe(403);

    await ctx.cleanup();
  });
});
