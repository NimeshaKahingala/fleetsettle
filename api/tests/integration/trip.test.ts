import { addDays, businessToday } from "@fleetsettle/shared";
import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import {
  advance,
  advanceSettlement,
  dayRecord,
  obligation,
  trip as tripTable,
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

async function postDailyLease(token: string, body: unknown) {
  return request("/api/daily-lease", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

async function getTrip(token: string, id: string) {
  return request(`/api/trip/${id}`, bearer(token));
}

async function postPayment(token: string, body: unknown) {
  return request("/api/payment", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
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

async function postConfirmTrip(token: string, id: string) {
  return request(`/api/trip/${id}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: "{}",
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
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "C");
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

  it("GAP-119 — a charter can be booked on a vehicle already on daily lease (D-12: REPLACED, not refused), and cancelling restores the lease's occupancy", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const today = businessToday();
    await ctx.createOpenPeriod(businessId, { periodStart: today, periodEnd: addDays(today, 30) });
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "B");
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const leaseRes = await postDailyLease(token, {
      vehicleId,
      driverId,
      patternType: "every_day",
      effectiveFrom: today,
      dailyLeaseAmountMinor: "500000",
    });
    expect(leaseRes.status).toBe(201);
    const leaseBody: { id: string } = await leaseRes.json();
    ctx.trackCreatedDailyLease(leaseBody.id);

    const tripStart = addDays(today, 4);
    const tripEnd = addDays(today, 6);

    // Live before the fix touches anything: D-9's own synchronous
    // materialisation already occupies these three dates for the daily
    // lease, none of them voided.
    const beforeAllocations = await db
      .select({
        businessDate: vehicleDayAllocation.businessDate,
        voidedAt: vehicleDayAllocation.voidedAt,
      })
      .from(vehicleDayAllocation)
      .where(
        and(
          eq(vehicleDayAllocation.sourceType, "daily_lease"),
          eq(vehicleDayAllocation.sourceId, leaseBody.id),
          gte(vehicleDayAllocation.businessDate, tripStart),
          lte(vehicleDayAllocation.businessDate, tripEnd),
        ),
      );
    expect(beforeAllocations).toHaveLength(3);
    expect(beforeAllocations.every((r) => r.voidedAt === null)).toBe(true);

    // Wave 0's own reproduction of GAP-119, pre-fix: this returned 409
    // VEHICLE_DOUBLE_BOOKED. D-12 says REPLACED, not refused.
    const tripRes = await postTrip(token, {
      vehicleId,
      startDate: tripStart,
      endDate: tripEnd,
    });
    expect(tripRes.status).toBe(201);
    const tripBody: { id: string } = await tripRes.json();
    ctx.trackCreatedTrip(tripBody.id);

    const leaseAllocationsDuringTrip = await db
      .select({ voidedAt: vehicleDayAllocation.voidedAt })
      .from(vehicleDayAllocation)
      .where(
        and(
          eq(vehicleDayAllocation.sourceType, "daily_lease"),
          eq(vehicleDayAllocation.sourceId, leaseBody.id),
          gte(vehicleDayAllocation.businessDate, tripStart),
          lte(vehicleDayAllocation.businessDate, tripEnd),
        ),
      );
    expect(leaseAllocationsDuringTrip).toHaveLength(3);
    expect(leaseAllocationsDuringTrip.every((r) => r.voidedAt !== null)).toBe(true);

    const tripAllocations = await db
      .select({ voidedAt: vehicleDayAllocation.voidedAt })
      .from(vehicleDayAllocation)
      .where(
        and(
          eq(vehicleDayAllocation.sourceType, "trip"),
          eq(vehicleDayAllocation.sourceId, tripBody.id),
        ),
      );
    expect(tripAllocations).toHaveLength(3);
    expect(tripAllocations.every((r) => r.voidedAt === null)).toBe(true);

    // GAP-119's other half: cancelling gives the daily lease its days back.
    const cancelRes = await postCancelTrip(token, tripBody.id, { cancelReason: "plans changed" });
    expect(cancelRes.status).toBe(200);

    const liveAfterCancel = await db
      .select({
        businessDate: vehicleDayAllocation.businessDate,
        sourceId: vehicleDayAllocation.sourceId,
      })
      .from(vehicleDayAllocation)
      .where(
        and(
          eq(vehicleDayAllocation.vehicleId, vehicleId),
          gte(vehicleDayAllocation.businessDate, tripStart),
          lte(vehicleDayAllocation.businessDate, tripEnd),
          isNull(vehicleDayAllocation.voidedAt),
        ),
      );
    expect(liveAfterCancel).toHaveLength(3);
    // Restored under the vehicle's *current* daily lease — this test never
    // changed drivers, so that is still the same lease id GAP-119 released.
    expect(liveAfterCancel.every((r) => r.sourceId === leaseBody.id)).toBe(true);

    await ctx.cleanup();
  });

  it("defaults agreedAmountMinor and driverFeeMinor to zero when omitted", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "C");
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
    await ctx.setVehicleArrangement(vehicleId, "C");
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
    const secondBody: {
      code: string;
      details?: {
        conflict: {
          sourceType: string;
          from: string;
          to: string | null;
          holderLabel: string;
          destination: string | null;
        };
        nextFreeFrom: string | null;
      };
    } = await second.json();
    expect(secondBody.code).toBe("VEHICLE_DOUBLE_BOOKED");
    // GAP-44: the enriched payload names the real conflict — the first
    // trip's own dates, not the requested range — and a free date the
    // dialog can offer in one tap, computed from what's actually occupied
    // rather than merely "past the requested range".
    expect(secondBody.details).toMatchObject({
      conflict: {
        sourceType: "trip",
        from: "2026-05-10",
        to: "2026-05-12",
        holderLabel: "no customer on file",
        destination: null,
      },
      nextFreeFrom: "2026-05-13",
    });

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

  it("GAP-44: 409 — a trip booked over a vehicle's already-materialised lease occupancy names the lease and its customer, not just the vehicle", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    // The conflict this reproduces is real precisely because arrangement is
    // set to C for the booking attempt (matching bookTrip's own gate) while
    // the vehicle_day_allocation row below carries arrangement A — the
    // lease's own materialised horizon (P13/day-card-generation.ts), not
    // something startLease itself would ever write synchronously.
    await ctx.setVehicleArrangement(vehicleId, "C");
    const customerId = await ctx.createCustomer(businessId);
    const leaseId = await ctx.createLease(businessId, vehicleId, customerId, {
      startDate: "2026-06-01",
      endDate: "2026-06-10",
      status: "active",
    });
    await ctx.createVehicleDayAllocation(businessId, vehicleId, "2026-06-05", "A", leaseId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postTrip(token, {
      vehicleId,
      startDate: "2026-06-03",
      endDate: "2026-06-06",
    });
    expect(res.status).toBe(409);
    const body: {
      code: string;
      details?: {
        conflict: {
          sourceType: string;
          from: string;
          to: string | null;
          holderLabel: string;
          destination: string | null;
        };
        nextFreeFrom: string | null;
      };
    } = await res.json();
    expect(body.code).toBe("VEHICLE_DOUBLE_BOOKED");
    expect(body.details).toMatchObject({
      conflict: {
        sourceType: "lease",
        from: "2026-06-01",
        to: "2026-06-10",
        holderLabel: "Test Customer",
        destination: null,
      },
      // Only 2026-06-05 is actually occupied — the requested length is 4
      // days (06-03..06-06), and 06-06..06-09 is the first such window with
      // no occupied date in it.
      nextFreeFrom: "2026-06-06",
    });

    await ctx.cleanup();
  });

  it("GAP-23/A6 — raises a trip_fare receivable when there's a customer and an agreed amount", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "C");
    const customerId = await ctx.createCustomer(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postTrip(token, {
      vehicleId,
      customerId,
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      agreedAmountMinor: "4500000",
    });
    expect(res.status).toBe(201);
    const body: { id: string } = await res.json();
    ctx.trackCreatedTrip(body.id);

    const obligationRows = await db
      .select()
      .from(obligation)
      .where(and(eq(obligation.sourceType, "trip"), eq(obligation.sourceId, body.id)));
    expect(obligationRows).toHaveLength(1);
    expect(obligationRows[0]).toMatchObject({
      direction: "owed_to_us",
      partyType: "customer",
      partyCustomerId: customerId,
      kind: "trip_fare",
      amountMinor: 4_500_000n,
      settledMinor: 0n,
      // Due once the trip is over, not the day it was booked.
      dueOn: "2026-06-03",
      effectiveDueOn: "2026-06-03",
      status: "pending",
      postedPeriodId: periodId,
      voidedAt: null,
    });

    await ctx.cleanup();
  });

  it("GAP-5b — a customer's own unapplied payment credit settles the new trip_fare receivable on the spot", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "C");
    const customerId = await ctx.createCustomer(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const paymentRes = await request("/api/payment", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...bearer(token).headers },
      body: JSON.stringify({
        partyType: "customer",
        partyId: customerId,
        amountMinor: "1000000",
        occurredOn: "2026-05-20",
      }),
    });
    expect(paymentRes.status).toBe(201);
    const paymentBody: { id: string; unallocatedMinor: string } = await paymentRes.json();
    expect(paymentBody.unallocatedMinor).toBe("1000000");
    ctx.trackCreatedPayment(paymentBody.id);

    const res = await postTrip(token, {
      vehicleId,
      customerId,
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      agreedAmountMinor: "700000",
    });
    expect(res.status).toBe(201);
    const body: { id: string } = await res.json();
    ctx.trackCreatedTrip(body.id);

    const obligationRows = await db
      .select()
      .from(obligation)
      .where(and(eq(obligation.sourceType, "trip"), eq(obligation.sourceId, body.id)));
    expect(obligationRows).toHaveLength(1);
    // Not the pre-GAP-5b "settledMinor: 0n, status: pending" — the
    // customer's own credit fully covers this fare on the spot.
    expect(obligationRows[0]).toMatchObject({
      amountMinor: 700_000n,
      settledMinor: 700_000n,
      status: "paid",
    });

    await ctx.cleanup();
  });

  it("GAP-23/A6 — an owner-driven charter with no customer raises no receivable", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "C");
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postTrip(token, {
      vehicleId,
      startDate: "2026-06-05",
      endDate: "2026-06-06",
      agreedAmountMinor: "1000000",
    });
    expect(res.status).toBe(201);
    const body: { id: string } = await res.json();
    ctx.trackCreatedTrip(body.id);

    const obligationRows = await db
      .select()
      .from(obligation)
      .where(and(eq(obligation.sourceType, "trip"), eq(obligation.sourceId, body.id)));
    expect(obligationRows).toHaveLength(0);

    await ctx.cleanup();
  });

  it("GAP-23/A6 — a charter with no customer needs no accounting period at all", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    // Deliberately no ctx.createOpenPeriod — proves a charter that never
    // raises an obligation is never refused for one either.
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "C");
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postTrip(token, {
      vehicleId,
      startDate: "2026-06-12",
      endDate: "2026-06-12",
    });
    expect(res.status).toBe(201);
    const body: { id: string } = await res.json();
    ctx.trackCreatedTrip(body.id);

    await ctx.cleanup();
  });

  it("409 PERIOD_CLOSED — booking a charter for a customer with no accounting period open (GAP-23/A6)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "C");
    const customerId = await ctx.createCustomer(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postTrip(token, {
      vehicleId,
      customerId,
      startDate: "2026-06-10",
      endDate: "2026-06-11",
      agreedAmountMinor: "1000000",
    });
    expect(res.status).toBe(409);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "PERIOD_CLOSED" });

    // The whole booking is one transaction — the obligation insert fails
    // last, but nothing earlier in it (the allocation rows) is left behind.
    const leftoverAllocations = await db
      .select()
      .from(vehicleDayAllocation)
      .where(eq(vehicleDayAllocation.vehicleId, vehicleId));
    expect(leftoverAllocations).toHaveLength(0);

    await ctx.cleanup();
  });
});

/**
 * ST-5/GAP-7 test matrix: F-5.1 step 4's "Confirm → booked, or hold if the
 * enquiry is tentative." A hold reserves the calendar (an `isHold: true`
 * allocation row) but takes neither of `bookTrip`'s two "this is real now"
 * steps — the daily lease's own day records stay unpaused, and no
 * `trip_fare` obligation is raised, both deferred to confirm.
 */
describe("book a trip as a hold (GAP-7/ST-5)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("reserves the calendar with isHold allocation rows, sets holdExpiresOn, and does not pause the daily lease's day records or raise a receivable", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const today = businessToday();
    await ctx.createOpenPeriod(businessId, { periodStart: today, periodEnd: addDays(today, 30) });
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "B");
    const driverId = await ctx.createDriver(businessId);
    const customerId = await ctx.createCustomer(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const leaseRes = await postDailyLease(token, {
      vehicleId,
      driverId,
      patternType: "every_day",
      effectiveFrom: today,
      dailyLeaseAmountMinor: "500000",
    });
    expect(leaseRes.status).toBe(201);
    const leaseBody: { id: string } = await leaseRes.json();
    ctx.trackCreatedDailyLease(leaseBody.id);

    const holdStart = addDays(today, 2);
    const holdEnd = addDays(today, 3);

    const res = await postTrip(token, {
      vehicleId,
      customerId,
      startDate: holdStart,
      endDate: holdEnd,
      agreedAmountMinor: "1000000",
      asHold: true,
    });
    expect(res.status).toBe(201);
    const body: { id: string; status: string; holdExpiresOn: string | null } = await res.json();
    ctx.trackCreatedTrip(body.id);
    expect(body.status).toBe("hold");
    expect(body.holdExpiresOn).toBe(addDays(today, 7)); // business_settings.hold_expiry_days default
    expect(body).toMatchObject({ receivable: null });

    const allocationRows = await db
      .select()
      .from(vehicleDayAllocation)
      .where(
        and(
          eq(vehicleDayAllocation.sourceType, "trip"),
          eq(vehicleDayAllocation.sourceId, body.id),
        ),
      );
    expect(allocationRows).toHaveLength(2);
    expect(allocationRows.every((r) => r.arrangement === "C" && r.isHold)).toBe(true);

    // The whole point of a hold: the daily lease's own already-generated
    // day records for these dates are untouched — no pause, no lost income.
    const dayRecordRows = await db
      .select({ state: dayRecord.state, businessDate: dayRecord.businessDate })
      .from(dayRecord)
      .where(
        and(
          eq(dayRecord.dailyLeaseId, leaseBody.id),
          gte(dayRecord.businessDate, holdStart),
          lte(dayRecord.businessDate, holdEnd),
        ),
      );
    expect(dayRecordRows).toHaveLength(2);
    expect(dayRecordRows.every((r) => r.state === "open")).toBe(true);

    const obligationRows = await db
      .select()
      .from(obligation)
      .where(and(eq(obligation.sourceType, "trip"), eq(obligation.sourceId, body.id)));
    expect(obligationRows).toHaveLength(0);

    await ctx.cleanup();
  });

  it("defaults asHold to false — an old client that has never heard of holds keeps booking outright", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "C");
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postTrip(token, {
      vehicleId,
      startDate: "2026-04-01",
      endDate: "2026-04-01",
    });
    expect(res.status).toBe(201);
    const body: { id: string; status: string; holdExpiresOn: string | null } = await res.json();
    ctx.trackCreatedTrip(body.id);
    expect(body.status).toBe("booked");
    expect(body.holdExpiresOn).toBeNull();

    await ctx.cleanup();
  });
});

/**
 * ST-5/GAP-7: the confirm half of "it expires or is confirmed" —
 * `hold` → `booked`.
 */
describe("confirm a hold (GAP-7/ST-5)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("pauses the daily lease's day records, clears isHold, raises the deferred receivable, and reports in_progress once the range has started", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const today = businessToday();
    await ctx.createOpenPeriod(businessId, { periodStart: today, periodEnd: addDays(today, 30) });
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "B");
    const driverId = await ctx.createDriver(businessId);
    const customerId = await ctx.createCustomer(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const leaseRes = await postDailyLease(token, {
      vehicleId,
      driverId,
      patternType: "every_day",
      effectiveFrom: today,
      dailyLeaseAmountMinor: "500000",
    });
    const leaseBody: { id: string } = await leaseRes.json();
    ctx.trackCreatedDailyLease(leaseBody.id);

    // Starts today, so once confirmed it reads as in_progress immediately.
    const holdRes = await postTrip(token, {
      vehicleId,
      customerId,
      startDate: today,
      endDate: addDays(today, 1),
      agreedAmountMinor: "800000",
      asHold: true,
    });
    const holdBody: { id: string } = await holdRes.json();
    ctx.trackCreatedTrip(holdBody.id);

    const confirmRes = await postConfirmTrip(token, holdBody.id);
    expect(confirmRes.status).toBe(200);
    const confirmed: {
      status: string;
      holdExpiresOn: string | null;
      receivable: { amountMinor: string; status: string } | null;
    } = await confirmRes.json();
    expect(confirmed.status).toBe("in_progress");
    expect(confirmed.holdExpiresOn).toBeNull();
    expect(confirmed.receivable).toMatchObject({ amountMinor: "800000", status: "pending" });

    const allocationRows = await db
      .select({ isHold: vehicleDayAllocation.isHold })
      .from(vehicleDayAllocation)
      .where(
        and(
          eq(vehicleDayAllocation.sourceType, "trip"),
          eq(vehicleDayAllocation.sourceId, holdBody.id),
        ),
      );
    expect(allocationRows.every((r) => !r.isHold)).toBe(true);

    const dayRecordRows = await db
      .select({ state: dayRecord.state })
      .from(dayRecord)
      .where(
        and(
          eq(dayRecord.dailyLeaseId, leaseBody.id),
          gte(dayRecord.businessDate, today),
          lte(dayRecord.businessDate, addDays(today, 1)),
        ),
      );
    expect(dayRecordRows).toHaveLength(2);
    expect(dayRecordRows.every((r) => r.state === "paused_for_trip")).toBe(true);

    const obligationRows = await db
      .select()
      .from(obligation)
      .where(and(eq(obligation.sourceType, "trip"), eq(obligation.sourceId, holdBody.id)));
    expect(obligationRows).toHaveLength(1);

    await ctx.cleanup();
  });

  it("400 — a trip that is not a hold cannot be confirmed", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "C");
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const bookedRes = await postTrip(token, {
      vehicleId,
      startDate: "2026-04-10",
      endDate: "2026-04-10",
    });
    const bookedBody: { id: string } = await bookedRes.json();
    ctx.trackCreatedTrip(bookedBody.id);

    const res = await postConfirmTrip(token, bookedBody.id);
    expect(res.status).toBe(400);
    const body: { code: string } = await res.json();
    expect(body).toMatchObject({ code: "VALIDATION_ERROR" });

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request(`/api/trip/00000000-0000-0000-0000-000000000000/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "MISSING_TOKEN" });
  });

  it("403 — a linked driver cannot confirm a hold", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await postConfirmTrip(token, "00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(403);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

    await ctx.cleanup();
  });

  it("404 — the trip belongs to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherVehicleId = await ctx.createVehicle(otherBusinessId);
    await ctx.setVehicleArrangement(otherVehicleId, "C");
    const otherOwner = await mintUser(db, ctx, otherBusinessId, "owner");
    const otherToken = await signAccessToken(otherOwner.asgardeoSub);

    const otherHoldRes = await postTrip(otherToken, {
      vehicleId: otherVehicleId,
      startDate: "2026-04-15",
      endDate: "2026-04-15",
      asHold: true,
    });
    const otherHoldBody: { id: string } = await otherHoldRes.json();
    ctx.trackCreatedTrip(otherHoldBody.id);

    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postConfirmTrip(token, otherHoldBody.id);
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });
});

