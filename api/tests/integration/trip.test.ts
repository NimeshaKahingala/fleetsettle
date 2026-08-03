import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import {
  advance,
  advanceSettlement,
  dayRecord,
  obligation,
  vehicleDayAllocation,
} from "../../src/db/schema.js";
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

async function listInProgressTrips(token: string) {
  return request("/api/trip", bearer(token));
}

async function postCloseTrip(token: string, id: string, body: unknown) {
  return request(`/api/trip/${id}/close`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

async function postCancelTrip(token: string, id: string, body: unknown) {
  return request(`/api/trip/${id}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

async function postExpense(token: string, body: unknown) {
  return request("/api/expense", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

async function postAdvance(token: string, body: unknown) {
  return request("/api/advance", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

async function postSettleAdvance(token: string, id: string, body: unknown) {
  return request(`/api/advance/${id}/settle`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
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

/**
 * F-5.4/UC-44/W-41 test matrix. The happy path reproduces UC §7.1's own
 * worked charter exactly: 60,000 agreed, 22,000 fuel + 3,000 tolls (both
 * `borne_by = 'us'` on a charter, §6.7) + 9,000 driver fee = 34,000 costs,
 * 26,000 profit — the same figures the docs check a future change against.
 */
describe("close a trip (P6, F-5.4/UC-44)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("reproduces §7.1's charter exactly, with distance and km/l", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const customerId = await ctx.createCustomer(businessId);
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const trip = await postTrip(token, {
      vehicleId,
      customerId,
      driverId,
      startDate: "2026-07-29",
      endDate: "2026-07-31",
      agreedAmountMinor: "6000000",
      driverFeeMinor: "900000",
      openingOdometerKm: 10000,
      openingOdometerSource: "in_person",
    });
    expect(trip.status).toBe(201);
    const tripBody: { id: string } = await trip.json();
    ctx.trackCreatedTrip(tripBody.id);

    const fuel = await postExpense(token, {
      vehicleId,
      tripId: tripBody.id,
      category: "fuel",
      amountMinor: "2200000",
      spentOn: "2026-07-31",
      borneBy: "us",
      litres: 35,
    });
    expect(fuel.status).toBe(201);
    const fuelBody: { id: string } = await fuel.json();
    ctx.trackCreatedExpense(fuelBody.id);

    const tolls = await postExpense(token, {
      vehicleId,
      tripId: tripBody.id,
      category: "tolls",
      amountMinor: "300000",
      spentOn: "2026-07-31",
      borneBy: "us",
    });
    expect(tolls.status).toBe(201);
    const tollsBody: { id: string } = await tolls.json();
    ctx.trackCreatedExpense(tollsBody.id);

    const closed = await postCloseTrip(token, tripBody.id, {
      closingDate: "2026-07-31",
      closingOdometerKm: 10350,
      closingOdometerSource: "in_person",
    });
    expect(closed.status).toBe(200);
    const closedBody: {
      status: string;
      closingDate: string;
      incomeMinor: string;
      costsMinor: string;
      costsByCategory: Array<{ category: string; amountMinor: string }>;
      driverFeeMinor: string;
      profitMinor: string;
      distanceKm: number | null;
      litres: number | null;
      kmPerLitre: number | null;
    } = await closed.json();
    expect(closedBody).toMatchObject({
      status: "closed",
      closingDate: "2026-07-31",
      incomeMinor: "6000000",
      costsMinor: "2500000",
      driverFeeMinor: "900000",
      profitMinor: "2600000",
      distanceKm: 350,
      litres: 35,
      kmPerLitre: 10,
    });
    expect(closedBody.costsByCategory.sort((a, b) => a.category.localeCompare(b.category))).toEqual(
      [
        { category: "fuel", amountMinor: "2200000" },
        { category: "tolls", amountMinor: "300000" },
      ],
    );

    const feeObligations = await db
      .select()
      .from(obligation)
      .where(and(eq(obligation.sourceType, "trip"), eq(obligation.sourceId, tripBody.id)));
    expect(feeObligations).toHaveLength(1);
    expect(feeObligations[0]).toMatchObject({
      direction: "owed_by_us",
      partyType: "driver",
      partyDriverId: driverId,
      kind: "driver_fee",
      amountMinor: 900000n,
      postedPeriodId: periodId,
      vehicleId,
    });

    // A replay (double-submit) returns the same, already-persisted figures —
    // never a second driver-fee obligation.
    const replay = await postCloseTrip(token, tripBody.id, {
      closingDate: "2026-08-15",
      closingOdometerKm: 99999,
      closingOdometerSource: "in_person",
    });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ status: "closed", closingDate: "2026-07-31" });

    const feeObligationsAfterReplay = await db
      .select()
      .from(obligation)
      .where(and(eq(obligation.sourceType, "trip"), eq(obligation.sourceId, tripBody.id)));
    expect(feeObligationsAfterReplay).toHaveLength(1);

    await ctx.cleanup();
  });

  it("INV-17 — will not close while an advance against the trip is unreconciled", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const trip = await postTrip(token, {
      vehicleId,
      driverId,
      startDate: "2026-07-20",
      endDate: "2026-07-21",
      agreedAmountMinor: "1000000",
    });
    expect(trip.status).toBe(201);
    const tripBody: { id: string } = await trip.json();
    ctx.trackCreatedTrip(tripBody.id);

    const advanceRes = await postAdvance(token, {
      driverId,
      tripId: tripBody.id,
      amountMinor: "100000",
      issuedOn: "2026-07-20",
    });
    expect(advanceRes.status).toBe(201);
    const advanceBody: { id: string } = await advanceRes.json();
    ctx.trackCreatedAdvance(advanceBody.id);

    const blocked = await postCloseTrip(token, tripBody.id, { closingDate: "2026-07-21" });
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ code: "TRIP_ADVANCE_UNSETTLED" });

    const settled = await postSettleAdvance(token, advanceBody.id, {
      kind: "spent",
      amountMinor: "100000",
      occurredOn: "2026-07-21",
    });
    expect(settled.status).toBe(200);

    const closed = await postCloseTrip(token, tripBody.id, { closingDate: "2026-07-21" });
    expect(closed.status).toBe(200);
    expect(await closed.json()).toMatchObject({ status: "closed" });

    await ctx.cleanup();
  });

  it("400 — a cancelled trip cannot be closed", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const trip = await postTrip(token, {
      vehicleId,
      startDate: "2026-07-05",
      endDate: "2026-07-06",
    });
    const tripBody: { id: string } = await trip.json();
    ctx.trackCreatedTrip(tripBody.id);

    const cancelled = await postCancelTrip(token, tripBody.id, {});
    expect(cancelled.status).toBe(200);

    const closed = await postCloseTrip(token, tripBody.id, { closingDate: "2026-07-06" });
    expect(closed.status).toBe(400);
    expect(await closed.json()).toMatchObject({ code: "VALIDATION_ERROR" });

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request(`/api/trip/${crypto.randomUUID()}/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ closingDate: "2026-07-06" }),
    });
    expect(res.status).toBe(401);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "MISSING_TOKEN" });
  });

  it("403 — a linked driver cannot close a trip", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const owner = await mintUser(db, ctx, businessId, "owner");
    const ownerToken = await signAccessToken(owner.asgardeoSub);
    await ctx.createOpenPeriod(businessId);
    const trip = await postTrip(ownerToken, {
      vehicleId,
      startDate: "2026-07-07",
      endDate: "2026-07-08",
    });
    const tripBody: { id: string } = await trip.json();
    ctx.trackCreatedTrip(tripBody.id);

    const res = await postCloseTrip(token, tripBody.id, { closingDate: "2026-07-08" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

    await ctx.cleanup();
  });

  it("404 — the trip belongs to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    await ctx.createOpenPeriod(otherBusinessId);
    const otherVehicleId = await ctx.createVehicle(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);
    const otherOwner = await mintUser(db, ctx, otherBusinessId, "owner");
    const otherToken = await signAccessToken(otherOwner.asgardeoSub);

    const trip = await postTrip(otherToken, {
      vehicleId: otherVehicleId,
      startDate: "2026-07-09",
      endDate: "2026-07-09",
    });
    const tripBody: { id: string } = await trip.json();
    ctx.trackCreatedTrip(tripBody.id);

    const res = await postCloseTrip(token, tripBody.id, { closingDate: "2026-07-09" });
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });
});

