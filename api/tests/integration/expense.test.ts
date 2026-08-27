import { addDays, businessToday } from "@fleetsettle/shared";
import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { findOdometerReadingForBusiness } from "../../src/queries/odometer-reading.js";
import { mintLinkedDriver, mintUser, signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

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

async function getExpenses(token: string, query = "") {
  return request(`/api/expense${query}`, bearer(token));
}

async function getBorneByDefault(token: string, query: string) {
  return request(`/api/expense/borne-by-default${query}`, bearer(token));
}

async function getPrefillVehicle(token: string) {
  return request("/api/expense/prefill-vehicle", bearer(token));
}

/**
 * F-3.1/F-3.2/F-3.3, UC-60/UC-66. §6.7's default-owner matrix, `borne_by`/
 * `paid_by` as two separate fields (W-48/INV-27), and the overhead case
 * (`vehicleId` absent, INV-24).
 */
describe("record an expense (P4, F-3.1/F-3.2/F-3.3)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — an overhead cost with no vehicle defaults borne_by to us (UC-66, INV-24)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postExpense(token, {
      category: "office",
      amountMinor: "50000",
      spentOn: "2026-07-15",
    });
    expect(res.status).toBe(201);
    const body: { id: string } = await res.json();
    expect(body).toMatchObject({
      vehicleId: null,
      category: "office",
      amountMinor: "50000",
      borneBy: "us",
      paidByUserId: owner.userId,
    });
    ctx.trackCreatedExpense(body.id);

    await ctx.cleanup();
  });

  it("§6.7's matrix — fuel on a daily lease (arrangement B) defaults to the current driver", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "B");
    const driverId = await ctx.createDriver(businessId);
    await ctx.createDailyLease(businessId, vehicleId, driverId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postExpense(token, {
      vehicleId,
      category: "fuel",
      amountMinor: "300000",
      spentOn: "2026-07-15",
    });
    expect(res.status).toBe(201);
    const body: { id: string; borneBy: string; borneByDriverId: string } = await res.json();
    expect(body.borneBy).toBe("driver");
    expect(body.borneByDriverId).toBe(driverId);
    ctx.trackCreatedExpense(body.id);

    await ctx.cleanup();
  });

  it("§6.7's matrix — tolls on a lease (arrangement A) default to the current customer", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "A");
    const customerId = await ctx.createCustomer(businessId);
    await ctx.createLease(businessId, vehicleId, customerId, { status: "active" });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postExpense(token, {
      vehicleId,
      category: "tolls",
      amountMinor: "5000",
      spentOn: "2026-07-15",
    });
    expect(res.status).toBe(201);
    const body: { id: string; borneBy: string; borneByCustomerId: string } = await res.json();
    expect(body.borneBy).toBe("customer");
    expect(body.borneByCustomerId).toBe(customerId);
    ctx.trackCreatedExpense(body.id);

    await ctx.cleanup();
  });

  it("§6.7's matrix — tolls flip to us on a charter (arrangement C), the flip the matrix exists to prove", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "C");
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postExpense(token, {
      vehicleId,
      category: "tolls",
      amountMinor: "5000",
      spentOn: "2026-07-15",
    });
    expect(res.status).toBe(201);
    const body: { id: string; borneBy: string } = await res.json();
    expect(body.borneBy).toBe("us");
    ctx.trackCreatedExpense(body.id);

    await ctx.cleanup();
  });

  it("GAP-56 — a cost dated before any lease covered the vehicle defaults to us, even though a lease is active by the time it's entered", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "A");
    const customerId = await ctx.createCustomer(businessId);
    // The lease starts 1 August — after the expense's own spentOn date, U-8's
    // ordinary catch-up case. Before GAP-56, `findActiveLeaseForVehicle`
    // matched on `status = 'active'` alone with no date filter, so this
    // lease — wholly in the future relative to spentOn — would still have
    // been picked up and the toll wrongly assigned to this customer.
    await ctx.createLease(businessId, vehicleId, customerId, {
      startDate: "2026-08-01",
      status: "active",
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postExpense(token, {
      vehicleId,
      category: "tolls",
      amountMinor: "5000",
      spentOn: "2026-07-01",
    });
    expect(res.status).toBe(201);
    const body: { id: string; borneBy: string; borneByCustomerId: string | null } =
      await res.json();
    expect(body.borneBy).toBe("us");
    expect(body.borneByCustomerId).toBeNull();
    ctx.trackCreatedExpense(body.id);

    await ctx.cleanup();
  });

  it("GAP-56 — a cost dated during a since-closed lease resolves against that lease's customer, not the one who replaced them", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "A");
    const firstCustomerId = await ctx.createCustomer(businessId);
    const secondCustomerId = await ctx.createCustomer(businessId);
    // First customer's lease ran through June, closed 30 June. Second
    // customer's lease started 1 July and is the one active today. An
    // expense dated inside the first lease's own window, entered after the
    // second lease started, must still land on the first customer — not
    // whoever holds the vehicle *now*.
    await ctx.createLease(businessId, vehicleId, firstCustomerId, {
      startDate: "2026-06-01",
      endDate: "2026-06-30",
      status: "closed",
    });
    await ctx.createLease(businessId, vehicleId, secondCustomerId, {
      startDate: "2026-07-01",
      status: "active",
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postExpense(token, {
      vehicleId,
      category: "fines",
      amountMinor: "7500",
      spentOn: "2026-06-15",
    });
    expect(res.status).toBe(201);
    const body: { id: string; borneBy: string; borneByCustomerId: string } = await res.json();
    expect(body.borneBy).toBe("customer");
    expect(body.borneByCustomerId).toBe(firstCustomerId);
    ctx.trackCreatedExpense(body.id);

    await ctx.cleanup();
  });

  it("GAP-56 — a cost dated before a daily lease's effective date defaults to us, arrangement B's equivalent of the lease case", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "B");
    const driverId = await ctx.createDriver(businessId);
    await ctx.createDailyLease(businessId, vehicleId, driverId, { effectiveFrom: "2026-08-01" });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postExpense(token, {
      vehicleId,
      category: "fuel",
      amountMinor: "300000",
      spentOn: "2026-07-15",
    });
    expect(res.status).toBe(201);
    const body: { id: string; borneBy: string; borneByDriverId: string | null } = await res.json();
    expect(body.borneBy).toBe("us");
    expect(body.borneByDriverId).toBeNull();
    ctx.trackCreatedExpense(body.id);

    await ctx.cleanup();
  });

  it("GAP-56 — the vehicle's arrangement itself is resolved as of spentOn, not today", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    // Arrangement B (fuel borne by the driver) through June, then switched
    // to C (fuel borne by us) from 1 July. A fuel fill dated inside the
    // arrangement-B window, entered after the switch to C, must still
    // resolve against B — the arrangement in force on the day the fuel was
    // actually bought, not the one in force today.
    await ctx.setVehicleArrangement(vehicleId, "B", {
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-06-30",
    });
    await ctx.setVehicleArrangement(vehicleId, "C", { effectiveFrom: "2026-07-01" });
    const driverId = await ctx.createDriver(businessId);
    await ctx.createDailyLease(businessId, vehicleId, driverId, {
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-06-30",
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postExpense(token, {
      vehicleId,
      category: "fuel",
      amountMinor: "300000",
      spentOn: "2026-06-15",
    });
    expect(res.status).toBe(201);
    const body: { id: string; borneBy: string; borneByDriverId: string } = await res.json();
    expect(body.borneBy).toBe("driver");
    expect(body.borneByDriverId).toBe(driverId);
    ctx.trackCreatedExpense(body.id);

    await ctx.cleanup();
  });

  it("400 — borneBy 'driver' with no borneByDriverId (W-48/INV-27)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postExpense(token, {
      category: "fuel",
      amountMinor: "50000",
      spentOn: "2026-07-15",
      borneBy: "driver",
    });
    expect(res.status).toBe(400);

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await postExpense("", {
      category: "fuel",
      amountMinor: "1",
      spentOn: "2026-07-15",
    });
    expect(res.status).toBe(401);
  });

  it("403 — a linked driver cannot record an expense", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await postExpense(token, {
      category: "fuel",
      amountMinor: "50000",
      spentOn: "2026-07-15",
    });
    expect(res.status).toBe(403);

    await ctx.cleanup();
  });

  it("404 — the vehicle belongs to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherVehicleId = await ctx.createVehicle(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postExpense(token, {
      vehicleId: otherVehicleId,
      category: "fuel",
      amountMinor: "50000",
      spentOn: "2026-07-15",
    });
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("409 — a closed accounting period rejects the write", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    await ctx.closePeriod(periodId);

    const res = await postExpense(token, {
      category: "office",
      amountMinor: "50000",
      spentOn: "2026-07-15",
    });
    expect(res.status).toBe(409);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "PERIOD_CLOSED" });

    await ctx.cleanup();
  });
});

