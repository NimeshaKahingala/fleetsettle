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

async function getLease(token: string, id: string) {
  return request(`/api/lease/${id}`, bearer(token));
}

/**
 * F-2.1 / UC-10 test matrix. Only the `lease` row is written in P2 —
 * DM §4.1 attributes arrangement A's vehicle_day_allocation calendar to a
 * rolling-horizon cron (P13), so there is no INV-1 case here yet (see
 * route-defs/lease.ts).
 */
describe("start a lease (P2, F-2.1/UC-10)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — a 12th-of-the-month lease keeps its start date exactly", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const customerId = await ctx.createCustomer(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postLease(token, {
      vehicleId,
      customerId,
      startDate: "2026-01-12",
      billingDay: 12,
      rentAmountMinor: "5000000",
      mileageDailyLimitKm: 100,
      mileageExcessRateMinor: "5000",
      reminderDaysBefore: 3,
    });
    expect(res.status).toBe(201);
    const body: { id: string } = await res.json();
    expect(body).toMatchObject({
      vehicleId,
      customerId,
      status: "active",
      startDate: "2026-01-12",
      endDate: null,
      billingDay: 12,
      rentAmountMinor: "5000000",
      mileageDailyLimitKm: 100,
      mileageExcessRateMinor: "5000",
    });
    ctx.trackCreatedLease(body.id);

    const getRes = await getLease(token, body.id);
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toMatchObject({ id: body.id, startDate: "2026-01-12" });

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request("/api/lease", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "MISSING_TOKEN" });
  });

  it("403 — a linked driver cannot start a lease", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const customerId = await ctx.createCustomer(businessId);
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await postLease(token, {
      vehicleId,
      customerId,
      startDate: "2026-01-01",
      billingDay: 1,
      rentAmountMinor: "5000000",
    });
    expect(res.status).toBe(403);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

    await ctx.cleanup();
  });

  it("404 — the vehicle belongs to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherVehicleId = await ctx.createVehicle(otherBusinessId);
    const customerId = await ctx.createCustomer(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postLease(token, {
      vehicleId: otherVehicleId,
      customerId,
      startDate: "2026-01-01",
      billingDay: 1,
      rentAmountMinor: "5000000",
    });
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("404 — the customer belongs to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const vehicleId = await ctx.createVehicle(businessId);
    const otherCustomerId = await ctx.createCustomer(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postLease(token, {
      vehicleId,
      customerId: otherCustomerId,
      startDate: "2026-01-01",
      billingDay: 1,
      rentAmountMinor: "5000000",
    });
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });
});
