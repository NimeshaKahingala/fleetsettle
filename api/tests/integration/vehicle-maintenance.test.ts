import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { mintLinkedDriver, mintUser, signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

async function postExpense(token: string, body: unknown) {
  return request("/api/expense", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

async function patchServiceInterval(token: string, id: string, body: unknown) {
  return request(`/api/vehicle/${id}/service-interval`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

async function getVehicle(token: string, id: string) {
  return request(`/api/vehicle/${id}`, bearer(token));
}

interface VehicleBody {
  id: string;
  serviceIntervalKm: number | null;
  maintenance?: { kmSinceLastServiceKm: number | null; due: boolean } | null;
}

/**
 * F-3.5/UC-13/GAP-68 test matrix. The interval is a plain optional setting
 * (U-2: never required to save the vehicle); the prompt itself is read
 * live on the vehicle's own detail fetch, never on the list.
 */
describe("PATCH /api/vehicle/{id}/service-interval (F-3.5/UC-13, GAP-68)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — sets the interval, and GET reflects it", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await patchServiceInterval(token, vehicleId, { serviceIntervalKm: 5000 });
    expect(res.status).toBe(200);
    const body: VehicleBody = await res.json();
    expect(body).toMatchObject({ id: vehicleId, serviceIntervalKm: 5000 });

    const getRes = await getVehicle(token, vehicleId);
    const getBody: VehicleBody = await getRes.json();
    expect(getBody.serviceIntervalKm).toBe(5000);

    await ctx.cleanup();
  });

  it("happy path — null clears a previously-set interval, and the prompt turns back off", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    await patchServiceInterval(token, vehicleId, { serviceIntervalKm: 5000 });
    const res = await patchServiceInterval(token, vehicleId, { serviceIntervalKm: null });
    expect(res.status).toBe(200);
    const body: VehicleBody = await res.json();
    expect(body.serviceIntervalKm).toBeNull();

    const getRes = await getVehicle(token, vehicleId);
    const getBody: VehicleBody = await getRes.json();
    expect(getBody.serviceIntervalKm).toBeNull();
    expect(getBody.maintenance).toBeNull();

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request(`/api/vehicle/${crypto.randomUUID()}/service-interval`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serviceIntervalKm: 5000 }),
    });
    expect(res.status).toBe(401);
  });

  it("403 — a linked driver cannot change a vehicle's service interval", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const driverId = await ctx.createDriver(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await patchServiceInterval(token, vehicleId, { serviceIntervalKm: 5000 });
    expect(res.status).toBe(403);

    await ctx.cleanup();
  });

  it("404 — a vehicle belonging to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherVehicleId = await ctx.createVehicle(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await patchServiceInterval(token, otherVehicleId, { serviceIntervalKm: 5000 });
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });
});

/**
 * F-3.5/UC-13/GAP-68's own predictive half — "the vehicle's page shows a
 * prompt once the latest odometer reading on file exceeds the last
 * maintenance reading by that interval." W-56: never a guessed figure.
 */
describe("GET /api/vehicle/{id} — the maintenance prompt (F-3.5/UC-13, GAP-68)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("no interval set — maintenance is null, never computed", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const servicing = await postExpense(token, {
      vehicleId,
      category: "servicing",
      amountMinor: "1000000",
      spentOn: "2026-07-01",
      odometerReadingKm: 10000,
      odometerSource: "reported",
    });
    const servicingBody: { id: string; odometerReadingId: string } = await servicing.json();
    ctx.trackCreatedExpense(servicingBody.id, servicingBody.odometerReadingId);
    const laterReading = await ctx.createOdometerReading(
      businessId,
      vehicleId,
      20000,
      "2026-08-01",
    );
    void laterReading;

    const res = await getVehicle(token, vehicleId);
    expect(res.status).toBe(200);
    const body: VehicleBody = await res.json();
    expect(body.serviceIntervalKm).toBeNull();
    expect(body.maintenance).toBeNull();

    await ctx.cleanup();
  });

  it("interval set but nothing ever recorded — not available, never a guessed 0 (W-56)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    await patchServiceInterval(token, vehicleId, { serviceIntervalKm: 5000 });

    const res = await getVehicle(token, vehicleId);
    expect(res.status).toBe(200);
    const body: VehicleBody = await res.json();
    expect(body.maintenance).toEqual({ kmSinceLastServiceKm: null, due: false });

    await ctx.cleanup();
  });

  it("under the interval — not due, with the real km-since figure", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    await patchServiceInterval(token, vehicleId, { serviceIntervalKm: 5000 });

    const servicing = await postExpense(token, {
      vehicleId,
      category: "servicing",
      amountMinor: "1000000",
      spentOn: "2026-07-01",
      odometerReadingKm: 10000,
      odometerSource: "reported",
    });
    const servicingBody: { id: string; odometerReadingId: string } = await servicing.json();
    ctx.trackCreatedExpense(servicingBody.id, servicingBody.odometerReadingId);
    const latestId = await ctx.createOdometerReading(businessId, vehicleId, 13000, "2026-08-01");
    void latestId;

    const res = await getVehicle(token, vehicleId);
    const body: VehicleBody = await res.json();
    expect(body.maintenance).toEqual({ kmSinceLastServiceKm: 3000, due: false });

    await ctx.cleanup();
  });

  it("past the interval — due, and clearing the interval turns it back off", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    await patchServiceInterval(token, vehicleId, { serviceIntervalKm: 5000 });

    const servicing = await postExpense(token, {
      vehicleId,
      category: "servicing",
      amountMinor: "1000000",
      spentOn: "2026-07-01",
      odometerReadingKm: 10000,
      odometerSource: "reported",
    });
    const servicingBody: { id: string; odometerReadingId: string } = await servicing.json();
    ctx.trackCreatedExpense(servicingBody.id, servicingBody.odometerReadingId);
    const latestId = await ctx.createOdometerReading(businessId, vehicleId, 16000, "2026-08-01");
    void latestId;

    const res = await getVehicle(token, vehicleId);
    const body: VehicleBody = await res.json();
    expect(body.maintenance).toEqual({ kmSinceLastServiceKm: 6000, due: true });

    // Recording a new maintenance expense with a reading clears the prompt (F-3.5's own Accept clause).
    const secondServicing = await postExpense(token, {
      vehicleId,
      category: "servicing",
      amountMinor: "1000000",
      spentOn: "2026-08-05",
      odometerReadingKm: 16500,
      odometerSource: "reported",
    });
    const secondServicingBody: { id: string; odometerReadingId: string } =
      await secondServicing.json();
    ctx.trackCreatedExpense(secondServicingBody.id, secondServicingBody.odometerReadingId);

    const afterRes = await getVehicle(token, vehicleId);
    const afterBody: VehicleBody = await afterRes.json();
    expect(afterBody.maintenance).toEqual({ kmSinceLastServiceKm: 0, due: false });

    await ctx.cleanup();
  });

  it("404 — a vehicle belonging to another business", async () => {
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
});
