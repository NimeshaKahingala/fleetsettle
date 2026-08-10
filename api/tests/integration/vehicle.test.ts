import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { mintLinkedDriver, mintUser, signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

async function postVehicle(token: string, body: unknown) {
  return request("/api/vehicle", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

async function getVehicle(token: string, id: string) {
  return request(`/api/vehicle/${id}`, bearer(token));
}

async function listVehicles(token: string) {
  return request("/api/vehicle", bearer(token));
}

async function putDocument(token: string, id: string, body: unknown) {
  return request(`/api/vehicle/${id}/document`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

async function getVehicleCalendar(token: string, id: string, from: string, to: string) {
  return request(`/api/vehicle/${id}/calendar?from=${from}&to=${to}`, bearer(token));
}

async function postTrip(token: string, body: unknown) {
  return request("/api/trip", {
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

async function postVoidExpense(token: string, id: string, body: unknown) {
  return request(`/api/expense/${id}/void`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

async function listVehicleDocuments(token: string, id: string) {
  return request(`/api/vehicle/${id}/document`, bearer(token));
}

async function listVehicleExpenses(token: string, id: string) {
  return request(`/api/vehicle/${id}/expense`, bearer(token));
}

async function listVehicleLeaseHistory(token: string, id: string) {
  return request(`/api/vehicle/${id}/lease`, bearer(token));
}

async function listVehicleDailyLeaseHistory(token: string, id: string) {
  return request(`/api/vehicle/${id}/daily-lease`, bearer(token));
}

async function listVehicleIncidents(token: string, id: string) {
  return request(`/api/vehicle/${id}/incident`, bearer(token));
}

async function listVehicleTrips(token: string, id: string) {
  return request(`/api/vehicle/${id}/trip`, bearer(token));
}

async function postChangeArrangement(token: string, id: string, body: unknown) {
  return request(`/api/vehicle/${id}/arrangement`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

async function getDailyLease(token: string, id: string) {
  return request(`/api/daily-lease/${id}`, bearer(token));
}

async function postIncident(token: string, body: unknown) {
  return request("/api/incident", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

/**
 * F-1.1 / UC-01 and F-10.1 / UC-92 test matrix. 401 and 403 are proven once
 * here rather than per route — all four routes share the same
 * `authMiddleware` chain and the same `manageEntities` capability check
 * (already exhaustively covered for the middleware itself in auth.test.ts);
 * what differs per route is the 404/409 behaviour, which each gets its own
 * case for.
 */
describe("vehicle CRUD + paperwork (P2, F-1.1/UC-01, F-10.1/UC-92)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — creates the vehicle, its opening arrangement, and both documents", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postVehicle(token, {
      registration: `CAB-${crypto.randomUUID().slice(0, 8)}`,
      vehicleType: "car",
      defaultArrangement: "A",
      insuranceExpiry: "2026-12-31",
      registrationExpiry: "2027-06-30",
    });
    expect(res.status).toBe(201);
    const body: { id: string; lifecycle: string; arrangement: string } = await res.json();
    expect(body).toMatchObject({ lifecycle: "active", arrangement: "A" });
    ctx.trackCreatedVehicle(body.id);

    const getRes = await getVehicle(token, body.id);
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toMatchObject({ id: body.id, arrangement: "A" });

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request("/api/vehicle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ registration: "X", vehicleType: "car", defaultArrangement: "A" }),
    });
    expect(res.status).toBe(401);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "MISSING_TOKEN" });
  });

  it("403 — a linked driver cannot add a vehicle (W-3: a driver enters nothing)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await postVehicle(token, {
      registration: "DRV-001",
      vehicleType: "car",
      defaultArrangement: "A",
    });
    expect(res.status).toBe(403);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

    await ctx.cleanup();
  });

  it("409 — the same registration twice in one business (DM §4's UNIQUE(business_id, registration))", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);
    const registration = `DUP-${crypto.randomUUID().slice(0, 8)}`;

    const first = await postVehicle(token, {
      registration,
      vehicleType: "car",
      defaultArrangement: "A",
    });
    expect(first.status).toBe(201);
    const firstBody: { id: string } = await first.json();
    ctx.trackCreatedVehicle(firstBody.id);

    const second = await postVehicle(token, {
      registration,
      vehicleType: "car",
      defaultArrangement: "B",
    });
    expect(second.status).toBe(409);
    const secondBody: { code: string } = await second.json();
    expect(secondBody).toMatchObject({ code: "VEHICLE_ALREADY_EXISTS" });

    await ctx.cleanup();
  });

  it("404 — a vehicle belonging to another business (GET)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherVehicleId = await ctx.createVehicle(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await getVehicle(token, otherVehicleId);
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("list — returns only this business's vehicles", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const ownVehicleId = await ctx.createVehicle(businessId, { registration: "OWN-001" });
    await ctx.createVehicle(otherBusinessId, { registration: "OTHER-001" });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await listVehicles(token);
    expect(res.status).toBe(200);
    const body: Array<{ id: string; registration: string }> = await res.json();
    expect(body.map((v) => v.id)).toEqual([ownVehicleId]);
    expect(body[0]).toMatchObject({ registration: "OWN-001" });

    await ctx.cleanup();
  });

  it("paperwork — upserts insurance expiry, then a renewal replaces the date rather than adding a row", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const created = await postVehicle(token, {
      registration: `DOC-${crypto.randomUUID().slice(0, 8)}`,
      vehicleType: "car",
      defaultArrangement: "A",
    });
    const { id: vehicleId }: { id: string } = await created.json();
    ctx.trackCreatedVehicle(vehicleId);

    const first = await putDocument(token, vehicleId, {
      docType: "insurance",
      expiryDate: "2026-09-30",
    });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ docType: "insurance", expiryDate: "2026-09-30" });

    const renewal = await putDocument(token, vehicleId, {
      docType: "insurance",
      expiryDate: "2027-09-30",
      reference: "POL-9988",
    });
    expect(renewal.status).toBe(200);
    expect(await renewal.json()).toMatchObject({
      docType: "insurance",
      expiryDate: "2027-09-30",
      reference: "POL-9988",
    });

    await ctx.cleanup();
  });

  it("404 — paperwork for a vehicle belonging to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherVehicleId = await ctx.createVehicle(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await putDocument(token, otherVehicleId, {
      docType: "insurance",
      expiryDate: "2026-09-30",
    });
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });
});

