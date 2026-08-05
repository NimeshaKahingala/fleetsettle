import { writer } from "../../src/db/client.js";
import { afterAll, describe, expect, it } from "vitest";
import { mintLinkedDriver, mintUser, signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

function getDriverView(token: string, from: string, to: string) {
  return request(`/api/driver-view?from=${from}&to=${to}`, bearer(token));
}

interface DriverViewBody {
  owedToUsMinor: string;
  owedByUsMinor: string;
  days: { businessDate: string; state: string; earnedMinor: string; receivedMinor: string }[];
  trips: { id: string; agreedAmountMinor: string; driverFeeMinor: string }[];
  advances: { id: string; amountMinor: string }[];
  offsets: { id: string; amountMinor: string }[];
  deposit: { id: string; heldMinor: string } | null;
}

/**
 * F-6.8/UC-59/W-13 (P12): the linked driver's own read-only view. INV-25 is
 * the whole point — `driverId` is resolved from the verified identity
 * (`requireDriverId`), never taken as a parameter, so there is no request
 * shape that could ask for a different driver's data.
 */
describe("the driver's own view (P12, F-6.8/UC-59)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — both balances, days (including an excused one), trips, advances, offsets, deposit", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId, { name: "Sunil" });
    const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId);

    await ctx.createDayRecord(
      businessId,
      periodId,
      dailyLeaseId,
      vehicleId,
      driverId,
      "2026-07-03",
      {
        state: "ran_paid_full",
        earnedMinor: 5_000n,
        expectedMinor: 5_000n,
      },
    );
    await ctx.createDayRecord(
      businessId,
      periodId,
      dailyLeaseId,
      vehicleId,
      driverId,
      "2026-07-04",
      {
        state: "did_not_run",
        expectedMinor: 5_000n,
        lostReason: "public_holiday",
      },
    );

    await ctx.createObligation(businessId, periodId, {
      direction: "owed_to_us",
      partyType: "driver",
      driverId,
      amountMinor: 20_000n,
      settledMinor: 5_000n,
      status: "part_paid",
    });
    await ctx.createObligation(businessId, periodId, {
      direction: "owed_by_us",
      partyType: "driver",
      driverId,
      amountMinor: 9_000n,
    });

    const tripId = await ctx.createTrip(businessId, vehicleId, periodId, {
      driverId,
      agreedAmountMinor: 60_000n,
      driverFeeMinor: 9_000n,
      startDate: "2026-07-10",
      endDate: "2026-07-12",
      closingDate: "2026-07-12",
    });

    const advanceId = await ctx.createAdvance(businessId, periodId, driverId, {
      amountMinor: 3_000n,
      issuedOn: "2026-07-11",
    });

    const owner = await mintUser(db, ctx, businessId, "owner");
    const offsetId = await ctx.createOffsetRecord(businessId, periodId, driverId, owner.userId, {
      amountMinor: 1_000n,
      occurredOn: "2026-07-06",
    });

    const depositId = await ctx.createDeposit(businessId, { partyType: "driver", driverId });
    await ctx.createDepositMovement(businessId, periodId, depositId, {
      movementType: "taken",
      amountMinor: 15_000n,
      occurredOn: "2026-07-01",
    });

    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await getDriverView(token, "2026-07-01", "2026-07-31");
    expect(res.status).toBe(200);
    const body: DriverViewBody = await res.json();

    expect(body.owedToUsMinor).toBe("15000");
    expect(body.owedByUsMinor).toBe("9000");

    const ranDay = body.days.find((d) => d.businessDate === "2026-07-03");
    expect(ranDay).toMatchObject({ state: "ran_paid_full", earnedMinor: "5000" });
    const excusedDay = body.days.find((d) => d.businessDate === "2026-07-04");
    expect(excusedDay).toMatchObject({ state: "did_not_run", earnedMinor: "0" });

    expect(body.trips.map((t) => t.id)).toContain(tripId);
    const tripRow = body.trips.find((t) => t.id === tripId);
    expect(tripRow).toMatchObject({ agreedAmountMinor: "60000", driverFeeMinor: "9000" });

    expect(body.advances.map((a) => a.id)).toEqual([advanceId]);
    expect(body.advances[0]?.amountMinor).toBe("3000");

    expect(body.offsets.map((o) => o.id)).toEqual([offsetId]);
    expect(body.offsets[0]?.amountMinor).toBe("1000");

    expect(body.deposit).toMatchObject({ id: depositId, heldMinor: "15000" });

    await ctx.cleanup();
  });

  it("INV-25 — a linked driver never sees another driver's rows", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    // Two vehicles — `daily_lease`'s own EXCLUDE constraint refuses two live daily leases on one vehicle at once.
    const vehicleA = await ctx.createVehicle(businessId, { registration: "DV-A" });
    const vehicleB = await ctx.createVehicle(businessId, { registration: "DV-B" });

    const driverA = await ctx.createDriver(businessId, { name: "Driver A" });
    const dailyLeaseA = await ctx.createDailyLease(businessId, vehicleA, driverA);
    await ctx.createDayRecord(businessId, periodId, dailyLeaseA, vehicleA, driverA, "2026-07-05", {
      state: "ran_paid_full",
    });
    const advanceA = await ctx.createAdvance(businessId, periodId, driverA, {
      amountMinor: 2_000n,
    });

    const driverB = await ctx.createDriver(businessId, { name: "Driver B" });
    const dailyLeaseB = await ctx.createDailyLease(businessId, vehicleB, driverB);
    await ctx.createDayRecord(businessId, periodId, dailyLeaseB, vehicleB, driverB, "2026-07-06", {
      state: "ran_paid_full",
    });
    await ctx.createAdvance(businessId, periodId, driverB, { amountMinor: 9_999n });

    const linkedA = await mintLinkedDriver(db, ctx, driverA);
    const token = await signAccessToken(linkedA.asgardeoSub);

    const res = await getDriverView(token, "2026-07-01", "2026-07-31");
    expect(res.status).toBe(200);
    const body: DriverViewBody = await res.json();

    expect(body.days.map((d) => d.businessDate)).toEqual(["2026-07-05"]);
    expect(body.advances.map((a) => a.id)).toEqual([advanceA]);

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request("/api/driver-view?from=2026-07-01&to=2026-07-31");
    expect(res.status).toBe(401);
  });

  it("403 — an owner (staff, not a linked driver) cannot read this view", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await getDriverView(token, "2026-07-01", "2026-07-31");
    expect(res.status).toBe(403);

    await ctx.cleanup();
  });
});
