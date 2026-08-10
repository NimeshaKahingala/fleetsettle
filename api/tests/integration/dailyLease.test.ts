import { businessToday } from "@fleetsettle/shared";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { dayRecord, vehicleDayAllocation } from "../../src/db/schema.js";
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

async function listActiveDailyLeases(token: string) {
  return request("/api/daily-lease", bearer(token));
}

async function postChangeDriver(token: string, id: string, body: unknown) {
  return request(`/api/daily-lease/${id}/change-driver`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

/**
 * F-1.7 / UC-05 test matrix. `daily_lease` and its first `daily_lease_rate`
 * are written here, and — since D-9/GAP-88 — the same rolling horizon of
 * `vehicle_day_allocation`/`day_record` rows `generate-day-cards` writes
 * nightly, materialised synchronously in the same transaction so the
 * calendar, the trip-booking conflict check and the lost-days report never
 * have a ~24h window where the lease is invisible. The 409 this endpoint
 * has is DM §7's exclusion constraint (an overlapping daily lease on the
 * same vehicle) — INV-1 itself is exercised below, GAP-88's own regression.
 */
describe("set up the daily lease (P2, F-1.7/UC-05)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  // GAP-84/F1: `createVehicle()` alone leaves the vehicle with no current
  // arrangement row — this happy path is also the regression proof that a
  // vehicle nobody has set up yet is fair game for its first daily lease,
  // the same "B or none" pair `VehicleOverviewScreen`'s own client-side
  // gating already used before the Worker checked anything.
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

  it("D-9/GAP-88 — today's allocation and day_record exist immediately, with no generate-day-cards run", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const today = businessToday();
    await ctx.createOpenPeriod(businessId, { periodStart: today, periodEnd: today });
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postDailyLease(token, {
      vehicleId,
      driverId,
      patternType: "every_day",
      effectiveFrom: today,
      dailyLeaseAmountMinor: "500000",
    });
    expect(res.status).toBe(201);
    const body: { id: string } = await res.json();
    ctx.trackCreatedDailyLease(body.id);

    const allocation = await db
      .select({ arrangement: vehicleDayAllocation.arrangement })
      .from(vehicleDayAllocation)
      .where(
        and(
          eq(vehicleDayAllocation.vehicleId, vehicleId),
          eq(vehicleDayAllocation.businessDate, today),
        ),
      );
    expect(allocation).toEqual([{ arrangement: "B" }]);

    const record = await db
      .select({ state: dayRecord.state, expectedMinor: dayRecord.expectedMinor })
      .from(dayRecord)
      .where(and(eq(dayRecord.dailyLeaseId, body.id), eq(dayRecord.businessDate, today)));
    expect(record).toEqual([{ state: "open", expectedMinor: 500_000n }]);

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

  it("409 — the vehicle is configured for arrangement A, not a daily lease (GAP-84)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "A");
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
    expect(res.status).toBe(409);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "VEHICLE_ARRANGEMENT_MISMATCH" });

    await ctx.cleanup();
  });

  it("happy path — arrangement B is also accepted, not only no arrangement yet", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "B");
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
    ctx.trackCreatedDailyLease(body.id);

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

  describe("GET /api/daily-lease — active list (Home item 3, UI §3.2)", () => {
    it("returns every active lease with its vehicle/driver/rate already resolved, only for this business, and excludes one that has ended", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const vehicleId = await ctx.createVehicle(businessId, { registration: "CAB-1111" });
      const driverId = await ctx.createDriver(businessId, { name: "Sunil" });
      const activeId = await ctx.createDailyLease(businessId, vehicleId, driverId, {
        dailyLeaseAmountMinor: 5_000_00n,
      });

      const endedVehicleId = await ctx.createVehicle(businessId, { registration: "CAB-2222" });
      const endedDriverId = await ctx.createDriver(businessId, { name: "Kamal" });
      await ctx.createDailyLease(businessId, endedVehicleId, endedDriverId, {
        effectiveFrom: "2025-01-01",
        effectiveTo: "2025-12-31",
      });

      const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
      const otherVehicleId = await ctx.createVehicle(otherBusinessId);
      const otherDriverId = await ctx.createDriver(otherBusinessId);
      await ctx.createDailyLease(otherBusinessId, otherVehicleId, otherDriverId);

      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await listActiveDailyLeases(token);
      expect(res.status).toBe(200);
      const body: Array<{
        id: string;
        vehicleId: string;
        vehicleRegistration: string;
        vehicleType: string;
        driverId: string;
        driverName: string;
        dailyLeaseAmountMinor: string;
      }> = await res.json();
      expect(body.map((r) => r.id)).toEqual([activeId]);
      expect(body[0]).toMatchObject({
        vehicleId,
        vehicleRegistration: "CAB-1111",
        driverId,
        driverName: "Sunil",
        dailyLeaseAmountMinor: "500000",
      });

      await ctx.cleanup();
    });

    it("401 — missing Authorization header", async () => {
      const res = await request("/api/daily-lease");
      expect(res.status).toBe(401);
    });

    it("403 — a linked driver cannot read the active-lease list", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const driverId = await ctx.createDriver(businessId);
      const linked = await mintLinkedDriver(db, ctx, driverId);
      const token = await signAccessToken(linked.asgardeoSub);

      const res = await listActiveDailyLeases(token);
      expect(res.status).toBe(403);

      await ctx.cleanup();
    });
  });
});