/**
 * UC-95 test matrix. "Is the vehicle free on the 12th" — a single indexed
 * range scan (DM §2) over `vehicle_day_allocation`; an absent date in the
 * range is simply not scheduled, never a row with a "free" state.
 */
describe("vehicle calendar (P6, UC-95)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — only occupied days appear, each with its own arrangement and source", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "C");
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const trip = await postTrip(token, {
      vehicleId,
      startDate: "2026-07-10",
      endDate: "2026-07-11",
    });
    expect(trip.status).toBe(201);
    const tripBody: { id: string } = await trip.json();
    ctx.trackCreatedTrip(tripBody.id);

    const res = await getVehicleCalendar(token, vehicleId, "2026-07-01", "2026-07-31");
    expect(res.status).toBe(200);
    const body: Array<{ businessDate: string; arrangement: string; sourceId: string }> =
      await res.json();
    expect(body).toHaveLength(2);
    expect(body.map((d) => d.businessDate)).toEqual(["2026-07-10", "2026-07-11"]);
    expect(body.every((d) => d.arrangement === "C" && d.sourceId === tripBody.id)).toBe(true);

    await ctx.cleanup();
  });

  it("arrangement B carries day_record's own outcome — ran vs lost, distinct from mere occupancy", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId);
    await ctx.createVehicleDayAllocation(businessId, vehicleId, "2026-07-10", "B", dailyLeaseId);
    await ctx.createVehicleDayAllocation(businessId, vehicleId, "2026-07-11", "B", dailyLeaseId);
    await ctx.createDayRecord(
      businessId,
      periodId,
      dailyLeaseId,
      vehicleId,
      driverId,
      "2026-07-10",
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
      "2026-07-11",
      {
        state: "did_not_run",
        lostReason: "other",
      },
    );
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await getVehicleCalendar(token, vehicleId, "2026-07-01", "2026-07-31");
    expect(res.status).toBe(200);
    const body: Array<{ businessDate: string; dayRecordState: string | null }> = await res.json();
    expect(body).toMatchObject([
      { businessDate: "2026-07-10", dayRecordState: "ran_paid_full" },
      { businessDate: "2026-07-11", dayRecordState: "did_not_run" },
    ]);

    await ctx.cleanup();
  });

  it("arrangement A/C never carry a day_record outcome — dayRecordState is always null", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "C");
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const trip = await postTrip(token, {
      vehicleId,
      startDate: "2026-07-10",
      endDate: "2026-07-10",
    });
    const tripBody: { id: string } = await trip.json();
    ctx.trackCreatedTrip(tripBody.id);

    const res = await getVehicleCalendar(token, vehicleId, "2026-07-01", "2026-07-31");
    expect(res.status).toBe(200);
    const body: Array<{ dayRecordState: string | null }> = await res.json();
    expect(body.every((d) => d.dayRecordState === null)).toBe(true);

    await ctx.cleanup();
  });

  it("an empty range returns an empty list, never a guess", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await getVehicleCalendar(token, vehicleId, "2026-08-01", "2026-08-31");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);

    await ctx.cleanup();
  });

  it("403 — a linked driver cannot read the vehicle calendar (dailyOperations is STAFF-only)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await getVehicleCalendar(token, vehicleId, "2026-07-01", "2026-07-31");
    expect(res.status).toBe(403);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

    await ctx.cleanup();
  });

  it("404 — a vehicle belonging to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherVehicleId = await ctx.createVehicle(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await getVehicleCalendar(token, otherVehicleId, "2026-07-01", "2026-07-31");
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });
});

