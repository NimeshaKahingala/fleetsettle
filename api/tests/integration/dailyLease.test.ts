import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { mintLinkedDriver, mintUser, signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

async function postDailyLease(token: string, body: unknown) {
  return request("/api/daily-lease", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

async function getDailyLease(token: string, id: string) {
  return request(`/api/daily-lease/${id}`, bearer(token));
}

/**
 * F-1.7 / UC-05 test matrix. Only `daily_lease` + its first `daily_lease_rate`
 * are written in P2 — DM §4.1 attributes the vehicle_day_allocation/day_record
 * calendar entirely to `generate-day-cards` (P13), so there is no INV-1 case
 * here; the 409 this endpoint DOES have is DM §7's exclusion constraint
 * (an overlapping daily lease on the same vehicle).
 */
describe("set up the daily lease (P2, F-1.7/UC-05)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — every_day pattern", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postDailyLease(token, {
      vehicleId,
      driverId,
      patternType: "every_day",
      effectiveFrom: "2026-01-01",
      dailyLeaseAmountMinor: "500000",
    });
    expect(res.status).toBe(201);
    const body: { id: string } = await res.json();
    expect(body).toMatchObject({
      vehicleId,
      driverId,
      patternType: "every_day",
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      dailyLeaseAmountMinor: "500000",
    });
    ctx.trackCreatedDailyLease(body.id);

    const getRes = await getDailyLease(token, body.id);
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toMatchObject({ id: body.id, dailyLeaseAmountMinor: "500000" });

    await ctx.cleanup();
  });

  it("happy path — weekdays pattern with explicit days", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postDailyLease(token, {
      vehicleId,
      driverId,
      patternType: "weekdays",
      patternWeekdays: [1, 3, 5],
      effectiveFrom: "2026-01-01",
      dailyLeaseAmountMinor: "500000",
    });
    expect(res.status).toBe(201);
    const body: { id: string; patternWeekdays: number[] } = await res.json();
    expect(body.patternWeekdays).toEqual([1, 3, 5]);
    ctx.trackCreatedDailyLease(body.id);

    await ctx.cleanup();
  });

  it("400 — weekdays pattern with no weekdays given (schema-level superRefine)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postDailyLease(token, {
      vehicleId,
      driverId,
      patternType: "weekdays",
      effectiveFrom: "2026-01-01",
      dailyLeaseAmountMinor: "500000",
    });
    expect(res.status).toBe(400);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "VALIDATION_ERROR" });

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request("/api/daily-lease", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "MISSING_TOKEN" });
  });

  it("403 — a linked driver cannot set up a daily lease", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await postDailyLease(token, {
      vehicleId,
      driverId,
      patternType: "every_day",
      effectiveFrom: "2026-01-01",
      dailyLeaseAmountMinor: "500000",
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
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postDailyLease(token, {
      vehicleId: otherVehicleId,
      driverId,
      patternType: "every_day",
      effectiveFrom: "2026-01-01",
      dailyLeaseAmountMinor: "500000",
    });
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("409 — a second daily lease overlapping the first, on the same vehicle (DM §7's exclusion constraint)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const first = await postDailyLease(token, {
      vehicleId,
      driverId,
      patternType: "every_day",
      effectiveFrom: "2026-01-01",
      dailyLeaseAmountMinor: "500000",
    });
    expect(first.status).toBe(201);
    const firstBody: { id: string } = await first.json();
    ctx.trackCreatedDailyLease(firstBody.id);

    const second = await postDailyLease(token, {
      vehicleId,
      driverId,
      patternType: "every_day",
      effectiveFrom: "2026-06-01",
      dailyLeaseAmountMinor: "600000",
    });
    expect(second.status).toBe(409);
    const secondBody: { code: string } = await second.json();
    expect(secondBody).toMatchObject({ code: "DAILY_LEASE_OVERLAPS" });

    await ctx.cleanup();
  });
});
