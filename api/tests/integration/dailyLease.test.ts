import { addDays, businessToday } from "@fleetsettle/shared";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { dayRecord, obligation, vehicleDayAllocation } from "../../src/db/schema.js";
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

async function postEndDailyLease(token: string, id: string, body: unknown) {
  return request(`/api/daily-lease/${id}/end`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

async function postChangeRate(token: string, id: string, body: unknown) {
  return request(`/api/daily-lease/${id}/rate`, {
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

  it("GAP-118 — a future date inside the old lease's own materialised horizon is freed, then refilled under the new driver", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const today = businessToday();
    await ctx.createOpenPeriod(businessId, { periodStart: today, periodEnd: addDays(today, 30) });
    const vehicleId = await ctx.createVehicle(businessId);
    const oldDriverId = await ctx.createDriver(businessId, { name: "Sunil" });
    const newDriverId = await ctx.createDriver(businessId, { name: "Kamal" });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const started = await postDailyLease(token, {
      vehicleId,
      driverId: oldDriverId,
      patternType: "every_day",
      effectiveFrom: today,
      dailyLeaseAmountMinor: "500000",
    });
    expect(started.status).toBe(201);
    const startedBody: { id: string } = await started.json();
    ctx.trackCreatedDailyLease(startedBody.id);

    const futureDate = addDays(today, 5);
    const changeFrom = addDays(today, 3);

    // Confirmed live, before the fix touches anything: D-9's own synchronous
    // materialisation already put a real allocation + open day_record on the
    // old lease for a date well inside its horizon.
    const beforeAllocation = await db
      .select({ sourceId: vehicleDayAllocation.sourceId, voidedAt: vehicleDayAllocation.voidedAt })
      .from(vehicleDayAllocation)
      .where(
        and(
          eq(vehicleDayAllocation.vehicleId, vehicleId),
          eq(vehicleDayAllocation.businessDate, futureDate),
        ),
      );
    expect(beforeAllocation).toEqual([{ sourceId: startedBody.id, voidedAt: null }]);

    const res = await postChangeDriver(token, startedBody.id, {
      driverId: newDriverId,
      effectiveFrom: changeFrom,
    });
    expect(res.status).toBe(201);
    const body: { id: string } = await res.json();
    ctx.trackCreatedDailyLease(body.id);

    // GAP-118's own fix: the old lease's row for this date is voided, not
    // silently left `open` under the driver who no longer covers it.
    const oldRecord = await db
      .select({
        driverId: dayRecord.driverId,
        state: dayRecord.state,
        voidedAt: dayRecord.voidedAt,
      })
      .from(dayRecord)
      .where(
        and(eq(dayRecord.dailyLeaseId, startedBody.id), eq(dayRecord.businessDate, futureDate)),
      );
    expect(oldRecord).toHaveLength(1);
    expect(oldRecord[0]?.driverId).toBe(oldDriverId);
    expect(oldRecord[0]?.state).toBe("open");
    expect(oldRecord[0]?.voidedAt).not.toBeNull();

    const oldAllocation = await db
      .select({ voidedAt: vehicleDayAllocation.voidedAt })
      .from(vehicleDayAllocation)
      .where(
        and(
          eq(vehicleDayAllocation.sourceType, "daily_lease"),
          eq(vehicleDayAllocation.sourceId, startedBody.id),
          eq(vehicleDayAllocation.businessDate, futureDate),
        ),
      );
    expect(oldAllocation[0]?.voidedAt).not.toBeNull();

    // And the new lease actually materialised over it — not left blank
    // because `listAllocatedDatesForVehicle` still read the old (now voided)
    // row as "already there".
    const newAllocation = await db
      .select({ sourceId: vehicleDayAllocation.sourceId, voidedAt: vehicleDayAllocation.voidedAt })
      .from(vehicleDayAllocation)
      .where(
        and(
          eq(vehicleDayAllocation.vehicleId, vehicleId),
          eq(vehicleDayAllocation.businessDate, futureDate),
          eq(vehicleDayAllocation.sourceId, body.id),
        ),
      );
    expect(newAllocation).toEqual([{ sourceId: body.id, voidedAt: null }]);

    const newRecord = await db
      .select({ driverId: dayRecord.driverId, state: dayRecord.state })
      .from(dayRecord)
      .where(and(eq(dayRecord.dailyLeaseId, body.id), eq(dayRecord.businessDate, futureDate)));
    expect(newRecord).toEqual([{ driverId: newDriverId, state: "open" }]);

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

/**
 * F-4.8/UC-101/GAP-25 test matrix. **Distinct from F-4.7**: nothing reopens
 * behind this close, so the only write is the same GAP-118 void trio, this
 * time with no replacement lease materialising over the freed dates.
 */
describe("end a daily lease (F-4.8/UC-101, GAP-25)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — effective_to closes on the given date, driver and pattern unchanged", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId, { name: "Sunil" });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const started = await postDailyLease(token, {
      vehicleId,
      driverId,
      patternType: "weekdays",
      patternWeekdays: [1, 3, 5],
      effectiveFrom: "2026-07-01",
      dailyLeaseAmountMinor: "500000",
    });
    expect(started.status).toBe(201);
    const startedBody: { id: string } = await started.json();
    ctx.trackCreatedDailyLease(startedBody.id);

    const res = await postEndDailyLease(token, startedBody.id, { effectiveTo: "2026-08-15" });
    expect(res.status).toBe(200);
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
    expect(body).toMatchObject({
      id: startedBody.id,
      vehicleId,
      driverId,
      patternType: "weekdays",
      patternWeekdays: [1, 3, 5],
      effectiveFrom: "2026-07-01",
      effectiveTo: "2026-08-15",
      dailyLeaseAmountMinor: "500000",
    });

    const getRes = await getDailyLease(token, startedBody.id);
    const getBody: { effectiveTo: string | null } = await getRes.json();
    expect(getBody.effectiveTo).toBe("2026-08-15");

    await ctx.cleanup();
  });

  it("GAP-118 — a future date inside the lease's own materialised horizon is voided, and nothing refills it", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const today = businessToday();
    await ctx.createOpenPeriod(businessId, { periodStart: today, periodEnd: addDays(today, 30) });
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const started = await postDailyLease(token, {
      vehicleId,
      driverId,
      patternType: "every_day",
      effectiveFrom: today,
      dailyLeaseAmountMinor: "500000",
    });
    expect(started.status).toBe(201);
    const startedBody: { id: string } = await started.json();
    ctx.trackCreatedDailyLease(startedBody.id);

    const endsOn = addDays(today, 3);
    const futureDate = addDays(today, 5);

    // Confirmed live, before the fix touches anything: D-9's own synchronous
    // materialisation already put a real allocation + open day_record on
    // this lease for a date well inside its horizon.
    const beforeAllocation = await db
      .select({ sourceId: vehicleDayAllocation.sourceId, voidedAt: vehicleDayAllocation.voidedAt })
      .from(vehicleDayAllocation)
      .where(
        and(
          eq(vehicleDayAllocation.vehicleId, vehicleId),
          eq(vehicleDayAllocation.businessDate, futureDate),
        ),
      );
    expect(beforeAllocation).toEqual([{ sourceId: startedBody.id, voidedAt: null }]);

    const res = await postEndDailyLease(token, startedBody.id, { effectiveTo: endsOn });
    expect(res.status).toBe(200);

    const record = await db
      .select({ state: dayRecord.state, voidedAt: dayRecord.voidedAt })
      .from(dayRecord)
      .where(
        and(eq(dayRecord.dailyLeaseId, startedBody.id), eq(dayRecord.businessDate, futureDate)),
      );
    expect(record).toHaveLength(1);
    expect(record[0]?.state).toBe("open");
    expect(record[0]?.voidedAt).not.toBeNull();

    const allocation = await db
      .select({ voidedAt: vehicleDayAllocation.voidedAt })
      .from(vehicleDayAllocation)
      .where(
        and(
          eq(vehicleDayAllocation.sourceType, "daily_lease"),
          eq(vehicleDayAllocation.sourceId, startedBody.id),
          eq(vehicleDayAllocation.businessDate, futureDate),
        ),
      );
    expect(allocation[0]?.voidedAt).not.toBeNull();

    // Distinct from F-4.7: nothing reopens behind this close, so the date
    // stays free rather than being refilled under a new lease.
    const anyLiveAllocation = await db
      .select({ id: vehicleDayAllocation.id })
      .from(vehicleDayAllocation)
      .where(
        and(
          eq(vehicleDayAllocation.vehicleId, vehicleId),
          eq(vehicleDayAllocation.businessDate, futureDate),
          isNull(vehicleDayAllocation.voidedAt),
        ),
      );
    expect(anyLiveAllocation).toHaveLength(0);

    await ctx.cleanup();
  });

  it("INV-37 — never refuses on an open driver balance, and leaves it exactly where it was", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const currentId = await ctx.createDailyLease(businessId, vehicleId, driverId, {
      effectiveFrom: "2026-07-01",
    });
    const obligationId = await ctx.createObligation(businessId, periodId, {
      direction: "owed_to_us",
      partyType: "driver",
      driverId,
      amountMinor: 25_000_00n,
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postEndDailyLease(token, currentId, { effectiveTo: "2026-08-15" });
    expect(res.status).toBe(200);

    const rows = await db
      .select({ status: obligation.status, amountMinor: obligation.amountMinor })
      .from(obligation)
      .where(eq(obligation.id, obligationId));
    expect(rows).toEqual([{ status: "pending", amountMinor: 25_000_00n }]);

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

    const res = await postEndDailyLease(token, endedId, { effectiveTo: "2026-01-01" });
    expect(res.status).toBe(400);
    const body: { code: string } = await res.json();
    expect(body).toMatchObject({ code: "VALIDATION_ERROR" });

    await ctx.cleanup();
  });

  it("400 — effectiveTo is before this assignment's own start date", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const currentId = await ctx.createDailyLease(businessId, vehicleId, driverId, {
      effectiveFrom: "2026-07-01",
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postEndDailyLease(token, currentId, { effectiveTo: "2026-06-30" });
    expect(res.status).toBe(400);
    const body: { code: string } = await res.json();
    expect(body).toMatchObject({ code: "VALIDATION_ERROR" });

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request(`/api/daily-lease/${crypto.randomUUID()}/end`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ effectiveTo: "2026-08-15" }),
    });
    expect(res.status).toBe(401);
  });

  it("403 — a linked driver cannot end a daily lease", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const currentId = await ctx.createDailyLease(businessId, vehicleId, driverId, {
      effectiveFrom: "2026-07-01",
    });
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await postEndDailyLease(token, currentId, { effectiveTo: "2026-08-15" });
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
      { effectiveFrom: "2026-07-01" },
    );
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postEndDailyLease(token, otherLeaseId, { effectiveTo: "2026-08-15" });
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });
});

