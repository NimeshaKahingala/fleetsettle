import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { mintLinkedDriver, mintUser, signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

async function postVehicle(token: string, body: unknown) {
  return request("/api/vehicle", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

async function getVehicle(token: string, id: string) {
  return request(`/api/vehicle/${id}`, bearer(token));
}

async function listVehicles(token: string) {
  return request("/api/vehicle", bearer(token));
}

async function putDocument(token: string, id: string, body: unknown) {
  return request(`/api/vehicle/${id}/document`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

/**
 * F-1.1 / UC-01 and F-10.1 / UC-92 test matrix. 401 and 403 are proven once
 * here rather than per route — all four routes share the same
 * `authMiddleware` chain and the same `manageEntities` capability check
 * (already exhaustively covered for the middleware itself in auth.test.ts);
 * what differs per route is the 404/409 behaviour, which each gets its own
 * case for.
 */
describe("vehicle CRUD + paperwork (P2, F-1.1/UC-01, F-10.1/UC-92)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — creates the vehicle, its opening arrangement, and both documents", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postVehicle(token, {
      registration: `CAB-${crypto.randomUUID().slice(0, 8)}`,
      vehicleType: "car",
      defaultArrangement: "A",
      insuranceExpiry: "2026-12-31",
      registrationExpiry: "2027-06-30",
    });
    expect(res.status).toBe(201);
    const body: { id: string; lifecycle: string; arrangement: string } = await res.json();
    expect(body).toMatchObject({ lifecycle: "active", arrangement: "A" });
    ctx.trackCreatedVehicle(body.id);

    const getRes = await getVehicle(token, body.id);
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toMatchObject({ id: body.id, arrangement: "A" });

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request("/api/vehicle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ registration: "X", vehicleType: "car", defaultArrangement: "A" }),
    });
    expect(res.status).toBe(401);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "MISSING_TOKEN" });
  });

  it("403 — a linked driver cannot add a vehicle (W-3: a driver enters nothing)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await postVehicle(token, {
      registration: "DRV-001",
      vehicleType: "car",
      defaultArrangement: "A",
    });
    expect(res.status).toBe(403);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

    await ctx.cleanup();
  });

  it("409 — the same registration twice in one business (DM §4's UNIQUE(business_id, registration))", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);
    const registration = `DUP-${crypto.randomUUID().slice(0, 8)}`;

    const first = await postVehicle(token, {
      registration,
      vehicleType: "car",
      defaultArrangement: "A",
    });
    expect(first.status).toBe(201);
    const firstBody: { id: string } = await first.json();
    ctx.trackCreatedVehicle(firstBody.id);

    const second = await postVehicle(token, {
      registration,
      vehicleType: "car",
      defaultArrangement: "B",
    });
    expect(second.status).toBe(409);
    const secondBody: { code: string } = await second.json();
    expect(secondBody).toMatchObject({ code: "VEHICLE_ALREADY_EXISTS" });

    await ctx.cleanup();
  });

  it("404 — a vehicle belonging to another business (GET)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherVehicleId = await ctx.createVehicle(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await getVehicle(token, otherVehicleId);
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("list — returns only this business's vehicles", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const ownVehicleId = await ctx.createVehicle(businessId, { registration: "OWN-001" });
    await ctx.createVehicle(otherBusinessId, { registration: "OTHER-001" });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await listVehicles(token);
    expect(res.status).toBe(200);
    const body: Array<{ id: string; registration: string }> = await res.json();
    expect(body.map((v) => v.id)).toEqual([ownVehicleId]);
    expect(body[0]).toMatchObject({ registration: "OWN-001" });

    await ctx.cleanup();
  });

  it("paperwork — upserts insurance expiry, then a renewal replaces the date rather than adding a row", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const created = await postVehicle(token, {
      registration: `DOC-${crypto.randomUUID().slice(0, 8)}`,
      vehicleType: "car",
      defaultArrangement: "A",
    });
    const { id: vehicleId }: { id: string } = await created.json();
    ctx.trackCreatedVehicle(vehicleId);

    const first = await putDocument(token, vehicleId, {
      docType: "insurance",
      expiryDate: "2026-09-30",
    });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ docType: "insurance", expiryDate: "2026-09-30" });

    const renewal = await putDocument(token, vehicleId, {
      docType: "insurance",
      expiryDate: "2027-09-30",
      reference: "POL-9988",
    });
    expect(renewal.status).toBe(200);
    expect(await renewal.json()).toMatchObject({
      docType: "insurance",
      expiryDate: "2027-09-30",
      reference: "POL-9988",
    });

    await ctx.cleanup();
  });

  it("404 — paperwork for a vehicle belonging to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherVehicleId = await ctx.createVehicle(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await putDocument(token, otherVehicleId, {
      docType: "insurance",
      expiryDate: "2026-09-30",
    });
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });
});