/**
 * GAP-30/F-3.3: a fuel fill's own odometer reading, written as a real
 * `odometer_reading` row in the same transaction — `queries/reports.ts`'s
 * `listUsBoughtFuelFills` (UC-72) is what dereferences it into a km/l figure.
 */
describe("a fuel fill writes its own odometer reading (GAP-30)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — odometerReadingKm + odometerSource write a real odometer_reading row", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postExpense(token, {
      vehicleId,
      category: "fuel",
      amountMinor: "500000",
      spentOn: "2026-07-15",
      litres: 20,
      odometerReadingKm: 45000,
      odometerSource: "reported",
    });
    expect(res.status).toBe(201);
    const body: { id: string; odometerReadingId: string | null } = await res.json();
    expect(body.odometerReadingId).toBeTruthy();
    ctx.trackCreatedExpense(body.id, body.odometerReadingId);

    const reading = await findOdometerReadingForBusiness(db, businessId, body.odometerReadingId!);
    expect(reading).toMatchObject({ readingKm: 45000, readOn: "2026-07-15" });

    await ctx.cleanup();
  });

  it("no odometer fields given — odometerReadingId stays null, exactly as before", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postExpense(token, {
      vehicleId,
      category: "fuel",
      amountMinor: "500000",
      spentOn: "2026-07-15",
    });
    expect(res.status).toBe(201);
    const body: { id: string; odometerReadingId: string | null } = await res.json();
    expect(body.odometerReadingId).toBeNull();
    ctx.trackCreatedExpense(body.id);

    await ctx.cleanup();
  });

  it("400 — odometerReadingKm without odometerSource", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postExpense(token, {
      vehicleId,
      category: "fuel",
      amountMinor: "500000",
      spentOn: "2026-07-15",
      odometerReadingKm: 45000,
    });
    expect(res.status).toBe(400);

    await ctx.cleanup();
  });

  it("400 — odometerReadingKm given with no vehicleId (no vehicle for the reading to belong to)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postExpense(token, {
      category: "fuel",
      amountMinor: "500000",
      spentOn: "2026-07-15",
      odometerReadingKm: 45000,
      odometerSource: "reported",
    });
    expect(res.status).toBe(400);

    await ctx.cleanup();
  });

  it("UC-72 end to end — the written reading is what the fuel-efficiency report reads back", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const first = await postExpense(token, {
      vehicleId,
      category: "fuel",
      amountMinor: "500000",
      spentOn: "2026-07-05",
      litres: 20,
      odometerReadingKm: 1000,
      odometerSource: "reported",
    });
    const firstBody: { id: string; odometerReadingId: string | null } = await first.json();
    ctx.trackCreatedExpense(firstBody.id, firstBody.odometerReadingId);

    const second = await postExpense(token, {
      vehicleId,
      category: "fuel",
      amountMinor: "600000",
      spentOn: "2026-07-15",
      litres: 25,
      odometerReadingKm: 1300,
      odometerSource: "reported",
    });
    const secondBody: { id: string; odometerReadingId: string | null } = await second.json();
    ctx.trackCreatedExpense(secondBody.id, secondBody.odometerReadingId);

    const res = await request(
      `/api/reports/fuel-efficiency?vehicleId=${vehicleId}&from=2026-07-01&to=2026-07-31`,
      bearer(token),
    );
    expect(res.status).toBe(200);
    const body: { points: { spentOn: string; kmPerLitre: number | null }[] } = await res.json();
    expect(body.points).toHaveLength(2);
    expect(body.points[0]?.kmPerLitre).toBeNull();
    expect(body.points[1]?.kmPerLitre).toBe(12);

    await ctx.cleanup();
  });
});

