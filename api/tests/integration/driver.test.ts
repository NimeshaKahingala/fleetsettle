import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { driver as driverTable } from "../../src/db/schema.js";
import { writer } from "../../src/db/client.js";
import { mintLinkedDriver, mintUser, signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

function postDriverLinkInvite(token: string, driverId: string) {
  return request(`/api/driver/${driverId}/link-invite`, { method: "POST", ...bearer(token) });
}

function postUnlinkDriver(token: string, driverId: string) {
  return request(`/api/driver/${driverId}/unlink`, { method: "POST", ...bearer(token) });
}

async function postDriver(token: string, body: unknown) {
  return request("/api/driver", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

async function getDriver(token: string, id: string) {
  return request(`/api/driver/${id}`, bearer(token));
}

async function listDrivers(token: string) {
  return request("/api/driver", bearer(token));
}

function getDriverHistory(token: string, id: string, from: string, to: string) {
  return request(`/api/driver/${id}/view?from=${from}&to=${to}`, bearer(token));
}

interface DriverHistoryBody {
  owedToUsMinor: string;
  owedByUsMinor: string;
  days: { businessDate: string; state: string }[];
  trips: { id: string; agreedAmountMinor: string }[];
  advances: { id: string; amountMinor: string }[];
  offsets: { id: string; amountMinor: string }[];
  deposit: { id: string; heldMinor: string } | null;
}

/**
 * F-1.6 / UC-04 test matrix. 401 and 403 are proven once here rather than
 * per route — all three routes share the same `authMiddleware` chain and
 * the same `manageEntities` capability check (already exhaustively covered
 * for the middleware itself in auth.test.ts).
 */
describe("driver CRUD (P2, F-1.6/UC-04)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — only name is required; fee and licence fields round-trip as wire strings", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postDriver(token, {
      name: "Sunil Perera",
      mobile: "0771234567",
      driverDayFeeMinor: "150000",
      driverTripFeeMinor: "50000",
      licenceExpiry: "2027-03-15",
    });
    expect(res.status).toBe(201);
    const body: { id: string } = await res.json();
    expect(body).toMatchObject({
      name: "Sunil Perera",
      mobile: "0771234567",
      driverDayFeeMinor: "150000",
      driverTripFeeMinor: "50000",
      licenceExpiry: "2027-03-15",
    });
    ctx.trackCreatedDriver(body.id);

    const getRes = await getDriver(token, body.id);
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toMatchObject({ id: body.id, name: "Sunil Perera" });

    await ctx.cleanup();
  });

  it("happy path — only name given, everything else comes back null (U-2)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postDriver(token, { name: "Kamal Silva" });
    expect(res.status).toBe(201);
    const body: { id: string } = await res.json();
    expect(body).toMatchObject({
      name: "Kamal Silva",
      mobile: null,
      driverDayFeeMinor: null,
      driverTripFeeMinor: null,
      licenceExpiry: null,
    });
    ctx.trackCreatedDriver(body.id);

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request("/api/driver", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "No Token Driver" }),
    });
    expect(res.status).toBe(401);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "MISSING_TOKEN" });
  });

  it("403 — a linked driver cannot add a driver (W-3: a driver enters nothing)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await postDriver(token, { name: "Someone New" });
    expect(res.status).toBe(403);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

    await ctx.cleanup();
  });

  it("404 — a driver belonging to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherDriverId = await ctx.createDriver(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await getDriver(token, otherDriverId);
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("list — returns only this business's drivers", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const ownDriverId = await ctx.createDriver(businessId, { name: "Own Driver" });
    await ctx.createDriver(otherBusinessId, { name: "Other Driver" });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await listDrivers(token);
    expect(res.status).toBe(200);
    const body: Array<{ id: string; name: string }> = await res.json();
    expect(body.map((d) => d.id)).toEqual([ownDriverId]);
    expect(body[0]).toMatchObject({ name: "Own Driver" });

    await ctx.cleanup();
  });
});

/**
 * A5/GAP-24/GAP-29: the staff-facing twin of `GET /api/driver-view`
 * (driver-view.test.ts) — same `getDriverOwnView` domain function, same
 * shape, keyed by an explicit `{id}` instead of the caller's own identity.
 * INV-25's own test class still applies here in reverse: a linked-driver
 * token must be refused outright, since this route is exactly the shape
 * INV-25 forbids on the driver's own route.
 */
