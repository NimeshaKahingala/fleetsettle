import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { mintLinkedDriver, mintUser, signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

function postArchiveVehicle(token: string, id: string) {
  return request(`/api/vehicle/${id}/archive`, { method: "POST", ...bearer(token) });
}

function postJson(path: string, token: string, body: unknown) {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

function postUnarchiveVehicle(token: string, id: string) {
  return request(`/api/vehicle/${id}/unarchive`, { method: "POST", ...bearer(token) });
}

function getVehicle(token: string, id: string) {
  return request(`/api/vehicle/${id}`, bearer(token));
}

interface VehicleResponseBody {
  id: string;
  lifecycle: "active" | "archived" | "disposed";
}

/** GAP-36/A9b item 2: the `lifecycle` column DM §4 has carried since `0001`, unmoved off `'active'` until now. Unconditional — `mileage_package`'s own archive is the reference pattern, and no booking flow reads `lifecycle` yet, so archiving a vehicle mid-lease does not need to be refused. */
describe("POST /api/vehicle/{id}/archive and /unarchive (GAP-36)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — archives, comes back with lifecycle 'archived', still resolvable by id", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner_manager");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postArchiveVehicle(token, vehicleId);
    expect(res.status).toBe(200);
    const body: VehicleResponseBody = await res.json();
    expect(body).toMatchObject({ id: vehicleId, lifecycle: "archived" });

    const getRes = await getVehicle(token, vehicleId);
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toMatchObject({ id: vehicleId, lifecycle: "archived" });

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request(`/api/vehicle/${crypto.randomUUID()}/archive`, { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("403 — a linked driver cannot archive a vehicle (W-3: a driver enters nothing)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const driverId = await ctx.createDriver(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await postArchiveVehicle(token, vehicleId);
    expect(res.status).toBe(403);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

    await ctx.cleanup();
  });

  it("404 — a vehicle belonging to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherVehicleId = await ctx.createVehicle(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner_manager");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postArchiveVehicle(token, otherVehicleId);
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("unarchive — happy path returns lifecycle to 'active'", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner_manager");
    const token = await signAccessToken(owner.asgardeoSub);

    await postArchiveVehicle(token, vehicleId);

    const res = await postUnarchiveVehicle(token, vehicleId);
    expect(res.status).toBe(200);
    const body: VehicleResponseBody = await res.json();
    expect(body.lifecycle).toBe("active");

    await ctx.cleanup();
  });

  it("unarchive — 404 a vehicle belonging to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherVehicleId = await ctx.createVehicle(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner_manager");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postUnarchiveVehicle(token, otherVehicleId);
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("N5 (evaluation, GAP-190): 409 while an open loan finances this vehicle; 200 once it's closed", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const loanRes = await postJson("/api/vehicle-loan", token, {
      vehicleId,
      lender: "Peoples Leasing",
      principalMinor: "1000000",
      totalRepayableMinor: "1500000",
      termMonths: 50,
      startedOn: "2026-07-05",
    });
    expect(loanRes.status).toBe(201);
    const loan: { id: string } = await loanRes.json();
    ctx.trackCreatedVehicleLoan(loan.id);

    const blockedRes = await postArchiveVehicle(token, vehicleId);
    expect(blockedRes.status).toBe(409);
    const blockedBody: { code: string } = await blockedRes.json();
    expect(blockedBody).toMatchObject({ code: "VEHICLE_HAS_OPEN_LOAN" });

    const closeRes = await postJson(`/api/vehicle-loan/${loan.id}/settle`, token, {
      settlementAmountMinor: "1500000",
      settledOn: "2026-07-06",
    });
    expect(closeRes.status).toBe(201);

    const openRes = await postArchiveVehicle(token, vehicleId);
    expect(openRes.status).toBe(200);

    await ctx.cleanup();
  });

  it("archiving a vehicle mid-lease is not refused — an active arrangement survives untouched", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const customerId = await ctx.createCustomer(businessId);
    await ctx.createLease(businessId, vehicleId, customerId, { status: "active" });
    const owner = await mintUser(db, ctx, businessId, "owner_manager");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postArchiveVehicle(token, vehicleId);
    expect(res.status).toBe(200);

    await ctx.cleanup();
  });
});