/**
 * GAP-7/ST-5: "release is synchronous… before it checks for a conflict" —
 * `bookTrip`/`startDailyLease`/`startLease` each release a vehicle's own
 * expired holds ahead of every conflict check, never only by the nightly
 * sweep.
 */
describe("expired holds release synchronously, never only by cron (GAP-7)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("a real booking over an expired hold's own dates succeeds, and the stale hold is cancelled with its allocation voided", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "C");
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const holdRes = await postTrip(token, {
      vehicleId,
      startDate: "2026-05-01",
      endDate: "2026-05-02",
      asHold: true,
    });
    expect(holdRes.status).toBe(201);
    const holdBody: { id: string } = await holdRes.json();
    ctx.trackCreatedTrip(holdBody.id);

    // Backdate the expiry — the only way to reach "already expired" in a
    // test, since the API itself always computes a real future date.
    await db
      .update(tripTable)
      .set({ holdExpiresOn: "2020-01-01" })
      .where(eq(tripTable.id, holdBody.id));

    const bookedRes = await postTrip(token, {
      vehicleId,
      startDate: "2026-05-01",
      endDate: "2026-05-02",
    });
    expect(bookedRes.status).toBe(201);
    const bookedBody: { id: string; status: string } = await bookedRes.json();
    ctx.trackCreatedTrip(bookedBody.id);
    expect(bookedBody.status).toBe("booked");

    const staleHold = await getTrip(token, holdBody.id);
    const staleHoldBody: { status: string; cancelReason: string | null } = await staleHold.json();
    expect(staleHoldBody).toMatchObject({ status: "cancelled", cancelReason: "Hold expired" });

    const staleAllocations = await db
      .select({
        voidedAt: vehicleDayAllocation.voidedAt,
        voidedReason: vehicleDayAllocation.voidedReason,
      })
      .from(vehicleDayAllocation)
      .where(
        and(
          eq(vehicleDayAllocation.sourceType, "trip"),
          eq(vehicleDayAllocation.sourceId, holdBody.id),
        ),
      );
    expect(staleAllocations).toHaveLength(2);
    expect(
      staleAllocations.every((r) => r.voidedAt !== null && r.voidedReason === "Hold expired"),
    ).toBe(true);

    await ctx.cleanup();
  });

  it("starting a daily lease releases this vehicle's own expired hold first", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const today = businessToday();
    const vehicleId = await ctx.createVehicle(businessId);
    // GAP-84/GAP-87: booking a trip needs B or C, starting a daily lease
    // needs B or null — B is the only arrangement this test's own sequence
    // (hold, then a daily lease on the same vehicle) can pass both gates
    // with, the same choice the sibling GAP-119 test above makes.
    await ctx.setVehicleArrangement(vehicleId, "B");
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const holdRes = await postTrip(token, {
      vehicleId,
      startDate: today,
      endDate: addDays(today, 1),
      asHold: true,
    });
    expect(holdRes.status).toBe(201);
    const holdBody: { id: string } = await holdRes.json();
    ctx.trackCreatedTrip(holdBody.id);
    await db
      .update(tripTable)
      .set({ holdExpiresOn: "2020-01-01" })
      .where(eq(tripTable.id, holdBody.id));

    const leaseRes = await postDailyLease(token, {
      vehicleId,
      driverId,
      patternType: "every_day",
      effectiveFrom: today,
      dailyLeaseAmountMinor: "500000",
    });
    expect(leaseRes.status).toBe(201);
    const leaseBody: { id: string } = await leaseRes.json();
    ctx.trackCreatedDailyLease(leaseBody.id);

    const staleHold = await getTrip(token, holdBody.id);
    const staleHoldBody: { status: string } = await staleHold.json();
    expect(staleHoldBody).toMatchObject({ status: "cancelled" });

    // The daily lease's own horizon claimed today's date once the hold's
    // stale allocation stopped occupying it.
    const dailyLeaseAllocation = await db
      .select()
      .from(vehicleDayAllocation)
      .where(
        and(
          eq(vehicleDayAllocation.sourceType, "daily_lease"),
          eq(vehicleDayAllocation.sourceId, leaseBody.id),
          eq(vehicleDayAllocation.businessDate, today),
          isNull(vehicleDayAllocation.voidedAt),
        ),
      );
    expect(dailyLeaseAllocation).toHaveLength(1);

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
    await ctx.setVehicleArrangement(vehicleId, "C");
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

    // GAP-23/A6: booking with a customer and an agreed amount already raised
    // the trip_fare receivable — same sourceType/sourceId as the driver-fee
    // obligation close is about to add, so every query below is scoped by
    // `kind` to stay about the one it's actually testing.
    const fareObligations = await db
      .select()
      .from(obligation)
      .where(
        and(
          eq(obligation.sourceType, "trip"),
          eq(obligation.sourceId, tripBody.id),
          eq(obligation.kind, "trip_fare"),
        ),
      );
    expect(fareObligations).toHaveLength(1);
    expect(fareObligations[0]).toMatchObject({
      direction: "owed_to_us",
      partyType: "customer",
      partyCustomerId: customerId,
      amountMinor: 6_000_000n,
      dueOn: "2026-07-31",
      status: "pending",
      postedPeriodId: periodId,
      vehicleId,
    });

    const feeObligations = await db
      .select()
      .from(obligation)
      .where(
        and(
          eq(obligation.sourceType, "trip"),
          eq(obligation.sourceId, tripBody.id),
          eq(obligation.kind, "driver_fee"),
        ),
      );
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
      .where(
        and(
          eq(obligation.sourceType, "trip"),
          eq(obligation.sourceId, tripBody.id),
          eq(obligation.kind, "driver_fee"),
        ),
      );
    expect(feeObligationsAfterReplay).toHaveLength(1);

    await ctx.cleanup();
  });

  it("INV-17 — will not close while an advance against the trip is unreconciled", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "C");
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
    await ctx.setVehicleArrangement(vehicleId, "C");
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

  it("400 — GAP-7: a hold must be confirmed before it can be closed", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "C");
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const holdRes = await postTrip(token, {
      vehicleId,
      startDate: "2026-07-05",
      endDate: "2026-07-06",
      asHold: true,
    });
    const holdBody: { id: string } = await holdRes.json();
    ctx.trackCreatedTrip(holdBody.id);

    const closed = await postCloseTrip(token, holdBody.id, { closingDate: "2026-07-06" });
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
    await ctx.setVehicleArrangement(vehicleId, "C");
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
    await ctx.setVehicleArrangement(otherVehicleId, "C");
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
    await ctx.setVehicleArrangement(vehicleId, "B");
    const driverId = await ctx.createDriver(businessId);
    const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId);
    // GAP-119: cancelling now re-materialises the vehicle's current daily
    // lease (this one — open-ended, effectiveFrom in the past) from today
    // onward, real rows this fixture's own narrower cleanup doesn't expect.
    ctx.trackCreatedDailyLease(dailyLeaseId);
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

    // D-11/W-58: voided, never deleted — the trace stays, the vehicle is free.
    const allocationRows = await db
      .select()
      .from(vehicleDayAllocation)
      .where(eq(vehicleDayAllocation.sourceId, tripBody.id));
    expect(allocationRows).toHaveLength(3);
    expect(allocationRows.every((r) => r.voidedAt !== null && r.voidedReason !== null)).toBe(true);

    const liveAllocationRows = allocationRows.filter((r) => r.voidedAt === null);
    expect(liveAllocationRows).toHaveLength(0);

    await ctx.cleanup();
  });

  it("GAP-7 — cancels a hold directly, with nothing to undo (no obligation raised, no day records paused)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "C");
    const customerId = await ctx.createCustomer(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const holdRes = await postTrip(token, {
      vehicleId,
      customerId,
      startDate: "2026-08-01",
      endDate: "2026-08-02",
      agreedAmountMinor: "500000",
      asHold: true,
    });
    expect(holdRes.status).toBe(201);
    const holdBody: { id: string } = await holdRes.json();
    ctx.trackCreatedTrip(holdBody.id);

    const cancelled = await postCancelTrip(token, holdBody.id, {});
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toMatchObject({ status: "cancelled" });

    const allocationRows = await db
      .select()
      .from(vehicleDayAllocation)
      .where(eq(vehicleDayAllocation.sourceId, holdBody.id));
    expect(allocationRows.every((r) => r.voidedAt !== null)).toBe(true);

    await ctx.cleanup();
  });

  it("409 then 200 — an unsettled advance needs a disposition before it can cancel", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "C");
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
    await ctx.setVehicleArrangement(vehicleId, "C");
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
    await ctx.setVehicleArrangement(vehicleId, "C");
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
    await ctx.setVehicleArrangement(otherVehicleId, "C");
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

  it("GAP-23/A6 — cancelling voids the trip_fare obligation this booking raised", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "C");
    const customerId = await ctx.createCustomer(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const trip = await postTrip(token, {
      vehicleId,
      customerId,
      startDate: "2026-07-24",
      endDate: "2026-07-25",
      agreedAmountMinor: "2000000",
    });
    expect(trip.status).toBe(201);
    const tripBody: { id: string } = await trip.json();
    ctx.trackCreatedTrip(tripBody.id);

    const cancelled = await postCancelTrip(token, tripBody.id, { cancelReason: "rained out" });
    expect(cancelled.status).toBe(200);

    const obligationRows = await db
      .select()
      .from(obligation)
      .where(and(eq(obligation.sourceType, "trip"), eq(obligation.sourceId, tripBody.id)));
    expect(obligationRows).toHaveLength(1);
    expect(obligationRows[0]?.voidedAt).not.toBeNull();
    expect(obligationRows[0]).toMatchObject({ voidedReason: "rained out" });

    await ctx.cleanup();
  });

  it("GAP-23/A6 — cancelling without a cancelReason still voids the receivable, with a system-supplied reason", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "C");
    const customerId = await ctx.createCustomer(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const trip = await postTrip(token, {
      vehicleId,
      customerId,
      startDate: "2026-07-26",
      endDate: "2026-07-26",
      agreedAmountMinor: "800000",
    });
    const tripBody: { id: string } = await trip.json();
    ctx.trackCreatedTrip(tripBody.id);

    const cancelled = await postCancelTrip(token, tripBody.id, {});
    expect(cancelled.status).toBe(200);

    const obligationRows = await db
      .select()
      .from(obligation)
      .where(and(eq(obligation.sourceType, "trip"), eq(obligation.sourceId, tripBody.id)));
    expect(obligationRows[0]?.voidedAt).not.toBeNull();
    expect(obligationRows[0]?.voidedReason).not.toBeNull();

    await ctx.cleanup();
  });

  it("409 PERIOD_CLOSED — cancelling a trip whose trip_fare posted into a now-closed period (A9a)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "C");
    const customerId = await ctx.createCustomer(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const trip = await postTrip(token, {
      vehicleId,
      customerId,
      startDate: "2026-07-27",
      endDate: "2026-07-28",
      agreedAmountMinor: "1500000",
    });
    expect(trip.status).toBe(201);
    const tripBody: { id: string } = await trip.json();
    ctx.trackCreatedTrip(tripBody.id);

    await ctx.closePeriod(periodId);

    const cancelled = await postCancelTrip(token, tripBody.id, {});
    expect(cancelled.status).toBe(409);
    const body: { code: string } = await cancelled.json();
    expect(body).toMatchObject({ code: "PERIOD_CLOSED" });

    // The whole cancel is one transaction — the receivable is refused
    // unvoided, and nothing earlier in it (day records, allocation) unwound either.
    const obligationRows = await db
      .select()
      .from(obligation)
      .where(and(eq(obligation.sourceType, "trip"), eq(obligation.sourceId, tripBody.id)));
    expect(obligationRows[0]?.voidedAt).toBeNull();

    const allocationRows = await db
      .select()
      .from(vehicleDayAllocation)
      .where(eq(vehicleDayAllocation.sourceId, tripBody.id));
    expect(allocationRows).toHaveLength(2);

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
    await ctx.setVehicleArrangement(vehicleId, "C");
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
    await ctx.setVehicleArrangement(otherVehicleId, "C");
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

async function getTripExpenses(token: string, id: string) {
  return request(`/api/trip/${id}/expense`, bearer(token));
}

/**
 * Web-P7: the open-trip screen's own "Costs so far" — every cost logged
 * against this trip, not filtered to `borne_by = 'us'` the way the P&L's
 * own sum is (a driver- or customer-borne cost is still something that
 * happened on this trip, and the manager reviewing it before closing wants
 * to see all of it).
 */
describe("a trip's costs so far (Web-P7, GET /{id}/expense)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — every cost against this trip, newest first, voided ones included", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "C");
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const trip = await postTrip(token, {
      vehicleId,
      startDate: "2026-03-01",
      endDate: "2026-03-03",
    });
    const tripBody: { id: string } = await trip.json();
    ctx.trackCreatedTrip(tripBody.id);

    const fuel = await postExpense(token, {
      vehicleId,
      tripId: tripBody.id,
      category: "fuel",
      amountMinor: "2200000",
      spentOn: "2026-03-01",
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
      spentOn: "2026-03-02",
      borneBy: "us",
    });
    expect(tolls.status).toBe(201);
    const tollsBody: { id: string } = await tolls.json();
    ctx.trackCreatedExpense(tollsBody.id);

    const res = await getTripExpenses(token, tripBody.id);
    expect(res.status).toBe(200);
    const body: Array<{ id: string; category: string; amountMinor: string; spentOn: string }> =
      await res.json();
    // Newest first — tolls (2 Mar) before fuel (1 Mar).
    expect(body.map((r) => r.id)).toEqual([tollsBody.id, fuelBody.id]);
    expect(body[0]).toMatchObject({ category: "tolls", amountMinor: "300000" });
    expect(body[1]).toMatchObject({ category: "fuel", amountMinor: "2200000" });

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request(`/api/trip/${crypto.randomUUID()}/expense`);
    expect(res.status).toBe(401);
  });

  it("403 — a linked driver cannot read a trip's costs", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "C");
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const ownerToken = await signAccessToken(owner.asgardeoSub);
    const trip = await postTrip(ownerToken, {
      vehicleId,
      startDate: "2026-03-01",
      endDate: "2026-03-03",
    });
    const tripBody: { id: string } = await trip.json();
    ctx.trackCreatedTrip(tripBody.id);

    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await getTripExpenses(token, tripBody.id);
    expect(res.status).toBe(403);

    await ctx.cleanup();
  });

  it("404 — a trip belonging to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherVehicleId = await ctx.createVehicle(otherBusinessId);
    await ctx.setVehicleArrangement(otherVehicleId, "C");
    const otherOwner = await mintUser(db, ctx, otherBusinessId, "owner");
    const otherToken = await signAccessToken(otherOwner.asgardeoSub);
    const otherTrip = await postTrip(otherToken, {
      vehicleId: otherVehicleId,
      startDate: "2026-03-01",
      endDate: "2026-03-03",
    });
    const otherTripBody: { id: string } = await otherTrip.json();
    ctx.trackCreatedTrip(otherTripBody.id);

    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await getTripExpenses(token, otherTripBody.id);
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });
});

