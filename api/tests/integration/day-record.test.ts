import { addDays, businessToday } from "@fleetsettle/shared";
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

async function listUnconfirmedDayRecords(token: string) {
  return request("/api/day-record", bearer(token));
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

  it("GAP-3 — a pre-generated `open` row (P13's generate-day-cards) is filled in by confirm, not silently discarded", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId, {
      dailyLeaseAmountMinor: 5_000_00n,
    });
    // The exact shape the cron leaves behind: a bare `open` row, already
    // sitting under the unique (daily_lease_id, business_date) key confirm
    // is idempotent on — before this fix, `existing` alone short-circuited
    // confirmDay into a no-op regardless of state, discarding the tap.
    const dayRecordId = await ctx.createDayRecord(
      businessId,
      periodId,
      dailyLeaseId,
      vehicleId,
      driverId,
      "2026-07-15",
    );
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
      id: dayRecordId,
      state: "ran_paid_full",
      earnedMinor: "500000",
      expectedMinor: "500000",
      receivedMinor: "500000",
    });

    // The row itself is the same one the cron created (an UPDATE, not a
    // second row), and the real obligation/payment it should have written
    // all along are there on a plain read, not just in this response.
    const readBack = await getDayRecord(token, dailyLeaseId, "2026-07-15");
    expect(readBack.status).toBe(200);
    const readBody: { id: string; state: string; receivedMinor: string } = await readBack.json();
    expect(readBody).toMatchObject({
      id: dayRecordId,
      state: "ran_paid_full",
      receivedMinor: "500000",
    });

    // A second tap against the now-confirmed row is still the ordinary no-op — filling in the placeholder didn't lose that guarantee.
    const second = await confirmDay(token, {
      dailyLeaseId,
      businessDate: "2026-07-15",
      action: "did_not_run",
      lostReason: "breakdown",
    });
    expect(second.status).toBe(200);
    const secondBody: { id: string; state: string } = await second.json();
    expect(secondBody).toMatchObject({ id: dayRecordId, state: "ran_paid_full" });

    ctx.trackCreatedDayRecord(dayRecordId);

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

  it("400 GAP-20 — an off-pattern date cannot be confirmed on demand (the pre-existing hole this item closes: materializeDailyLeaseHorizon has always checked isPatternDay, this on-demand path never did)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    // alternate: on on effectiveFrom (day zero), off the next day — 2026-07-02 is off-pattern.
    const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId, {
      patternType: "alternate",
      effectiveFrom: "2026-07-01",
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await confirmDay(token, {
      dailyLeaseId,
      businessDate: "2026-07-02",
      action: "paid_in_full",
    });
    expect(res.status).toBe(400);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "VALIDATION_ERROR" });

    await ctx.cleanup();
  });

  it("400 GAP-20 — an individually-skipped date cannot be confirmed on demand", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const exceptionRes = await request(`/api/daily-lease/${dailyLeaseId}/exception`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...bearer(token).headers },
      body: JSON.stringify({ exceptionDate: "2026-07-15", reason: "Driver on leave" }),
    });
    expect(exceptionRes.status).toBe(201);
    const exceptionBody: { id: string } = await exceptionRes.json();
    ctx.trackCreatedLeaseDayException(exceptionBody.id);

    const res = await confirmDay(token, {
      dailyLeaseId,
      businessDate: "2026-07-15",
      action: "paid_in_full",
    });
    expect(res.status).toBe(400);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "VALIDATION_ERROR" });

    await ctx.cleanup();
  });

  it("409 — GAP-118 (Wave 2 prerequisite): a card voided off a superseded lease cannot be confirmed, even by a client still holding its stale id", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId);
    // No live write path voids a day_record yet — GAP-118's own fix is
    // Wave 2's build. This is the exact shape it will leave behind: a
    // stale future card, still `open` (voiding never touches `state`),
    // now voided.
    const dayRecordId = await ctx.createDayRecord(
      businessId,
      periodId,
      dailyLeaseId,
      vehicleId,
      driverId,
      "2026-07-15",
      { voided: true },
    );
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await confirmDay(token, {
      dailyLeaseId,
      businessDate: "2026-07-15",
      action: "paid_in_full",
    });
    expect(res.status).toBe(409);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "DAY_RECORD_VOIDED" });

    ctx.trackCreatedDayRecord(dayRecordId);
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

  describe("GET /api/day-record — unconfirmed, oldest first (Home item 4, UI §3.2)", () => {
    const today = businessToday();

    it("returns only open days strictly before today, oldest first, excluding paused-for-trip and today's own card, only for this business", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId, {
        periodStart: addDays(today, -60),
        periodEnd: addDays(today, 60),
      });
      const vehicleId = await ctx.createVehicle(businessId, { registration: "CAB-3333" });
      const driverId = await ctx.createDriver(businessId, { name: "Nimal" });
      const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId);

      const olderId = await ctx.createDayRecord(
        businessId,
        periodId,
        dailyLeaseId,
        vehicleId,
        driverId,
        addDays(today, -5),
      );
      const newerId = await ctx.createDayRecord(
        businessId,
        periodId,
        dailyLeaseId,
        vehicleId,
        driverId,
        addDays(today, -2),
      );
      // Excluded: already confirmed, paused for a trip, and today's own card
      // (a different section, §3.2 — the two must never interleave).
      await ctx.createDayRecord(
        businessId,
        periodId,
        dailyLeaseId,
        vehicleId,
        driverId,
        addDays(today, -4),
        {
          state: "ran_paid_full",
        },
      );
      await ctx.createDayRecord(
        businessId,
        periodId,
        dailyLeaseId,
        vehicleId,
        driverId,
        addDays(today, -3),
        {
          state: "paused_for_trip",
        },
      );
      await ctx.createDayRecord(businessId, periodId, dailyLeaseId, vehicleId, driverId, today);

      const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
      const otherPeriodId = await ctx.createOpenPeriod(otherBusinessId, {
        periodStart: addDays(today, -60),
        periodEnd: addDays(today, 60),
      });
      const otherVehicleId = await ctx.createVehicle(otherBusinessId);
      const otherDriverId = await ctx.createDriver(otherBusinessId);
      const otherDailyLeaseId = await ctx.createDailyLease(
        otherBusinessId,
        otherVehicleId,
        otherDriverId,
      );
      await ctx.createDayRecord(
        otherBusinessId,
        otherPeriodId,
        otherDailyLeaseId,
        otherVehicleId,
        otherDriverId,
        addDays(today, -5),
      );

      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await listUnconfirmedDayRecords(token);
      expect(res.status).toBe(200);
      const body: Array<{
        id: string;
        vehicleRegistration: string;
        driverName: string;
        businessDate: string;
        expectedMinor: string;
      }> = await res.json();
      expect(body.map((r) => r.id)).toEqual([olderId, newerId]);
      expect(body[0]).toMatchObject({
        vehicleRegistration: "CAB-3333",
        driverName: "Nimal",
        businessDate: addDays(today, -5),
        expectedMinor: "500000",
      });

      await ctx.cleanup();
    });

    it("GAP-118 (Wave 2 prerequisite) — a card voided off a superseded lease never appears, even though it is still `open`", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId, {
        periodStart: addDays(today, -60),
        periodEnd: addDays(today, 60),
      });
      const vehicleId = await ctx.createVehicle(businessId);
      const driverId = await ctx.createDriver(businessId);
      const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId);
      // No live write path voids a day_record yet — GAP-118's own fix is
      // Wave 2's build. `state` stays `open`; only voiding distinguishes
      // this from an ordinary card still genuinely needing confirmation.
      await ctx.createDayRecord(
        businessId,
        periodId,
        dailyLeaseId,
        vehicleId,
        driverId,
        addDays(today, -5),
        { voided: true },
      );

      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await listUnconfirmedDayRecords(token);
      expect(res.status).toBe(200);
      const body: Array<{ id: string }> = await res.json();
      expect(body).toEqual([]);

      await ctx.cleanup();
    });

    it("401 — missing Authorization header", async () => {
      const res = await request("/api/day-record");
      expect(res.status).toBe(401);
    });

    it("403 — a linked driver cannot read the unconfirmed-days list", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const driverId = await ctx.createDriver(businessId);
      const linked = await mintLinkedDriver(db, ctx, driverId);
      const token = await signAccessToken(linked.asgardeoSub);

      const res = await listUnconfirmedDayRecords(token);
      expect(res.status).toBe(403);

      await ctx.cleanup();
    });
  });
});