/**
 * F-8.5/UC-96/W-50. "Wrong vehicle... fuel logged against the wrong trip" —
 * voided, never deleted, and a fresh one recorded through the create
 * endpoint above.
 */
describe("void an expense (P9, F-8.5/UC-96)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — voids the row and returns voidedAt", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const created = await postExpense(token, {
      category: "fuel",
      amountMinor: "50000",
      spentOn: "2026-07-15",
    });
    const createdBody: { id: string } = await created.json();
    ctx.trackCreatedExpense(createdBody.id);

    const res = await postVoidExpense(token, createdBody.id, { reason: "wrong vehicle" });
    expect(res.status).toBe(200);
    const body: { id: string; voidedAt: string } = await res.json();
    expect(body.id).toBe(createdBody.id);
    expect(body.voidedAt).toBeTruthy();

    await ctx.cleanup();
  });

  it("409 — an already-voided expense cannot be voided again", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const created = await postExpense(token, {
      category: "fuel",
      amountMinor: "50000",
      spentOn: "2026-07-15",
    });
    const createdBody: { id: string } = await created.json();
    ctx.trackCreatedExpense(createdBody.id);
    await postVoidExpense(token, createdBody.id, { reason: "first void" });

    const res = await postVoidExpense(token, createdBody.id, { reason: "second void" });
    expect(res.status).toBe(409);
    const body: { code: string } = await res.json();
    expect(body).toMatchObject({ code: "EXPENSE_ALREADY_VOIDED" });

    await ctx.cleanup();
  });

  it("GAP-190/N2 — two concurrent voids of the same expense: exactly one wins, the loser is refused rather than overwriting the winner's reason", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const created = await postExpense(token, {
      category: "fuel",
      amountMinor: "50000",
      spentOn: "2026-07-15",
    });
    const createdBody: { id: string } = await created.json();
    ctx.trackCreatedExpense(createdBody.id);

    // Before GAP-190/N2: voidExpenseRow's WHERE matched on id alone, so both
    // requests below would pass the domain layer's pre-check and both
    // updates would land — the second silently overwriting the first's
    // voided_reason/voided_by (W-50's append-only rule, broken quietly).
    const [a, b] = await Promise.all([
      postVoidExpense(token, createdBody.id, { reason: "first void" }),
      postVoidExpense(token, createdBody.id, { reason: "second void" }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    const winner = a.status === 200 ? a : b;
    const winnerBody: { voidedAt: string } = await winner.json();
    expect(winnerBody.voidedAt).toBeTruthy();

    await ctx.cleanup();
  });

  it("404 — the expense belongs to another business", async () => {
    const ctx = new TestContext(db);
    const other = new TestContext(db);
    const otherBusinessId = await other.createBusiness({ name: "Someone Else's Fleet" });
    await other.createOpenPeriod(otherBusinessId);
    const otherOwner = await mintUser(db, other, otherBusinessId, "owner");
    const otherToken = await signAccessToken(otherOwner.asgardeoSub);
    const otherExpense = await postExpense(otherToken, {
      category: "fuel",
      amountMinor: "50000",
      spentOn: "2026-07-15",
    });
    const otherExpenseBody: { id: string } = await otherExpense.json();
    other.trackCreatedExpense(otherExpenseBody.id);

    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postVoidExpense(token, otherExpenseBody.id, { reason: "x" });
    expect(res.status).toBe(404);

    await ctx.cleanup();
    await other.cleanup();
  });

  it("409 PERIOD_CLOSED — voiding after the expense's own period has closed is refused (GAP-35, migration 0008)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId, {
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const created = await postExpense(token, {
      category: "fuel",
      amountMinor: "50000",
      spentOn: "2026-07-15",
    });
    const createdBody: { id: string } = await created.json();
    ctx.trackCreatedExpense(createdBody.id);

    await ctx.closePeriod(periodId);

    // Before migration 0008 this returned 200: `posted_period_id` stays
    // untouched by a void, and 0006 let any such update through — silently
    // changing July's reported costs after July closed. It must now be
    // refused the same way creating a new July expense already is.
    const res = await postVoidExpense(token, createdBody.id, { reason: "found after close" });
    expect(res.status).toBe(409);
    const body: { code: string } = await res.json();
    expect(body).toMatchObject({ code: "PERIOD_CLOSED" });

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await postVoidExpense("", "11111111-1111-4111-8111-111111111111", {
      reason: "x",
    });
    expect(res.status).toBe(401);
  });

  it("403 — a linked driver cannot void an expense", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await postVoidExpense(token, "11111111-1111-4111-8111-111111111111", {
      reason: "x",
    });
    expect(res.status).toBe(403);

    await ctx.cleanup();
  });
});