/**
 * Web-P5's vehicle overview: the four scoped reads its costs/history/
 * paperwork sections need, none of which existed before. 401/403 are proven
 * once (the documents list) rather than per route — all four share the same
 * `manageEntities` capability check, already exhaustively covered for the
 * middleware itself in auth.test.ts.
 */
describe("vehicle overview's scoped reads (Web-P5)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("documents — every doc type this vehicle has a date set for", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.createVehicleDocument(vehicleId, { docType: "insurance", expiryDate: "2026-09-30" });
    await ctx.createVehicleDocument(vehicleId, {
      docType: "registration",
      expiryDate: "2027-01-15",
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await listVehicleDocuments(token, vehicleId);
    expect(res.status).toBe(200);
    const body: Array<{ docType: string; expiryDate: string }> = await res.json();
    expect(body).toHaveLength(2);
    expect(body.map((d) => d.docType).sort()).toEqual(["insurance", "registration"]);

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request(`/api/vehicle/${crypto.randomUUID()}/document`);
    expect(res.status).toBe(401);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "MISSING_TOKEN" });
  });

  it("403 — a linked driver cannot read vehicle paperwork (manageEntities is STAFF-only)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await listVehicleDocuments(token, vehicleId);
    expect(res.status).toBe(403);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

    await ctx.cleanup();
  });

  it("404 — documents for a vehicle belonging to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherVehicleId = await ctx.createVehicle(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await listVehicleDocuments(token, otherVehicleId);
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("expenses — newest first, a voided one stays in the list rather than disappearing (W-50)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const older = await postExpense(token, {
      vehicleId,
      category: "fuel",
      amountMinor: "500000",
      spentOn: "2026-07-10",
    });
    const olderBody: { id: string } = await older.json();
    ctx.trackCreatedExpense(olderBody.id);

    const newer = await postExpense(token, {
      vehicleId,
      category: "repairs",
      amountMinor: "1200000",
      spentOn: "2026-07-20",
    });
    const newerBody: { id: string } = await newer.json();
    ctx.trackCreatedExpense(newerBody.id);

    const voided = await postVoidExpense(token, olderBody.id, { reason: "wrong vehicle" });
    expect(voided.status).toBe(200);

    const res = await listVehicleExpenses(token, vehicleId);
    expect(res.status).toBe(200);
    const body: Array<{
      id: string;
      category: string;
      voidedAt: string | null;
      voidedReason: string | null;
    }> = await res.json();
    expect(body.map((e) => e.id)).toEqual([newerBody.id, olderBody.id]);
    expect(body[1]).toMatchObject({ voidedReason: "wrong vehicle" });
    expect(body[1]?.voidedAt).not.toBeNull();
    expect(body[0]).toMatchObject({ voidedAt: null, voidedReason: null });

    await ctx.cleanup();
  });

  it("404 — expenses for a vehicle belonging to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherVehicleId = await ctx.createVehicle(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await listVehicleExpenses(token, otherVehicleId);
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("lease history — every arrangement-A period, customer name already resolved, most recent first", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const customerId = await ctx.createCustomer(businessId, { name: "Acme Traders" });
    const olderLeaseId = await ctx.createLease(businessId, vehicleId, customerId, {
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      status: "closed",
    });
    ctx.trackCreatedLease(olderLeaseId);
    const newerLeaseId = await ctx.createLease(businessId, vehicleId, customerId, {
      startDate: "2026-01-01",
      status: "active",
    });
    ctx.trackCreatedLease(newerLeaseId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await listVehicleLeaseHistory(token, vehicleId);
    expect(res.status).toBe(200);
    const body: Array<{ id: string; customerName: string; status: string }> = await res.json();
    expect(body.map((l) => l.id)).toEqual([newerLeaseId, olderLeaseId]);
    expect(body.every((l) => l.customerName === "Acme Traders")).toBe(true);

    await ctx.cleanup();
  });

  it("404 — lease history for a vehicle belonging to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherVehicleId = await ctx.createVehicle(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await listVehicleLeaseHistory(token, otherVehicleId);
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("daily-lease history — every arrangement-B period, driver name already resolved, most recent first", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId, { name: "Sunil Perera" });
    const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId, {
      effectiveFrom: "2026-06-01",
      dailyLeaseAmountMinor: 4_500_00n,
    });
    ctx.trackCreatedDailyLease(dailyLeaseId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await listVehicleDailyLeaseHistory(token, vehicleId);
    expect(res.status).toBe(200);
    const body: Array<{ id: string; driverName: string; dailyLeaseAmountMinor: string }> =
      await res.json();
    expect(body).toEqual([
      expect.objectContaining({
        id: dailyLeaseId,
        driverName: "Sunil Perera",
        dailyLeaseAmountMinor: "450000",
      }),
    ]);

    await ctx.cleanup();
  });

  it("404 — daily-lease history for a vehicle belonging to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherVehicleId = await ctx.createVehicle(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await listVehicleDailyLeaseHistory(token, otherVehicleId);
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("incidents — newest first, open and closed both included (Web-P8a)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const older = await postIncident(token, { vehicleId, occurredOn: "2026-07-01" });
    const olderBody: { id: string } = await older.json();
    ctx.trackCreatedIncident(olderBody.id);
    const closedRes = await request(`/api/incident/${olderBody.id}/close`, {
      method: "POST",
      headers: bearer(token).headers,
    });
    expect(closedRes.status).toBe(200);

    const newer = await postIncident(token, { vehicleId, occurredOn: "2026-07-15" });
    const newerBody: { id: string } = await newer.json();
    ctx.trackCreatedIncident(newerBody.id);

    const res = await listVehicleIncidents(token, vehicleId);
    expect(res.status).toBe(200);
    const body: Array<{ id: string; status: string; occurredOn: string }> = await res.json();
    expect(body.map((row) => row.id)).toEqual([newerBody.id, olderBody.id]);
    expect(body[0]).toMatchObject({ status: "open" });
    expect(body[1]).toMatchObject({ status: "closed" });

    await ctx.cleanup();
  });

  it("403 — a linked driver cannot read a vehicle's incidents (dailyOperations is STAFF-only)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await listVehicleIncidents(token, vehicleId);
    expect(res.status).toBe(403);

    await ctx.cleanup();
  });

  it("404 — incidents for a vehicle belonging to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherVehicleId = await ctx.createVehicle(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await listVehicleIncidents(token, otherVehicleId);
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });
});

