import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { vehicleDayAllocation } from "../../src/db/schema.js";
import { mintLinkedDriver, mintUser, signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

async function postTrip(token: string, body: unknown) {
  return request("/api/trip", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

async function getTrip(token: string, id: string) {
  return request(`/api/trip/${id}`, bearer(token));
}

/**
 * F-5.1 / UC-20 test matrix. Unlike lease/daily-lease, a trip's
 * vehicle_day_allocation is always written in full at booking (DM §4.1), so
 * INV-1 is enforced here immediately — the 409 case below is the same
 * invariant UC-20 states in prose: "the car cannot also be on a monthly
 * rental for those dates, and it says so before you can create the
 * conflict."
 */
describe("book a trip (P2, F-5.1/UC-20)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — writes the trip and one allocation row per day in the range", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const customerId = await ctx.createCustomer(businessId);
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postTrip(token, {
      vehicleId,
      customerId,
      driverId,
      startDate: "2026-03-01",
      endDate: "2026-03-03",
      destination: "Kandy",
      agreedAmountMinor: "3000000",
      driverFeeMinor: "500000",
    });
    expect(res.status).toBe(201);
    const body: { id: string } = await res.json();
    expect(body).toMatchObject({
      vehicleId,
      customerId,
      driverId,
      status: "booked",
      startDate: "2026-03-01",
      endDate: "2026-03-03",
      destination: "Kandy",
      agreedAmountMinor: "3000000",
      driverFeeMinor: "500000",
    });
    ctx.trackCreatedTrip(body.id);

    const allocationRows = await db
      .select()
      .from(vehicleDayAllocation)
      .where(
        and(
          eq(vehicleDayAllocation.sourceType, "trip"),
          eq(vehicleDayAllocation.sourceId, body.id),
        ),
      );
    expect(allocationRows).toHaveLength(3); // 1, 2, 3 March — inclusive both ends (W-54)
    expect(allocationRows.map((r) => r.businessDate).sort()).toEqual([
      "2026-03-01",
      "2026-03-02",
      "2026-03-03",
    ]);
    expect(allocationRows.every((r) => r.arrangement === "C" && !r.isHold)).toBe(true);

    const getRes = await getTrip(token, body.id);
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toMatchObject({ id: body.id, destination: "Kandy" });

    await ctx.cleanup();
  });

  it("defaults agreedAmountMinor and driverFeeMinor to zero when omitted", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postTrip(token, {
      vehicleId,
      startDate: "2026-04-01",
      endDate: "2026-04-01",
    });
    expect(res.status).toBe(201);
    const body: { id: string; agreedAmountMinor: string; driverFeeMinor: string } =
      await res.json();
    expect(body).toMatchObject({ agreedAmountMinor: "0", driverFeeMinor: "0" });
    ctx.trackCreatedTrip(body.id);

    await ctx.cleanup();
  });

  it("400 — endDate before startDate", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postTrip(token, {
      vehicleId,
      startDate: "2026-03-03",
      endDate: "2026-03-01",
    });
    expect(res.status).toBe(400);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "VALIDATION_ERROR" });

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request("/api/trip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "MISSING_TOKEN" });
  });

  it("403 — a linked driver cannot book a trip", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await postTrip(token, {
      vehicleId,
      startDate: "2026-03-01",
      endDate: "2026-03-01",
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
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postTrip(token, {
      vehicleId: otherVehicleId,
      startDate: "2026-03-01",
      endDate: "2026-03-01",
    });
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("409 — INV-1: a second trip overlapping the first, on the same vehicle", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const first = await postTrip(token, {
      vehicleId,
      startDate: "2026-05-10",
      endDate: "2026-05-12",
    });
    expect(first.status).toBe(201);
    const firstBody: { id: string } = await first.json();
    ctx.trackCreatedTrip(firstBody.id);

    const second = await postTrip(token, {
      vehicleId,
      startDate: "2026-05-12",
      endDate: "2026-05-14",
    });
    expect(second.status).toBe(409);
    const secondBody: { code: string } = await second.json();
    expect(secondBody).toMatchObject({ code: "VEHICLE_DOUBLE_BOOKED" });

    // The conflicting attempt must not have left a partial trip or allocation
    // row behind — the whole booking is one transaction.
    const leftoverAllocations = await db
      .select()
      .from(vehicleDayAllocation)
      .where(
        and(
          eq(vehicleDayAllocation.vehicleId, vehicleId),
          eq(vehicleDayAllocation.businessDate, "2026-05-14"),
        ),
      );
    expect(leftoverAllocations).toHaveLength(0);

    await ctx.cleanup();
  });
});