/**
 * F-4.3/UC-32/GAP-2 test matrix. The rate-table sibling of the driver-change
 * matrix above: the current `daily_lease_rate` closes the day before and a
 * new one opens, and — distinct from a driver change — every already-
 * materialised but unconfirmed future card is re-priced in the same
 * transaction rather than voided, since nothing here stops the lease itself.
 */
describe("change a daily lease's rate (F-4.3/UC-32, GAP-2)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — the old rate closes the day before, a new one opens", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const started = await postDailyLease(token, {
      vehicleId,
      driverId,
      patternType: "every_day",
      effectiveFrom: "2026-07-01",
      dailyLeaseAmountMinor: "500000",
    });
    expect(started.status).toBe(201);
    const startedBody: { id: string } = await started.json();
    ctx.trackCreatedDailyLease(startedBody.id);

    const res = await postChangeRate(token, startedBody.id, {
      dailyLeaseAmountMinor: "600000",
      effectiveFrom: "2026-08-10",
    });
    expect(res.status).toBe(201);
    const body: { dailyLeaseId: string; dailyLeaseAmountMinor: string; effectiveFrom: string } =
      await res.json();
    expect(body).toMatchObject({
      dailyLeaseId: startedBody.id,
      dailyLeaseAmountMinor: "600000",
      effectiveFrom: "2026-08-10",
    });

    // The lease itself — driver, pattern, vehicle — is untouched by a rate
    // change; only `daily_lease_rate` moved.
    const leaseRes = await getDailyLease(token, startedBody.id);
    const leaseBody: {
      driverId: string;
      effectiveTo: string | null;
      dailyLeaseAmountMinor: string;
    } = await leaseRes.json();
    expect(leaseBody).toMatchObject({
      driverId,
      effectiveTo: null,
      dailyLeaseAmountMinor: "600000",
    });

    await ctx.cleanup();
  });

  it("F-4.3 — a future date inside the lease's own materialised horizon is re-priced, not voided", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const today = businessToday();
    await ctx.createOpenPeriod(businessId, { periodStart: today, periodEnd: addDays(today, 30) });
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const started = await postDailyLease(token, {
      vehicleId,
      driverId,
      patternType: "every_day",
      effectiveFrom: today,
      dailyLeaseAmountMinor: "500000",
    });
    expect(started.status).toBe(201);
    const startedBody: { id: string } = await started.json();
    ctx.trackCreatedDailyLease(startedBody.id);

    const futureDate = addDays(today, 5);
    const changeFrom = addDays(today, 3);

    // D-9's own synchronous materialisation already put a real, still-open
    // day_record on the horizon at the old rate.
    const before = await db
      .select({ expectedMinor: dayRecord.expectedMinor, state: dayRecord.state })
      .from(dayRecord)
      .where(
        and(eq(dayRecord.dailyLeaseId, startedBody.id), eq(dayRecord.businessDate, futureDate)),
      );
    expect(before).toEqual([{ expectedMinor: 500_000n, state: "open" }]);

    const res = await postChangeRate(token, startedBody.id, {
      dailyLeaseAmountMinor: "700000",
      effectiveFrom: changeFrom,
    });
    expect(res.status).toBe(201);

    const after = await db
      .select({
        expectedMinor: dayRecord.expectedMinor,
        state: dayRecord.state,
        voidedAt: dayRecord.voidedAt,
      })
      .from(dayRecord)
      .where(
        and(eq(dayRecord.dailyLeaseId, startedBody.id), eq(dayRecord.businessDate, futureDate)),
      );
    // Same row (re-priced, not voided-and-replaced) — distinct from GAP-118's
    // driver-change behaviour, since nothing here stops this lease.
    expect(after).toEqual([{ expectedMinor: 700_000n, state: "open", voidedAt: null }]);

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

    const res = await postChangeRate(token, endedId, {
      dailyLeaseAmountMinor: "600000",
      effectiveFrom: "2026-01-01",
    });
    expect(res.status).toBe(400);
    const body: { code: string } = await res.json();
    expect(body).toMatchObject({ code: "VALIDATION_ERROR" });

    await ctx.cleanup();
  });

  it("400 — effectiveFrom is not after the current rate's own start date", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const currentId = await ctx.createDailyLease(businessId, vehicleId, driverId, {
      effectiveFrom: "2026-07-01",
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postChangeRate(token, currentId, {
      dailyLeaseAmountMinor: "600000",
      effectiveFrom: "2026-07-01",
    });
    expect(res.status).toBe(400);
    const body: { code: string } = await res.json();
    expect(body).toMatchObject({ code: "VALIDATION_ERROR" });

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request(`/api/daily-lease/${crypto.randomUUID()}/rate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dailyLeaseAmountMinor: "600000", effectiveFrom: "2026-08-01" }),
    });
    expect(res.status).toBe(401);
  });

  it("403 — a linked driver cannot change a daily lease's rate", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const currentId = await ctx.createDailyLease(businessId, vehicleId, driverId, {
      effectiveFrom: "2026-07-01",
    });
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await postChangeRate(token, currentId, {
      dailyLeaseAmountMinor: "600000",
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
      { effectiveFrom: "2026-07-01" },
    );
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postChangeRate(token, otherLeaseId, {
      dailyLeaseAmountMinor: "600000",
      effectiveFrom: "2026-08-01",
    });
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });
});