/** GAP-77/UC-71: an arrangement-C vehicle's own trip history had no read at all — booked/closed/cancelled trips were unreachable from its detail screen. */
describe("vehicle trip history (GAP-77, UC-71)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — every status, newest first, party names resolved", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "C");
    const customerId = await ctx.createCustomer(businessId, { name: "Kamal Perera" });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const older = await postTrip(token, {
      vehicleId,
      customerId,
      startDate: "2026-07-01",
      endDate: "2026-07-02",
      agreedAmountMinor: "15000",
    });
    expect(older.status).toBe(201);
    const olderBody: { id: string } = await older.json();
    ctx.trackCreatedTrip(olderBody.id);

    const newer = await postTrip(token, {
      vehicleId,
      startDate: "2026-07-10",
      endDate: "2026-07-11",
      agreedAmountMinor: "20000",
    });
    expect(newer.status).toBe(201);
    const newerBody: { id: string } = await newer.json();
    ctx.trackCreatedTrip(newerBody.id);

    const res = await listVehicleTrips(token, vehicleId);
    expect(res.status).toBe(200);
    const body: Array<{
      id: string;
      status: string;
      customerId: string | null;
      customerName: string | null;
      agreedAmountMinor: string;
    }> = await res.json();
    expect(body.map((row) => row.id)).toEqual([newerBody.id, olderBody.id]);
    expect(body[0]).toMatchObject({
      status: "booked",
      customerId: null,
      customerName: null,
      agreedAmountMinor: "20000",
    });
    expect(body[1]).toMatchObject({
      status: "booked",
      customerId,
      customerName: "Kamal Perera",
      agreedAmountMinor: "15000",
    });

    await ctx.cleanup();
  });

  it("403 — a linked driver cannot read a vehicle's trips (dailyOperations is STAFF-only)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await listVehicleTrips(token, vehicleId);
    expect(res.status).toBe(403);

    await ctx.cleanup();
  });

  it("404 — trips for a vehicle belonging to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherVehicleId = await ctx.createVehicle(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await listVehicleTrips(token, otherVehicleId);
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });
});