/** GAP-60/D-16: "the replacement writes replaces_id, not the void" — F-8.5's replace half. */
describe("replace a voided expense (GAP-60/D-16)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — a fresh expense naming a voided one as replacesId links the two", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const created = await postExpense(token, {
      category: "fuel",
      amountMinor: "50000",
      spentOn: "2026-07-15",
    });
    const createdBody: { id: string } = await created.json();
    ctx.trackCreatedExpense(createdBody.id);
    await postVoidExpense(token, createdBody.id, { reason: "wrong amount" });

    const res = await postExpense(token, {
      category: "fuel",
      amountMinor: "55000",
      spentOn: "2026-07-15",
      replacesId: createdBody.id,
    });
    expect(res.status).toBe(201);
    const body: { id: string; replacesId: string | null } = await res.json();
    expect(body.replacesId).toBe(createdBody.id);
    ctx.trackCreatedExpense(body.id);

    await ctx.cleanup();
  });

  it("a create with no replacesId still returns replacesId: null", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postExpense(token, {
      category: "fuel",
      amountMinor: "50000",
      spentOn: "2026-07-15",
    });
    const body: { id: string; replacesId: string | null } = await res.json();
    expect(body.replacesId).toBeNull();
    ctx.trackCreatedExpense(body.id);

    await ctx.cleanup();
  });

  it("409 — replacesId names an expense that has not been voided yet", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const live = await postExpense(token, {
      category: "fuel",
      amountMinor: "50000",
      spentOn: "2026-07-15",
    });
    const liveBody: { id: string } = await live.json();
    ctx.trackCreatedExpense(liveBody.id);

    const res = await postExpense(token, {
      category: "fuel",
      amountMinor: "55000",
      spentOn: "2026-07-15",
      replacesId: liveBody.id,
    });
    expect(res.status).toBe(409);
    const body: { code: string } = await res.json();
    expect(body).toMatchObject({ code: "REPLACES_TARGET_NOT_VOIDED" });

    await ctx.cleanup();
  });

  it("409 — replacesId names an expense already replaced by another", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const created = await postExpense(token, {
      category: "fuel",
      amountMinor: "50000",
      spentOn: "2026-07-15",
    });
    const createdBody: { id: string } = await created.json();
    ctx.trackCreatedExpense(createdBody.id);
    await postVoidExpense(token, createdBody.id, { reason: "wrong amount" });

    const firstReplacement = await postExpense(token, {
      category: "fuel",
      amountMinor: "55000",
      spentOn: "2026-07-15",
      replacesId: createdBody.id,
    });
    const firstReplacementBody: { id: string } = await firstReplacement.json();
    ctx.trackCreatedExpense(firstReplacementBody.id);

    const res = await postExpense(token, {
      category: "fuel",
      amountMinor: "56000",
      spentOn: "2026-07-15",
      replacesId: createdBody.id,
    });
    expect(res.status).toBe(409);
    const body: { code: string } = await res.json();
    expect(body).toMatchObject({ code: "REPLACES_TARGET_ALREADY_REPLACED" });

    await ctx.cleanup();
  });

  it("404 — replacesId names an expense in another business", async () => {
    const ctx = new TestContext(db);
    const other = new TestContext(db);
    const otherBusinessId = await other.createBusiness({ name: "Someone Else's Fleet" });
    await other.createOpenPeriod(otherBusinessId);
    const otherOwner = await mintUser(db, other, otherBusinessId, "owner");
    const otherToken = await signAccessToken(otherOwner.asgardeoSub);
    const otherExpense = await postExpense(otherToken, {
      category: "fuel",
      amountMinor: "50000",
      spentOn: "2026-07-15",
    });
    const otherExpenseBody: { id: string } = await otherExpense.json();
    other.trackCreatedExpense(otherExpenseBody.id);
    await postVoidExpense(otherToken, otherExpenseBody.id, { reason: "wrong amount" });

    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postExpense(token, {
      category: "fuel",
      amountMinor: "55000",
      spentOn: "2026-07-15",
      replacesId: otherExpenseBody.id,
    });
    expect(res.status).toBe(404);

    await ctx.cleanup();
    await other.cleanup();
  });
});