/**
 * GAP-57: `TripDetailScreen` was rendering "Received" as `NotAvailable`
 * with a reason that A6 (GAP-23) made false — a `trip_fare` obligation is
 * raised at booking, but nothing surfaced its state back through
 * `GET /api/trip/{id}`. These prove the full lifecycle: present and
 * pending right after booking, reflecting a real payment once one lands,
 * absent for a charter with no customer, and absent again once cancelled
 * voids it (A6's own `voidObligationBySource`).
 */
describe("GET /api/trip/{id} — the receivable (GAP-57)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("a freshly booked charter with a customer and an agreed amount carries a pending receivable", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "C");
    const customerId = await ctx.createCustomer(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postTrip(token, {
      vehicleId,
      customerId,
      startDate: "2026-03-01",
      endDate: "2026-03-03",
      agreedAmountMinor: "3000000",
    });
    const body: { id: string; receivable: Record<string, unknown> | null } = await res.json();
    expect(body.receivable).toMatchObject({
      kind: "trip_fare",
      dueOn: "2026-03-03",
      amountMinor: "3000000",
      settledMinor: "0",
      waivedMinor: "0",
      status: "pending",
    });
    ctx.trackCreatedTrip(body.id);

    const getRes = await getTrip(token, body.id);
    const getBody: { receivable: Record<string, unknown> | null } = await getRes.json();
    expect(getBody.receivable).toMatchObject({
      id: body.receivable?.["id"],
      amountMinor: "3000000",
      settledMinor: "0",
      status: "pending",
    });

    await ctx.cleanup();
  });

  it("a payment against the customer settles the same receivable GET /api/trip/{id} shows", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "C");
    const customerId = await ctx.createCustomer(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const booked = await postTrip(token, {
      vehicleId,
      customerId,
      startDate: "2026-03-01",
      endDate: "2026-03-03",
      agreedAmountMinor: "3000000",
    });
    const bookedBody: { id: string } = await booked.json();
    ctx.trackCreatedTrip(bookedBody.id);

    const paymentRes = await postPayment(token, {
      partyType: "customer",
      partyId: customerId,
      amountMinor: "3000000",
      occurredOn: "2026-03-02",
    });
    expect(paymentRes.status).toBe(201);
    const paymentBody: { id: string } = await paymentRes.json();
    ctx.trackCreatedPayment(paymentBody.id);

    const getRes = await getTrip(token, bookedBody.id);
    const getBody: { receivable: Record<string, unknown> | null } = await getRes.json();
    expect(getBody.receivable).toMatchObject({
      amountMinor: "3000000",
      settledMinor: "3000000",
      status: "paid",
    });

    await ctx.cleanup();
  });

  it("an owner-driven charter with no customer carries no receivable, not a fabricated zero", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "C");
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postTrip(token, {
      vehicleId,
      startDate: "2026-03-01",
      endDate: "2026-03-03",
    });
    const body: { id: string; receivable: unknown } = await res.json();
    expect(body.receivable).toBeNull();
    ctx.trackCreatedTrip(body.id);

    const getRes = await getTrip(token, body.id);
    const getBody: { receivable: unknown } = await getRes.json();
    expect(getBody.receivable).toBeNull();

    await ctx.cleanup();
  });

  it("cancelling a trip voids its receivable — GET /api/trip/{id} shows none afterward", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "C");
    const customerId = await ctx.createCustomer(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const booked = await postTrip(token, {
      vehicleId,
      customerId,
      startDate: "2026-03-01",
      endDate: "2026-03-03",
      agreedAmountMinor: "3000000",
    });
    const bookedBody: { id: string } = await booked.json();
    ctx.trackCreatedTrip(bookedBody.id);

    const cancelRes = await postCancelTrip(token, bookedBody.id, {});
    expect(cancelRes.status).toBe(200);

    const getRes = await getTrip(token, bookedBody.id);
    const getBody: { receivable: unknown } = await getRes.json();
    expect(getBody.receivable).toBeNull();

    await ctx.cleanup();
  });

  it("404 — a trip belonging to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness();
    const otherVehicleId = await ctx.createVehicle(otherBusinessId);
    await ctx.setVehicleArrangement(otherVehicleId, "C");
    const otherOwner = await mintUser(db, ctx, otherBusinessId, "owner");
    const otherToken = await signAccessToken(otherOwner.asgardeoSub);
    const otherTrip = await postTrip(otherToken, {
      vehicleId: otherVehicleId,
      startDate: "2026-03-01",
      endDate: "2026-03-03",
    });
    const otherTripBody: { id: string } = await otherTrip.json();
    ctx.trackCreatedTrip(otherTripBody.id);

    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await getTrip(token, otherTripBody.id);
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });
});