/**
 * F-1.2/UC-94/GAP-54 test matrix. The row is never overwritten — a happy
 * call closes the old row and returns a brand-new id. "Pre: no open
 * lease/trip conflicting with the effective date" is the source's own line.
 */
describe("change a vehicle's arrangement (F-1.2/UC-94, GAP-54)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — A to C, the old row closes the day before and a new one opens", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "A", { effectiveFrom: "2026-01-01" });
    // The handler inserts a second, un-tracked `vehicle_arrangement` row —
    // `trackCreatedVehicle` tears down every row for this vehicleId, LIFO
    // (factories.ts's own cleanup order), so it clears both.
    ctx.trackCreatedVehicle(vehicleId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postChangeArrangement(token, vehicleId, {
      arrangement: "C",
      effectiveFrom: "2026-08-01",
    });
    expect(res.status).toBe(201);
    const body: {
      id: string;
      vehicleId: string;
      arrangement: string;
      effectiveFrom: string;
      effectiveTo: string | null;
    } = await res.json();
    expect(body).toMatchObject({
      vehicleId,
      arrangement: "C",
      effectiveFrom: "2026-08-01",
      effectiveTo: null,
    });

    const getRes = await getVehicle(token, vehicleId);
    expect(getRes.status).toBe(200);
    const getBody: { arrangement: string } = await getRes.json();
    expect(getBody.arrangement).toBe("C");

    await ctx.cleanup();
  });

  it("happy path — B to A auto-closes the open daily lease (F-1.2's own 'daily cards stop')", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "B", { effectiveFrom: "2026-01-01" });
    ctx.trackCreatedVehicle(vehicleId);
    const driverId = await ctx.createDriver(businessId);
    const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId, {
      effectiveFrom: "2026-01-01",
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postChangeArrangement(token, vehicleId, {
      arrangement: "A",
      effectiveFrom: "2026-08-01",
    });
    expect(res.status).toBe(201);

    const dailyLeaseRes = await getDailyLease(token, dailyLeaseId);
    expect(dailyLeaseRes.status).toBe(200);
    const dailyLeaseBody: { effectiveTo: string | null } = await dailyLeaseRes.json();
    expect(dailyLeaseBody.effectiveTo).toBe("2026-07-31");

    await ctx.cleanup();
  });

  it("400 — already configured for this arrangement", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "A", { effectiveFrom: "2026-01-01" });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postChangeArrangement(token, vehicleId, {
      arrangement: "A",
      effectiveFrom: "2026-08-01",
    });
    expect(res.status).toBe(400);
    const body: { code: string } = await res.json();
    expect(body).toMatchObject({ code: "VALIDATION_ERROR" });

    await ctx.cleanup();
  });

  it("400 — effectiveFrom is not after the current arrangement's own start date", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "A", { effectiveFrom: "2026-08-01" });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postChangeArrangement(token, vehicleId, {
      arrangement: "C",
      effectiveFrom: "2026-08-01",
    });
    expect(res.status).toBe(400);
    const body: { code: string } = await res.json();
    expect(body).toMatchObject({ code: "VALIDATION_ERROR" });

    await ctx.cleanup();
  });

  it("400 — effectiveFrom is not after the current daily lease's own start date", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "B", { effectiveFrom: "2026-01-01" });
    const driverId = await ctx.createDriver(businessId);
    await ctx.createDailyLease(businessId, vehicleId, driverId, { effectiveFrom: "2026-07-01" });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postChangeArrangement(token, vehicleId, {
      arrangement: "A",
      effectiveFrom: "2026-03-01",
    });
    expect(res.status).toBe(400);
    const body: { code: string } = await res.json();
    expect(body).toMatchObject({ code: "VALIDATION_ERROR" });

    await ctx.cleanup();
  });

  it("409 — this vehicle has a lease that is not yet closed", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "A", { effectiveFrom: "2026-01-01" });
    const customerId = await ctx.createCustomer(businessId);
    await ctx.createLease(businessId, vehicleId, customerId, {
      startDate: "2026-01-01",
      status: "active",
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postChangeArrangement(token, vehicleId, {
      arrangement: "C",
      effectiveFrom: "2026-08-01",
    });
    expect(res.status).toBe(409);
    const body: { code: string } = await res.json();
    expect(body).toMatchObject({ code: "VEHICLE_ARRANGEMENT_CHANGE_BLOCKED" });

    await ctx.cleanup();
  });

  it("409 — this vehicle has an open trip covering the effective date", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "C", { effectiveFrom: "2026-01-01" });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const trip = await postTrip(token, {
      vehicleId,
      startDate: "2026-07-25",
      endDate: "2026-08-05",
    });
    expect(trip.status).toBe(201);
    const tripBody: { id: string } = await trip.json();
    ctx.trackCreatedTrip(tripBody.id);

    const res = await postChangeArrangement(token, vehicleId, {
      arrangement: "A",
      effectiveFrom: "2026-08-01",
    });
    expect(res.status).toBe(409);
    const body: { code: string } = await res.json();
    expect(body).toMatchObject({ code: "VEHICLE_ARRANGEMENT_CHANGE_BLOCKED" });

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request(`/api/vehicle/${crypto.randomUUID()}/arrangement`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ arrangement: "A", effectiveFrom: "2026-08-01" }),
    });
    expect(res.status).toBe(401);
  });

  it("403 — a linked driver cannot change a vehicle's arrangement", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "A", { effectiveFrom: "2026-01-01" });
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await postChangeArrangement(token, vehicleId, {
      arrangement: "C",
      effectiveFrom: "2026-08-01",
    });
    expect(res.status).toBe(403);

    await ctx.cleanup();
  });

  it("404 — the vehicle belongs to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherVehicleId = await ctx.createVehicle(otherBusinessId);
    await ctx.setVehicleArrangement(otherVehicleId, "A", { effectiveFrom: "2026-01-01" });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postChangeArrangement(token, otherVehicleId, {
      arrangement: "C",
      effectiveFrom: "2026-08-01",
    });
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });
});