/** Web-P8b's costs list (F-3.1): every filter optional, voided rows included and struck through by the caller (W-50). */
describe("list expenses (Web-P8b, F-3.1)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — newest first, a voided row included with its reason", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const first = await postExpense(token, {
      vehicleId,
      category: "fuel",
      amountMinor: "10000",
      spentOn: "2026-07-10",
    });
    const firstBody: { id: string } = await first.json();
    ctx.trackCreatedExpense(firstBody.id);

    const second = await postExpense(token, {
      category: "office",
      amountMinor: "20000",
      spentOn: "2026-07-20",
    });
    const secondBody: { id: string } = await second.json();
    ctx.trackCreatedExpense(secondBody.id);
    await postVoidExpense(token, secondBody.id, { reason: "wrong category" });

    const res = await getExpenses(token);
    expect(res.status).toBe(200);
    const body: Array<{ id: string; voidedAt: string | null; voidedReason: string | null }> =
      await res.json();
    const ids = body.map((r) => r.id);
    expect(ids.indexOf(secondBody.id)).toBeLessThan(ids.indexOf(firstBody.id));
    const voided = body.find((r) => r.id === secondBody.id);
    expect(voided).toMatchObject({ voidedReason: "wrong category" });
    expect(voided?.voidedAt).toBeTruthy();

    await ctx.cleanup();
  });

  it("filters by vehicleId, category and date range", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const inScope = await postExpense(token, {
      vehicleId,
      category: "fuel",
      amountMinor: "10000",
      spentOn: "2026-07-10",
    });
    const inScopeBody: { id: string } = await inScope.json();
    ctx.trackCreatedExpense(inScopeBody.id);

    const wrongCategory = await postExpense(token, {
      vehicleId,
      category: "tolls",
      amountMinor: "5000",
      spentOn: "2026-07-10",
    });
    const wrongCategoryBody: { id: string } = await wrongCategory.json();
    ctx.trackCreatedExpense(wrongCategoryBody.id);

    const outsideWindow = await postExpense(token, {
      vehicleId,
      category: "fuel",
      amountMinor: "10000",
      spentOn: "2026-06-01",
    });
    const outsideWindowBody: { id: string } = await outsideWindow.json();
    ctx.trackCreatedExpense(outsideWindowBody.id);

    const overhead = await postExpense(token, {
      category: "fuel",
      amountMinor: "10000",
      spentOn: "2026-07-10",
    });
    const overheadBody: { id: string } = await overhead.json();
    ctx.trackCreatedExpense(overheadBody.id);

    const res = await getExpenses(
      token,
      `?vehicleId=${vehicleId}&category=fuel&from=2026-07-01&to=2026-07-31`,
    );
    expect(res.status).toBe(200);
    const body: Array<{ id: string }> = await res.json();
    expect(body.map((r) => r.id)).toEqual([inScopeBody.id]);

    await ctx.cleanup();
  });

  it("tenant isolation — another business's expenses never appear", async () => {
    const ctx = new TestContext(db);
    const other = new TestContext(db);
    const otherBusinessId = await other.createBusiness({ name: "Someone Else's Fleet" });
    await other.createOpenPeriod(otherBusinessId);
    const otherOwner = await mintUser(db, other, otherBusinessId, "owner");
    const otherToken = await signAccessToken(otherOwner.asgardeoSub);
    const otherExpense = await postExpense(otherToken, {
      category: "fuel",
      amountMinor: "50000",
      spentOn: "2026-07-15",
    });
    const otherExpenseBody: { id: string } = await otherExpense.json();
    other.trackCreatedExpense(otherExpenseBody.id);

    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await getExpenses(token);
    expect(res.status).toBe(200);
    const body: Array<{ id: string }> = await res.json();
    expect(body.map((r) => r.id)).not.toContain(otherExpenseBody.id);

    await ctx.cleanup();
    await other.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await getExpenses("");
    expect(res.status).toBe(401);
  });

  it("403 — a linked driver cannot read the business's costs", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await getExpenses(token);
    expect(res.status).toBe(403);

    await ctx.cleanup();
  });
});

