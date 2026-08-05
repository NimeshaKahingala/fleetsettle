import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { mintLinkedDriver, mintUser, signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

async function postDriver(token: string, body: unknown) {
  return request("/api/driver", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

async function getDriver(token: string, id: string) {
  return request(`/api/driver/${id}`, bearer(token));
}

async function listDrivers(token: string) {
  return request("/api/driver", bearer(token));
}

/**
 * F-1.6 / UC-04 test matrix. 401 and 403 are proven once here rather than
 * per route — all three routes share the same `authMiddleware` chain and
 * the same `manageEntities` capability check (already exhaustively covered
 * for the middleware itself in auth.test.ts).
 */
describe("driver CRUD (P2, F-1.6/UC-04)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — only name is required; fee and licence fields round-trip as wire strings", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postDriver(token, {
      name: "Sunil Perera",
      mobile: "0771234567",
      driverDayFeeMinor: "150000",
      driverTripFeeMinor: "50000",
      licenceExpiry: "2027-03-15",
    });
    expect(res.status).toBe(201);
    const body: { id: string } = await res.json();
    expect(body).toMatchObject({
      name: "Sunil Perera",
      mobile: "0771234567",
      driverDayFeeMinor: "150000",
      driverTripFeeMinor: "50000",
      licenceExpiry: "2027-03-15",
    });
    ctx.trackCreatedDriver(body.id);

    const getRes = await getDriver(token, body.id);
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toMatchObject({ id: body.id, name: "Sunil Perera" });

    await ctx.cleanup();
  });

  it("happy path — only name given, everything else comes back null (U-2)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postDriver(token, { name: "Kamal Silva" });
    expect(res.status).toBe(201);
    const body: { id: string } = await res.json();
    expect(body).toMatchObject({
      name: "Kamal Silva",
      mobile: null,
      driverDayFeeMinor: null,
      driverTripFeeMinor: null,
      licenceExpiry: null,
    });
    ctx.trackCreatedDriver(body.id);

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request("/api/driver", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "No Token Driver" }),
    });
    expect(res.status).toBe(401);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "MISSING_TOKEN" });
  });

  it("403 — a linked driver cannot add a driver (W-3: a driver enters nothing)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await postDriver(token, { name: "Someone New" });
    expect(res.status).toBe(403);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

    await ctx.cleanup();
  });

  it("404 — a driver belonging to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherDriverId = await ctx.createDriver(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await getDriver(token, otherDriverId);
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("list — returns only this business's drivers", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const ownDriverId = await ctx.createDriver(businessId, { name: "Own Driver" });
    await ctx.createDriver(otherBusinessId, { name: "Other Driver" });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await listDrivers(token);
    expect(res.status).toBe(200);
    const body: Array<{ id: string; name: string }> = await res.json();
    expect(body.map((d) => d.id)).toEqual([ownDriverId]);
    expect(body[0]).toMatchObject({ name: "Own Driver" });

    await ctx.cleanup();
  });
});
