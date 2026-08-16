import { newId } from "@fleetsettle/shared";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { dayRecord, leaseDayException, vehicleDayAllocation } from "../../src/db/schema.js";
import { mintLinkedDriver, mintUser, signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

async function postException(token: string, dailyLeaseId: string, body: unknown) {
  return request(`/api/daily-lease/${dailyLeaseId}/exception`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

async function confirmDay(token: string, body: unknown) {
  return request("/api/day-record/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

async function listExceptions(token: string, dailyLeaseId: string) {
  return request(`/api/daily-lease/${dailyLeaseId}/exception`, bearer(token));
}

async function voidException(
  token: string,
  dailyLeaseId: string,
  exceptionId: string,
  body: unknown,
) {
  return request(`/api/daily-lease/${dailyLeaseId}/exception/${exceptionId}/void`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

/**
 * F-1.7/GAP-20 test matrix. An excepted date behaves exactly like an
 * off-pattern one — no `day_record` ever generated for it (INV-37's sibling
 * reasoning: this table's whole job is keeping the lost-day denominator
 * honest). Migration 0027's partial unique index is what makes "un-skip,
 * then skip the same date again for a different reason" a real correction
 * rather than a bare constraint violation — the un-skip-then-reskip test
 * below is that migration's own regression proof.
 */
describe("skippable individual daily-lease days (P2/P13, F-1.7/GAP-20)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — skip a date with no card generated yet", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postException(token, dailyLeaseId, {
      exceptionDate: "2026-07-15",
      reason: "Driver on leave",
    });
    expect(res.status).toBe(201);
    const body: { id: string; dailyLeaseId: string; exceptionDate: string; reason: string | null } =
      await res.json();
    expect(body).toMatchObject({
      dailyLeaseId,
      exceptionDate: "2026-07-15",
      reason: "Driver on leave",
    });
    ctx.trackCreatedLeaseDayException(body.id);

    const listRes = await listExceptions(token, dailyLeaseId);
    expect(listRes.status).toBe(200);
    const list: { id: string }[] = await listRes.json();
    expect(list.map((e) => e.id)).toEqual([body.id]);

    await ctx.cleanup();
  });

  it("happy path — reason is optional", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postException(token, dailyLeaseId, { exceptionDate: "2026-07-15" });
    expect(res.status).toBe(201);
    const body: { id: string; reason: string | null } = await res.json();
    expect(body.reason).toBeNull();
    ctx.trackCreatedLeaseDayException(body.id);

    await ctx.cleanup();
  });

  it("GAP-20's own correctness case — skipping a date that already has an open card voids the card and its allocation in the same transaction", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const dayRecordId = await ctx.createDayRecord(
      businessId,
      periodId,
      dailyLeaseId,
      vehicleId,
      driverId,
      "2026-07-15",
    );
    const allocationId = await ctx.createVehicleDayAllocation(
      businessId,
      vehicleId,
      "2026-07-15",
      "B",
      dailyLeaseId,
    );

    const res = await postException(token, dailyLeaseId, { exceptionDate: "2026-07-15" });
    expect(res.status).toBe(201);
    const body: { id: string } = await res.json();
    ctx.trackCreatedLeaseDayException(body.id);

    const [record] = await db
      .select({ voidedAt: dayRecord.voidedAt })
      .from(dayRecord)
      .where(eq(dayRecord.id, dayRecordId));
    expect(record?.voidedAt).not.toBeNull();

    const [allocation] = await db
      .select({ voidedAt: vehicleDayAllocation.voidedAt })
      .from(vehicleDayAllocation)
      .where(eq(vehicleDayAllocation.id, allocationId));
    expect(allocation?.voidedAt).not.toBeNull();

    await ctx.cleanup();
  });

  it("regression — racing an exception against a concurrent confirm never leaves a day both confirmed and excepted", async () => {
    // The bug: createLeaseDayException used to read the open card once,
    // before its own transaction opened, then trust that stale read inside
    // it. A concurrent confirmDay landing in between made the void a no-op
    // (state no longer 'open') while the exception still got inserted — a
    // day that is simultaneously confirmed and marked skipped, corrupting
    // the lost-day denominator. Both real requests race for the same row;
    // whichever's UPDATE commits first is authoritative for the other, so
    // the bad combination must never survive regardless of which one wins.
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId, {
      dailyLeaseAmountMinor: 5_000_00n,
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const dayRecordId = await ctx.createDayRecord(
      businessId,
      periodId,
      dailyLeaseId,
      vehicleId,
      driverId,
      "2026-07-15",
    );
    // Whichever side of the race confirmDay wins, it writes a real
    // obligation (and, paid_in_full, a payment) that the bare
    // createDayRecord() teardown above doesn't know about — sweep them too,
    // or a winning confirm leaves rows the driver/business delete below
    // can't get past.
    ctx.trackCreatedDayRecord(dayRecordId);

    const [exceptionRes, confirmRes] = await Promise.all([
      postException(token, dailyLeaseId, { exceptionDate: "2026-07-15" }),
      confirmDay(token, { dailyLeaseId, businessDate: "2026-07-15", action: "paid_in_full" }),
    ]);
    if (exceptionRes.status === 201) {
      const body: { id: string } = await exceptionRes.json();
      ctx.trackCreatedLeaseDayException(body.id);
    }
    expect(confirmRes.status).not.toBe(500);

    const [record] = await db
      .select({ state: dayRecord.state, voidedAt: dayRecord.voidedAt })
      .from(dayRecord)
      .where(
        and(eq(dayRecord.dailyLeaseId, dailyLeaseId), eq(dayRecord.businessDate, "2026-07-15")),
      );
    const isConfirmed = record !== undefined && record.voidedAt === null && record.state !== "open";

    const liveExceptions = await db
      .select({ id: leaseDayException.id })
      .from(leaseDayException)
      .where(
        and(
          eq(leaseDayException.dailyLeaseId, dailyLeaseId),
          eq(leaseDayException.exceptionDate, "2026-07-15"),
          isNull(leaseDayException.voidedAt),
        ),
      );

    expect(isConfirmed && liveExceptions.length > 0).toBe(false);

    await ctx.cleanup();
  });

  it("409 LEASE_DAY_ALREADY_CONFIRMED — a day already confirmed cannot be skipped retroactively", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    await ctx.createDayRecord(
      businessId,
      periodId,
      dailyLeaseId,
      vehicleId,
      driverId,
      "2026-07-15",
      {
        state: "ran_paid_full",
        earnedMinor: 5_000_00n,
      },
    );

    const res = await postException(token, dailyLeaseId, { exceptionDate: "2026-07-15" });
    expect(res.status).toBe(409);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "LEASE_DAY_ALREADY_CONFIRMED" });

    await ctx.cleanup();
  });

  it("409 LEASE_DAY_ALREADY_EXCEPTED — the same date cannot be skipped twice while the first skip is live", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const first = await postException(token, dailyLeaseId, { exceptionDate: "2026-07-15" });
    expect(first.status).toBe(201);
    const firstBody: { id: string } = await first.json();
    ctx.trackCreatedLeaseDayException(firstBody.id);

    const second = await postException(token, dailyLeaseId, { exceptionDate: "2026-07-15" });
    expect(second.status).toBe(409);
    const responseBody: { code: string } = await second.json();
    expect(responseBody).toMatchObject({ code: "LEASE_DAY_ALREADY_EXCEPTED" });

    await ctx.cleanup();
  });

  it("409 — a closed accounting period rejects the write, from the trigger, not a pre-check (INV-10) — only reachable when there's an open card to void", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    await ctx.createDayRecord(
      businessId,
      periodId,
      dailyLeaseId,
      vehicleId,
      driverId,
      "2026-07-15",
    );
    await ctx.closePeriod(periodId);

    const res = await postException(token, dailyLeaseId, { exceptionDate: "2026-07-15" });
    expect(res.status).toBe(409);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "PERIOD_CLOSED" });

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId);

    const res = await request(`/api/daily-lease/${dailyLeaseId}/exception`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exceptionDate: "2026-07-15" }),
    });
    expect(res.status).toBe(401);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "MISSING_TOKEN" });

    await ctx.cleanup();
  });

  it("403 — a linked driver cannot manage exceptions", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await postException(token, dailyLeaseId, { exceptionDate: "2026-07-15" });
    expect(res.status).toBe(403);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

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

    const res = await postException(token, otherDailyLeaseId, { exceptionDate: "2026-07-15" });
    expect(res.status).toBe(404);

    const listRes = await listExceptions(token, otherDailyLeaseId);
    expect(listRes.status).toBe(404);

    await ctx.cleanup();
  });

  describe("un-skip (void)", () => {
    it("happy path — un-skipping voids the exception, never deletes it (W-58)", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const vehicleId = await ctx.createVehicle(businessId);
      const driverId = await ctx.createDriver(businessId);
      const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const created = await postException(token, dailyLeaseId, { exceptionDate: "2026-07-15" });
      const createdBody: { id: string } = await created.json();
      ctx.trackCreatedLeaseDayException(createdBody.id);

      const res = await voidException(token, dailyLeaseId, createdBody.id, {
        reason: "Driver's leave was cancelled",
      });
      expect(res.status).toBe(200);
      const body: { id: string; voidedAt: string } = await res.json();
      expect(body.id).toBe(createdBody.id);
      expect(body.voidedAt).toBeTruthy();

      // Voided, not gone — still visible with a reason on it, just excluded
      // from the "currently skipped" list.
      const listRes = await listExceptions(token, dailyLeaseId);
      const list: { id: string }[] = await listRes.json();
      expect(list).toEqual([]);

      await ctx.cleanup();
    });

    it("migration 0027's own regression proof — un-skip, then skip the same date again for a different reason, succeeds", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const vehicleId = await ctx.createVehicle(businessId);
      const driverId = await ctx.createDriver(businessId);
      const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const first = await postException(token, dailyLeaseId, {
        exceptionDate: "2026-07-15",
        reason: "Driver on leave",
      });
      const firstBody: { id: string } = await first.json();
      ctx.trackCreatedLeaseDayException(firstBody.id);

      const undone = await voidException(token, dailyLeaseId, firstBody.id, {
        reason: "Leave was cancelled",
      });
      expect(undone.status).toBe(200);

      const second = await postException(token, dailyLeaseId, {
        exceptionDate: "2026-07-15",
        reason: "Vehicle in for service instead",
      });
      expect(second.status).toBe(201);
      const secondBody: { id: string; reason: string | null } = await second.json();
      expect(secondBody.reason).toBe("Vehicle in for service instead");
      ctx.trackCreatedLeaseDayException(secondBody.id);

      await ctx.cleanup();
    });

    it("409 LEASE_DAY_EXCEPTION_ALREADY_VOIDED", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const vehicleId = await ctx.createVehicle(businessId);
      const driverId = await ctx.createDriver(businessId);
      const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const created = await postException(token, dailyLeaseId, { exceptionDate: "2026-07-15" });
      const createdBody: { id: string } = await created.json();
      ctx.trackCreatedLeaseDayException(createdBody.id);

      const firstVoid = await voidException(token, dailyLeaseId, createdBody.id, {
        reason: "Cancelled",
      });
      expect(firstVoid.status).toBe(200);

      const secondVoid = await voidException(token, dailyLeaseId, createdBody.id, {
        reason: "Cancelled again",
      });
      expect(secondVoid.status).toBe(409);
      const responseBody: { code: string } = await secondVoid.json();
      expect(responseBody).toMatchObject({ code: "LEASE_DAY_EXCEPTION_ALREADY_VOIDED" });

      await ctx.cleanup();
    });

    it("404 — the exception belongs to another daily lease", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const vehicleId = await ctx.createVehicle(businessId);
      // An explicit registration — createVehicle()'s own default truncates
      // the id to 8 hex chars, and two UUIDv7s minted a moment apart can
      // share that prefix (time-ordered ids, CLAUDE.md → Process), which
      // once produced a real UNIQUE collision on this exact line.
      const otherVehicleId = await ctx.createVehicle(businessId, { registration: "TEST-OTHER" });
      const driverId = await ctx.createDriver(businessId);
      const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId);
      // A distinct vehicle, not just a later effectiveFrom — two open-ended
      // daily leases on the same vehicle would otherwise collide on the
      // DM §7 exclusion constraint regardless of start date.
      const otherDailyLeaseId = await ctx.createDailyLease(businessId, otherVehicleId, driverId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const created = await postException(token, dailyLeaseId, { exceptionDate: "2026-07-15" });
      const createdBody: { id: string } = await created.json();
      ctx.trackCreatedLeaseDayException(createdBody.id);

      const res = await voidException(token, otherDailyLeaseId, createdBody.id, {
        reason: "Wrong lease",
      });
      expect(res.status).toBe(404);

      await ctx.cleanup();
    });

    it("404 — the exception belongs to another business", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const vehicleId = await ctx.createVehicle(businessId);
      const driverId = await ctx.createDriver(businessId);
      const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const created = await postException(token, dailyLeaseId, { exceptionDate: "2026-07-15" });
      const createdBody: { id: string } = await created.json();
      ctx.trackCreatedLeaseDayException(createdBody.id);

      const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
      const otherOwner = await mintUser(db, ctx, otherBusinessId, "owner");
      const otherToken = await signAccessToken(otherOwner.asgardeoSub);

      const res = await voidException(otherToken, dailyLeaseId, createdBody.id, {
        reason: "Not yours",
      });
      expect(res.status).toBe(404);

      await ctx.cleanup();
    });

    it("401 — missing Authorization header", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const vehicleId = await ctx.createVehicle(businessId);
      const driverId = await ctx.createDriver(businessId);
      const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId);

      const res = await request(`/api/daily-lease/${dailyLeaseId}/exception/${newId()}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "x" }),
      });
      expect(res.status).toBe(401);

      await ctx.cleanup();
    });

    it("403 — a linked driver cannot un-skip", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const vehicleId = await ctx.createVehicle(businessId);
      const driverId = await ctx.createDriver(businessId);
      const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const ownerToken = await signAccessToken(owner.asgardeoSub);

      const created = await postException(ownerToken, dailyLeaseId, {
        exceptionDate: "2026-07-15",
      });
      const createdBody: { id: string } = await created.json();
      ctx.trackCreatedLeaseDayException(createdBody.id);

      const linked = await mintLinkedDriver(db, ctx, driverId);
      const linkedToken = await signAccessToken(linked.asgardeoSub);

      const res = await voidException(linkedToken, dailyLeaseId, createdBody.id, { reason: "x" });
      expect(res.status).toBe(403);
      const responseBody: { code: string } = await res.json();
      expect(responseBody).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

      await ctx.cleanup();
    });
  });
});
