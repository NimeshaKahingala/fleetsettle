import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
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