/**
 * GAP-32/§6.7: a live preview of the default-owner matrix — lets the client
 * show who a cost would default to before offering an override to someone
 * else, reusing `resolveBorneByDefault` (domain/expense.ts) rather than a
 * second implementation of the matrix.
 */
describe("borne-by default preview (GAP-32)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — arrangement B fuel resolves to the current driver, same as the create endpoint's own default", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "B");
    const driverId = await ctx.createDriver(businessId);
    await ctx.createDailyLease(businessId, vehicleId, driverId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await getBorneByDefault(
      token,
      `?vehicleId=${vehicleId}&category=fuel&spentOn=2026-07-15`,
    );
    expect(res.status).toBe(200);
    const body: { borneBy: string; borneByDriverId: string | null } = await res.json();
    expect(body).toMatchObject({ borneBy: "driver", borneByDriverId: driverId });

    await ctx.cleanup();
  });

  it("happy path — arrangement C tolls resolve to us, no party named", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "C");
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await getBorneByDefault(
      token,
      `?vehicleId=${vehicleId}&category=tolls&spentOn=2026-07-15`,
    );
    expect(res.status).toBe(200);
    const body: {
      borneBy: string;
      borneByDriverId: string | null;
      borneByCustomerId: string | null;
    } = await res.json();
    expect(body).toMatchObject({ borneBy: "us", borneByDriverId: null, borneByCustomerId: null });

    await ctx.cleanup();
  });

  it("404 — the vehicle belongs to another business", async () => {
    const ctx = new TestContext(db);
    const other = new TestContext(db);
    const otherBusinessId = await other.createBusiness({ name: "Someone Else's Fleet" });
    const otherVehicleId = await other.createVehicle(otherBusinessId);
    const businessId = await ctx.createBusiness();
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await getBorneByDefault(
      token,
      `?vehicleId=${otherVehicleId}&category=fuel&spentOn=2026-07-15`,
    );
    expect(res.status).toBe(404);

    await ctx.cleanup();
    await other.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await getBorneByDefault(
      "",
      "?vehicleId=11111111-1111-4111-8111-111111111111&category=fuel&spentOn=2026-07-15",
    );
    expect(res.status).toBe(401);
  });

  it("403 — a linked driver cannot preview borne-by", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await getBorneByDefault(
      token,
      `?vehicleId=${vehicleId}&category=fuel&spentOn=2026-07-15`,
    );
    expect(res.status).toBe(403);

    await ctx.cleanup();
  });
});

