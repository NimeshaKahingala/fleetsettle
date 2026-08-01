import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { mintLinkedDriver, mintUser, signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

async function confirmDay(token: string, body: unknown) {
  return request("/api/day-record/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

async function getDayRecord(token: string, dailyLeaseId: string, businessDate: string) {
  return request(`/api/day-record/${dailyLeaseId}/${businessDate}`, bearer(token));
}

/**
 * F-4.2/F-4.3/F-4.6 test matrix. `earned`/`received` are separate facts
 * (CLAUDE.md → Money, INV-2), one tap writes day_record + obligation +
 * payment + payment_allocation in a single transaction, a second tap is a
 * no-op, and a write into a closed period returns PERIOD_CLOSED from the
 * trigger rather than a pre-check.
 */
describe("confirm the day (P3, F-4.2/F-4.4)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — paid in full, the one-tap case (four inserts: day_record, obligation, payment, allocation)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId, {
      dailyLeaseAmountMinor: 5_000_00n,
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await confirmDay(token, {
      dailyLeaseId,
      businessDate: "2026-07-15",
      action: "paid_in_full",
    });
    expect(res.status).toBe(201);
    const body: { id: string } = await res.json();
    expect(body).toMatchObject({
      dailyLeaseId,
      vehicleId,
      driverId,
      businessDate: "2026-07-15",
      state: "ran_paid_full",
      earnedMinor: "500000",
      expectedMinor: "500000",
      receivedMinor: "500000",
      lostReason: null,
    });
    ctx.trackCreatedDayRecord(body.id);

    await ctx.cleanup();
  });

  it("happy path — something else: earned and received as two separate facts (a short-paid day, INV-2)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId, {
      dailyLeaseAmountMinor: 5_000_00n,
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await confirmDay(token, {
      dailyLeaseId,
      businessDate: "2026-07-15",
      action: "something_else",
      earnedMinor: "400000",
      receivedMinor: "250000",
    });
    expect(res.status).toBe(201);
    const body: { id: string } = await res.json();
    expect(body).toMatchObject({
      state: "ran_paid_short",
      earnedMinor: "400000",
      expectedMinor: "500000",
      receivedMinor: "250000",
    });
    ctx.trackCreatedDayRecord(body.id);

    await ctx.cleanup();
  });

  it("happy path — something else with nothing received writes no payment row (payment.amount_minor CHECK > 0)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId, {
      dailyLeaseAmountMinor: 5_000_00n,
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await confirmDay(token, {
      dailyLeaseId,
      businessDate: "2026-07-15",
      action: "something_else",
      earnedMinor: "400000",
      receivedMinor: "0",
    });
    expect(res.status).toBe(201);
    const body: { id: string } = await res.json();
    expect(body).toMatchObject({ state: "ran_unpaid", earnedMinor: "400000", receivedMinor: "0" });
    ctx.trackCreatedDayRecord(body.id);

    await ctx.cleanup();
  });

  it("happy path — didn't run: earned is always 0, no obligation is written (INV-6)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId, {
      dailyLeaseAmountMinor: 5_000_00n,
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await confirmDay(token, {
      dailyLeaseId,
      businessDate: "2026-07-15",
      action: "did_not_run",
      lostReason: "breakdown",
    });
    expect(res.status).toBe(201);
    const body: { id: string } = await res.json();
    expect(body).toMatchObject({
      state: "did_not_run",
      earnedMinor: "0",
      receivedMinor: "0",
      lostReason: "breakdown",
    });
    ctx.trackCreatedDayRecord(body.id);

    await ctx.cleanup();
  });

  it("a second tap changes nothing — idempotent on (daily_lease_id, business_date), 200 not 201", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId, {
      dailyLeaseAmountMinor: 5_000_00n,
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const first = await confirmDay(token, {
      dailyLeaseId,
      businessDate: "2026-07-15",
      action: "paid_in_full",
    });
    expect(first.status).toBe(201);
    const firstBody: { id: string } = await first.json();
    ctx.trackCreatedDayRecord(firstBody.id);

    // A retried tap — even one asking for a *different* outcome — is still a no-op: the day is already settled.
    const second = await confirmDay(token, {
      dailyLeaseId,
      businessDate: "2026-07-15",
      action: "did_not_run",
      lostReason: "breakdown",
    });
    expect(second.status).toBe(200);
    const secondBody: { id: string; state: string; receivedMinor: string } = await second.json();
    expect(secondBody).toMatchObject({
      id: firstBody.id,
      state: "ran_paid_full",
      receivedMinor: "500000",
    });

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await confirmDay("", { dailyLeaseId: "x", businessDate: "2026-07-15" });
    expect(res.status).toBe(401);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "MISSING_TOKEN" });
  });

  it("403 — a linked driver cannot confirm a day (dailyOperations is STAFF only)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await confirmDay(token, {
      dailyLeaseId,
      businessDate: "2026-07-15",
      action: "paid_in_full",
    });
    expect(res.status).toBe(403);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

    await ctx.cleanup();
  });

  it("404 — the daily lease belongs to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    await ctx.createOpenPeriod(otherBusinessId);
    const otherVehicleId = await ctx.createVehicle(otherBusinessId);
    const otherDriverId = await ctx.createDriver(otherBusinessId);
    const otherDailyLeaseId = await ctx.createDailyLease(
      otherBusinessId,
      otherVehicleId,
      otherDriverId,
    );
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await confirmDay(token, {
      dailyLeaseId: otherDailyLeaseId,
      businessDate: "2026-07-15",
      action: "paid_in_full",
    });
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("409 — a closed accounting period rejects the write, from the trigger, not a pre-check (INV-10)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    await ctx.closePeriod(periodId);

    const res = await confirmDay(token, {
      dailyLeaseId,
      businessDate: "2026-07-15",
      action: "paid_in_full",
    });
    expect(res.status).toBe(409);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "PERIOD_CLOSED" });

    await ctx.cleanup();
  });
});

describe("read a day record (P3, F-4.1)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — reads back exactly what confirming wrote", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId, {
      dailyLeaseAmountMinor: 5_000_00n,
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const confirmRes = await confirmDay(token, {
      dailyLeaseId,
      businessDate: "2026-07-15",
      action: "paid_in_full",
    });
    const confirmBody: { id: string } = await confirmRes.json();
    ctx.trackCreatedDayRecord(confirmBody.id);

    const res = await getDayRecord(token, dailyLeaseId, "2026-07-15");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: confirmBody.id,
      state: "ran_paid_full",
      receivedMinor: "500000",
    });

    await ctx.cleanup();
  });

  it("404 — this date is not yet confirmed (not gone — day_record rows are never deleted)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await getDayRecord(token, dailyLeaseId, "2026-07-15");
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("404 — the daily lease belongs to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherVehicleId = await ctx.createVehicle(otherBusinessId);
    const otherDriverId = await ctx.createDriver(otherBusinessId);
    const otherDailyLeaseId = await ctx.createDailyLease(
      otherBusinessId,
      otherVehicleId,
      otherDriverId,
    );
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await getDayRecord(token, otherDailyLeaseId, "2026-07-15");
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request("/api/day-record/00000000-0000-0000-0000-000000000000/2026-07-15", {
      headers: {},
    });
    expect(res.status).toBe(401);
  });
});