describe("GET /api/driver/{id}/view (A5, staff-facing driver history)", () => {
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
      { state: "ran_paid_full", earnedMinor: 5_000n, expectedMinor: 5_000n },
    );
    await ctx.createDayRecord(
      businessId,
      periodId,
      dailyLeaseId,
      vehicleId,
      driverId,
      "2026-07-04",
      { state: "did_not_run", expectedMinor: 5_000n, lostReason: "public_holiday" },
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

    const token = await signAccessToken(owner.asgardeoSub);
    const res = await getDriverHistory(token, driverId, "2026-07-01", "2026-07-31");
    expect(res.status).toBe(200);
    const body: DriverHistoryBody = await res.json();

    expect(body.owedToUsMinor).toBe("15000");
    expect(body.owedByUsMinor).toBe("9000");

    const ranDay = body.days.find((d) => d.businessDate === "2026-07-03");
    expect(ranDay).toMatchObject({ state: "ran_paid_full" });
    const excusedDay = body.days.find((d) => d.businessDate === "2026-07-04");
    expect(excusedDay).toMatchObject({ state: "did_not_run" });

    expect(body.trips.map((t) => t.id)).toContain(tripId);
    expect(body.advances.map((a) => a.id)).toEqual([advanceId]);
    expect(body.offsets.map((o) => o.id)).toEqual([offsetId]);
    expect(body.deposit).toMatchObject({ id: depositId, heldMinor: "15000" });

    await ctx.cleanup();
  });

  it("404 — a driver belonging to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherDriverId = await ctx.createDriver(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await getDriverHistory(token, otherDriverId, "2026-07-01", "2026-07-31");
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request(
      `/api/driver/${crypto.randomUUID()}/view?from=2026-07-01&to=2026-07-31`,
    );
    expect(res.status).toBe(401);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "MISSING_TOKEN" });
  });

  it("403 — a linked driver cannot read another driver's history (INV-25's boundary in reverse)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const driverId = await ctx.createDriver(businessId);
    const otherDriverId = await ctx.createDriver(businessId, { name: "Someone Else" });
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const ownRes = await getDriverHistory(token, driverId, "2026-07-01", "2026-07-31");
    expect(ownRes.status).toBe(403);
    const ownBody: { code: string } = await ownRes.json();
    expect(ownBody).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

    const otherRes = await getDriverHistory(token, otherDriverId, "2026-07-01", "2026-07-31");
    expect(otherRes.status).toBe(403);

    await ctx.cleanup();
  });
});

/** F-1.8/W-42/A11 test matrix: happy path (code issued, manager-gated not owner-gated) · 404 · 403 for a linked driver. */
describe("POST /api/driver/{id}/link-invite (A11)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — a manager (not just an owner) can generate the code", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const driverId = await ctx.createDriver(businessId);
    ctx.trackCreatedDriverLinkInvites(driverId);
    const manager = await mintUser(db, ctx, businessId, "manager");
    const token = await signAccessToken(manager.asgardeoSub);

    const res = await postDriverLinkInvite(token, driverId);
    expect(res.status).toBe(201);
    const body: { code: string; expiresAt: string } = await res.json();
    expect(body.code).toBeTruthy();
    expect(body.expiresAt).toBeTruthy();

    await ctx.cleanup();
  });

  it("404 — a driver belonging to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherDriverId = await ctx.createDriver(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner_manager");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postDriverLinkInvite(token, otherDriverId);
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("403 — a linked driver cannot generate a link code", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await postDriverLinkInvite(token, driverId);
    expect(res.status).toBe(403);

    await ctx.cleanup();
  });
});

/** F-1.8's "Unlink" alternate: access ends, the driver's record and history are untouched. */
describe("POST /api/driver/{id}/unlink (A11)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — clears linked_user_id, leaves everything else", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const driverId = await ctx.createDriver(businessId, { name: "Sunil" });
    await mintLinkedDriver(db, ctx, driverId);
    const owner = await mintUser(db, ctx, businessId, "owner_manager");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postUnlinkDriver(token, driverId);
    expect(res.status).toBe(200);
    const body: { id: string; name: string } = await res.json();
    expect(body).toMatchObject({ id: driverId, name: "Sunil" });

    const rows = await db.select().from(driverTable).where(eq(driverTable.id, driverId));
    expect(rows[0]!.linkedUserId).toBeNull();

    await ctx.cleanup();
  });

  it("404 — a driver belonging to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherDriverId = await ctx.createDriver(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner_manager");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postUnlinkDriver(token, otherDriverId);
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });
});