/**
 * GAP-34/U-3: "vehicle defaults to the one with something pending" — reuses
 * Home item 4's own unconfirmed-day definition (`findVehicleWithOldestUnconfirmedDay`,
 * queries/day-record.ts), oldest first, since no last-touched-vehicle column
 * exists in this schema.
 */
describe("expense prefill vehicle (GAP-34)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });
  const today = businessToday();

  it("happy path — the vehicle with the oldest unconfirmed day, not the newer one", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId, {
      periodStart: addDays(today, -60),
      periodEnd: addDays(today, 60),
    });
    const olderVehicleId = await ctx.createVehicle(businessId, { registration: "OLD-0001" });
    const newerVehicleId = await ctx.createVehicle(businessId, { registration: "NEW-0001" });
    const driverId = await ctx.createDriver(businessId);
    const olderLeaseId = await ctx.createDailyLease(businessId, olderVehicleId, driverId);
    const newerLeaseId = await ctx.createDailyLease(businessId, newerVehicleId, driverId);
    await ctx.createDayRecord(
      businessId,
      periodId,
      newerLeaseId,
      newerVehicleId,
      driverId,
      addDays(today, -2),
    );
    await ctx.createDayRecord(
      businessId,
      periodId,
      olderLeaseId,
      olderVehicleId,
      driverId,
      addDays(today, -5),
    );
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await getPrefillVehicle(token);
    expect(res.status).toBe(200);
    const body: { vehicleId: string | null } = await res.json();
    expect(body.vehicleId).toBe(olderVehicleId);

    await ctx.cleanup();
  });

  it("nothing pending — vehicleId is null, the caller's own fallback is unaffected", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await getPrefillVehicle(token);
    expect(res.status).toBe(200);
    const body: { vehicleId: string | null } = await res.json();
    expect(body.vehicleId).toBeNull();

    await ctx.cleanup();
  });

  it("tenant isolation — another business's pending vehicle never leaks", async () => {
    const ctx = new TestContext(db);
    const other = new TestContext(db);
    const otherBusinessId = await other.createBusiness({ name: "Someone Else's Fleet" });
    const otherPeriodId = await other.createOpenPeriod(otherBusinessId, {
      periodStart: addDays(today, -60),
      periodEnd: addDays(today, 60),
    });
    const otherVehicleId = await other.createVehicle(otherBusinessId);
    const otherDriverId = await other.createDriver(otherBusinessId);
    const otherLeaseId = await other.createDailyLease(
      otherBusinessId,
      otherVehicleId,
      otherDriverId,
    );
    await other.createDayRecord(
      otherBusinessId,
      otherPeriodId,
      otherLeaseId,
      otherVehicleId,
      otherDriverId,
      addDays(today, -2),
    );

    const businessId = await ctx.createBusiness();
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await getPrefillVehicle(token);
    expect(res.status).toBe(200);
    const body: { vehicleId: string | null } = await res.json();
    expect(body.vehicleId).toBeNull();

    await ctx.cleanup();
    await other.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await getPrefillVehicle("");
    expect(res.status).toBe(401);
  });

  it("403 — a linked driver cannot read the prefill vehicle", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await getPrefillVehicle(token);
    expect(res.status).toBe(403);

    await ctx.cleanup();
  });
});