/**
 * F-4.7/UC-36/GAP-62 test matrix. The row is never overwritten (CLAUDE.md →
 * Writes): a happy call closes the old row and returns a brand-new id.
 */
describe("change a daily lease's driver (F-4.7/UC-36, GAP-62)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — the old row closes the day before, a new one opens carrying the pattern and rate forward", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const oldDriverId = await ctx.createDriver(businessId, { name: "Sunil" });
    const newDriverId = await ctx.createDriver(businessId, { name: "Kamal" });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const started = await postDailyLease(token, {
      vehicleId,
      driverId: oldDriverId,
      patternType: "weekdays",
      patternWeekdays: [1, 3, 5],
      effectiveFrom: "2026-07-01",
      dailyLeaseAmountMinor: "500000",
    });
    expect(started.status).toBe(201);
    const startedBody: { id: string } = await started.json();
    ctx.trackCreatedDailyLease(startedBody.id);

    const res = await postChangeDriver(token, startedBody.id, {
      driverId: newDriverId,
      effectiveFrom: "2026-08-01",
    });
    expect(res.status).toBe(201);
    const body: {
      id: string;
      vehicleId: string;
      driverId: string;
      patternType: string;
      patternWeekdays: number[] | null;
      effectiveFrom: string;
      effectiveTo: string | null;
      dailyLeaseAmountMinor: string;
    } = await res.json();
    expect(body.id).not.toBe(startedBody.id);
    ctx.trackCreatedDailyLease(body.id);
    expect(body).toMatchObject({
      vehicleId,
      driverId: newDriverId,
      patternType: "weekdays",
      patternWeekdays: [1, 3, 5],
      effectiveFrom: "2026-08-01",
      effectiveTo: null,
      dailyLeaseAmountMinor: "500000",
    });

    const oldRes = await getDailyLease(token, startedBody.id);
    expect(oldRes.status).toBe(200);
    const oldBody: { driverId: string; effectiveTo: string | null } = await oldRes.json();
    expect(oldBody).toMatchObject({ driverId: oldDriverId, effectiveTo: "2026-07-31" });

    await ctx.cleanup();
  });

  it("400 — this daily lease has already ended", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const endedId = await ctx.createDailyLease(businessId, vehicleId, driverId, {
      effectiveFrom: "2025-01-01",
      effectiveTo: "2025-12-31",
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postChangeDriver(token, endedId, {
      driverId,
      effectiveFrom: "2026-01-01",
    });
    expect(res.status).toBe(400);
    const body: { code: string } = await res.json();
    expect(body).toMatchObject({ code: "VALIDATION_ERROR" });

    await ctx.cleanup();
  });

  it("400 — effectiveFrom is not after the current assignment's own start date", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const oldDriverId = await ctx.createDriver(businessId);
    const newDriverId = await ctx.createDriver(businessId);
    const currentId = await ctx.createDailyLease(businessId, vehicleId, oldDriverId, {
      effectiveFrom: "2026-07-01",
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postChangeDriver(token, currentId, {
      driverId: newDriverId,
      effectiveFrom: "2026-07-01",
    });
    expect(res.status).toBe(400);
    const body: { code: string } = await res.json();
    expect(body).toMatchObject({ code: "VALIDATION_ERROR" });

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request(`/api/daily-lease/${crypto.randomUUID()}/change-driver`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ driverId: crypto.randomUUID(), effectiveFrom: "2026-08-01" }),
    });
    expect(res.status).toBe(401);
  });

  it("403 — a linked driver cannot change a daily lease's driver", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const oldDriverId = await ctx.createDriver(businessId);
    const newDriverId = await ctx.createDriver(businessId);
    const currentId = await ctx.createDailyLease(businessId, vehicleId, oldDriverId, {
      effectiveFrom: "2026-07-01",
    });
    const linked = await mintLinkedDriver(db, ctx, oldDriverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await postChangeDriver(token, currentId, {
      driverId: newDriverId,
      effectiveFrom: "2026-08-01",
    });
    expect(res.status).toBe(403);

    await ctx.cleanup();
  });

  it("404 — the daily lease belongs to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherVehicleId = await ctx.createVehicle(otherBusinessId);
    const otherDriverId = await ctx.createDriver(otherBusinessId);
    const otherLeaseId = await ctx.createDailyLease(
      otherBusinessId,
      otherVehicleId,
      otherDriverId,
      {
        effectiveFrom: "2026-07-01",
      },
    );
    const newDriverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postChangeDriver(token, otherLeaseId, {
      driverId: newDriverId,
      effectiveFrom: "2026-08-01",
    });
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("404 — the new driver belongs to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const oldDriverId = await ctx.createDriver(businessId);
    const currentId = await ctx.createDailyLease(businessId, vehicleId, oldDriverId, {
      effectiveFrom: "2026-07-01",
    });
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherDriverId = await ctx.createDriver(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postChangeDriver(token, currentId, {
      driverId: otherDriverId,
      effectiveFrom: "2026-08-01",
    });
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });
});