/**
 * F-5.5/UC-45 test matrix. Cancellation itself never blocks; only an
 * unsettled advance needs a disposition (feeding the same INV-17 the close
 * flow does). The pause/resume case is F-5.1's other half — "a future trip
 * has no day records to pause" implies the converse: one booked inside the
 * horizon has day records that must come back on cancel.
 */
describe("cancel a trip (P6, F-5.5/UC-45)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("resumes paused day records and frees the vehicle's calendar", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const dates = ["2026-07-10", "2026-07-11", "2026-07-12"];
    const dayRecordIds: string[] = [];
    for (const date of dates) {
      dayRecordIds.push(
        await ctx.createDayRecord(businessId, periodId, dailyLeaseId, vehicleId, driverId, date),
      );
    }

    const trip = await postTrip(token, {
      vehicleId,
      startDate: "2026-07-10",
      endDate: "2026-07-12",
    });
    expect(trip.status).toBe(201);
    const tripBody: { id: string } = await trip.json();
    ctx.trackCreatedTrip(tripBody.id);

    const pausedRows = await db
      .select()
      .from(dayRecord)
      .where(eq(dayRecord.dailyLeaseId, dailyLeaseId));
    expect(pausedRows).toHaveLength(3);
    expect(pausedRows.every((r) => r.state === "paused_for_trip" && r.tripId === tripBody.id)).toBe(
      true,
    );

    const cancelled = await postCancelTrip(token, tripBody.id, {
      cancelReason: "customer changed plans",
    });
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toMatchObject({
      status: "cancelled",
      cancelReason: "customer changed plans",
      advanceDisposition: null,
    });

    const resumedRows = await db
      .select()
      .from(dayRecord)
      .where(eq(dayRecord.dailyLeaseId, dailyLeaseId));
    expect(resumedRows.every((r) => r.state === "open" && r.tripId === null)).toBe(true);

    const allocationRows = await db
      .select()
      .from(vehicleDayAllocation)
      .where(eq(vehicleDayAllocation.sourceId, tripBody.id));
    expect(allocationRows).toHaveLength(0);

    await ctx.cleanup();
  });

  it("409 then 200 — an unsettled advance needs a disposition before it can cancel", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const trip = await postTrip(token, {
      vehicleId,
      driverId,
      startDate: "2026-07-15",
      endDate: "2026-07-16",
    });
    const tripBody: { id: string } = await trip.json();
    ctx.trackCreatedTrip(tripBody.id);

    const advanceRes = await postAdvance(token, {
      driverId,
      tripId: tripBody.id,
      amountMinor: "50000",
      issuedOn: "2026-07-15",
    });
    const advanceBody: { id: string } = await advanceRes.json();
    ctx.trackCreatedAdvance(advanceBody.id);

    const blocked = await postCancelTrip(token, tripBody.id, {});
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ code: "TRIP_ADVANCE_UNSETTLED" });

    const cancelled = await postCancelTrip(token, tripBody.id, { advanceDisposition: "retained" });
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toMatchObject({
      status: "cancelled",
      advanceDisposition: "retained",
    });

    const advanceRows = await db.select().from(advance).where(eq(advance.id, advanceBody.id));
    expect(advanceRows[0]).toMatchObject({ status: "settled" });

    const settlements = await db
      .select()
      .from(advanceSettlement)
      .where(eq(advanceSettlement.advanceId, advanceBody.id));
    expect(settlements).toHaveLength(1);
    expect(settlements[0]).toMatchObject({ kind: "kept_as_fee", amountMinor: 50000n });

    await ctx.cleanup();
  });

  it("400 — a closed trip cannot be cancelled", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const trip = await postTrip(token, {
      vehicleId,
      startDate: "2026-07-17",
      endDate: "2026-07-18",
    });
    const tripBody: { id: string } = await trip.json();
    ctx.trackCreatedTrip(tripBody.id);

    const closed = await postCloseTrip(token, tripBody.id, { closingDate: "2026-07-18" });
    expect(closed.status).toBe(200);

    const cancelled = await postCancelTrip(token, tripBody.id, {});
    expect(cancelled.status).toBe(400);
    expect(await cancelled.json()).toMatchObject({ code: "VALIDATION_ERROR" });

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request(`/api/trip/${crypto.randomUUID()}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "MISSING_TOKEN" });
  });

  it("403 — a linked driver cannot cancel a trip", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const owner = await mintUser(db, ctx, businessId, "owner");
    const ownerToken = await signAccessToken(owner.asgardeoSub);
    const trip = await postTrip(ownerToken, {
      vehicleId,
      startDate: "2026-07-19",
      endDate: "2026-07-19",
    });
    const tripBody: { id: string } = await trip.json();
    ctx.trackCreatedTrip(tripBody.id);

    const res = await postCancelTrip(token, tripBody.id, {});
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

    await ctx.cleanup();
  });

  it("404 — the trip belongs to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherVehicleId = await ctx.createVehicle(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);
    const otherOwner = await mintUser(db, ctx, otherBusinessId, "owner");
    const otherToken = await signAccessToken(otherOwner.asgardeoSub);

    const trip = await postTrip(otherToken, {
      vehicleId: otherVehicleId,
      startDate: "2026-07-22",
      endDate: "2026-07-22",
    });
    const tripBody: { id: string } = await trip.json();
    ctx.trackCreatedTrip(tripBody.id);

    const res = await postCancelTrip(token, tripBody.id, {});
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });
});

describe("GET /api/trip — in progress (Home item 7, UI §3.2)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("returns a booked trip with vehicle/customer/driver names resolved, excludes a closed one, only for this business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId, { registration: "CAB-4444" });
    const customerId = await ctx.createCustomer(businessId, { name: "Perera Tours" });
    const driverId = await ctx.createDriver(businessId, { name: "Ranil" });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const bookedRes = await postTrip(token, {
      vehicleId,
      customerId,
      driverId,
      startDate: "2026-03-01",
      endDate: "2026-03-03",
      destination: "Kandy",
    });
    expect(bookedRes.status).toBe(201);
    const bookedBody: { id: string } = await bookedRes.json();
    ctx.trackCreatedTrip(bookedBody.id);

    // Excluded: already closed (booking never writes `in_progress` — see
    // arrangement.ts's own comment on tripResponseSchema).
    const periodId = await ctx.createOpenPeriod(businessId);
    const closedVehicleId = await ctx.createVehicle(businessId, { registration: "CAB-5555" });
    await ctx.createTrip(businessId, closedVehicleId, periodId);

    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherVehicleId = await ctx.createVehicle(otherBusinessId);
    const otherOwner = await mintUser(db, ctx, otherBusinessId, "owner");
    const otherToken = await signAccessToken(otherOwner.asgardeoSub);
    const otherRes = await postTrip(otherToken, {
      vehicleId: otherVehicleId,
      startDate: "2026-03-01",
      endDate: "2026-03-03",
    });
    const otherBody: { id: string } = await otherRes.json();
    ctx.trackCreatedTrip(otherBody.id);

    const res = await listInProgressTrips(token);
    expect(res.status).toBe(200);
    const body: Array<{
      id: string;
      vehicleRegistration: string;
      customerName: string | null;
      driverName: string | null;
      startDate: string;
      endDate: string;
      destination: string | null;
    }> = await res.json();
    expect(body.map((r) => r.id)).toEqual([bookedBody.id]);
    expect(body[0]).toMatchObject({
      vehicleRegistration: "CAB-4444",
      customerName: "Perera Tours",
      driverName: "Ranil",
      startDate: "2026-03-01",
      endDate: "2026-03-03",
      destination: "Kandy",
    });

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request("/api/trip");
    expect(res.status).toBe(401);
  });

  it("403 — a linked driver cannot read the in-progress trip list", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await listInProgressTrips(token);
    expect(res.status).toBe(403);

    await ctx.cleanup();
  });
});
