import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { obligation } from "../../src/db/schema.js";
import { mintLinkedDriver, mintUser, signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

async function postWriteOff(token: string, body: unknown) {
  return request("/api/write-off", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

async function postWriteOffRecovery(token: string, writeOffId: string, body: unknown) {
  return request(`/api/write-off/${writeOffId}/recovery`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

async function listWriteOffs(token: string, query = "") {
  return request(`/api/write-off${query}`, bearer(token));
}

interface WriteOffResponseBody {
  id: string;
  obligationId: string | null;
  amountMinor: string;
}

interface WriteOffListRowBody {
  id: string;
  obligationId: string | null;
  partyType: "customer" | "driver";
  partyCustomerId: string | null;
  partyDriverId: string | null;
  vehicleId: string | null;
  amountMinor: string;
  reason: string;
  writtenOffOn: string;
  voidedAt: string | null;
  voidedReason: string | null;
}

/**
 * F-8.3/UC-90/W-28 test matrix. INV-14: never pooled with a waiver — this
 * clears the obligation to `written_off`, a state distinct from `waived`.
 * INV-15: a later recovery nets against the loss, never fresh income.
 */
describe("write off a balance (P10, F-8.3/UC-90)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — clears the obligation to written_off, without touching settled/waived (INV-14)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const customerId = await ctx.createCustomer(businessId);
    const obligationId = await ctx.createObligation(businessId, periodId, {
      partyType: "customer",
      customerId,
      amountMinor: 70_000n,
      settledMinor: 10_000n,
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postWriteOff(token, {
      obligationId,
      partyType: "customer",
      partyCustomerId: customerId,
      amountMinor: "60000",
      reason: "customer vanished, unreachable after three attempts",
      writtenOffOn: "2026-07-20",
    });
    expect(res.status).toBe(201);
    const body: WriteOffResponseBody = await res.json();
    expect(body).toMatchObject({ obligationId, amountMinor: "60000" });
    ctx.trackCreatedWriteOff(body.id);

    const rows = await db
      .select({
        status: obligation.status,
        settledMinor: obligation.settledMinor,
        waivedMinor: obligation.waivedMinor,
      })
      .from(obligation)
      .where(eq(obligation.id, obligationId));
    expect(rows[0]).toMatchObject({
      status: "written_off",
      settledMinor: 10_000n,
      waivedMinor: 0n,
    });

    await ctx.cleanup();
  });

  it("happy path — a standalone write-off with no matching obligation", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postWriteOff(token, {
      partyType: "driver",
      partyDriverId: driverId,
      amountMinor: "15000",
      reason: "an old opening-balance arrears figure, unrecoverable",
      writtenOffOn: "2026-07-20",
    });
    expect(res.status).toBe(201);
    const body: WriteOffResponseBody = await res.json();
    expect(body.obligationId).toBeNull();
    ctx.trackCreatedWriteOff(body.id);

    await ctx.cleanup();
  });

  it("INV-15 — a later recovery nets against the write-off, recorded through an ordinary payment", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const customerId = await ctx.createCustomer(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const writeOffRes = await postWriteOff(token, {
      partyType: "customer",
      partyCustomerId: customerId,
      amountMinor: "40000",
      reason: "written off last quarter",
      writtenOffOn: "2026-07-01",
    });
    const writeOffBody: WriteOffResponseBody = await writeOffRes.json();
    ctx.trackCreatedWriteOff(writeOffBody.id);

    const res = await postWriteOffRecovery(token, writeOffBody.id, {
      amountMinor: "40000",
      occurredOn: "2026-07-25",
    });
    expect(res.status).toBe(201);
    const body: { id: string; writeOffId: string; paymentId: string; amountMinor: string } =
      await res.json();
    expect(body).toMatchObject({ writeOffId: writeOffBody.id, amountMinor: "40000" });
    expect(body.paymentId).toBeTruthy();

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await postWriteOff("", {
      partyType: "customer",
      partyCustomerId: "11111111-1111-4111-8111-111111111111",
      amountMinor: "1",
      reason: "x",
      writtenOffOn: "2026-07-20",
    });
    expect(res.status).toBe(401);
  });

  it("403 — a manager cannot write off a balance (owners only)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const manager = await mintUser(db, ctx, businessId, "manager");
    const token = await signAccessToken(manager.asgardeoSub);

    const res = await postWriteOff(token, {
      partyType: "customer",
      partyCustomerId: "11111111-1111-4111-8111-111111111111",
      amountMinor: "1",
      reason: "x",
      writtenOffOn: "2026-07-20",
    });
    expect(res.status).toBe(403);

    await ctx.cleanup();
  });

  it("404 — the customer belongs to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherCustomerId = await ctx.createCustomer(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postWriteOff(token, {
      partyType: "customer",
      partyCustomerId: otherCustomerId,
      amountMinor: "1000",
      reason: "x",
      writtenOffOn: "2026-07-20",
    });
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("404 — vehicleId cannot tag a vehicle from another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const customerId = await ctx.createCustomer(businessId);
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherVehicleId = await ctx.createVehicle(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postWriteOff(token, {
      partyType: "customer",
      partyCustomerId: customerId,
      vehicleId: otherVehicleId,
      amountMinor: "1000",
      reason: "x",
      writtenOffOn: "2026-07-20",
    });
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("409 — a closed accounting period rejects the write", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const customerId = await ctx.createCustomer(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    await ctx.closePeriod(periodId);

    const res = await postWriteOff(token, {
      partyType: "customer",
      partyCustomerId: customerId,
      amountMinor: "1000",
      reason: "x",
      writtenOffOn: "2026-07-20",
    });
    expect(res.status).toBe(409);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "PERIOD_CLOSED" });

    await ctx.cleanup();
  });
});

/** A3: every filter optional, newest first — the write-off review list. */
describe("GET /api/write-off (A3)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — every write-off for this business, newest first, filterable by party", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const customerId = await ctx.createCustomer(businessId);
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const customerWriteOffRes = await postWriteOff(token, {
      partyType: "customer",
      partyCustomerId: customerId,
      amountMinor: "10000",
      reason: "customer vanished",
      writtenOffOn: "2026-07-10",
    });
    expect(customerWriteOffRes.status).toBe(201);
    const customerWriteOffBody: WriteOffResponseBody = await customerWriteOffRes.json();
    ctx.trackCreatedWriteOff(customerWriteOffBody.id);

    const driverWriteOffRes = await postWriteOff(token, {
      partyType: "driver",
      partyDriverId: driverId,
      amountMinor: "5000",
      reason: "unrecoverable arrears",
      writtenOffOn: "2026-07-20",
    });
    expect(driverWriteOffRes.status).toBe(201);
    const driverWriteOffBody: WriteOffResponseBody = await driverWriteOffRes.json();
    ctx.trackCreatedWriteOff(driverWriteOffBody.id);

    const allRes = await listWriteOffs(token);
    expect(allRes.status).toBe(200);
    const allBody: WriteOffListRowBody[] = await allRes.json();
    // Newest first — the driver write-off (20th) before the customer one (10th).
    expect(allBody.map((r) => r.id)).toEqual([driverWriteOffBody.id, customerWriteOffBody.id]);
    expect(allBody[0]).toMatchObject({
      id: driverWriteOffBody.id,
      partyType: "driver",
      partyDriverId: driverId,
      amountMinor: "5000",
      reason: "unrecoverable arrears",
      writtenOffOn: "2026-07-20",
      voidedAt: null,
    });

    const filteredRes = await listWriteOffs(token, `?partyType=driver&partyDriverId=${driverId}`);
    expect(filteredRes.status).toBe(200);
    const filteredBody: WriteOffListRowBody[] = await filteredRes.json();
    expect(filteredBody.map((r) => r.id)).toEqual([driverWriteOffBody.id]);

    await ctx.cleanup();
  });

  it("scoping — a write-off recorded against another business never appears", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    await ctx.createOpenPeriod(otherBusinessId);
    const otherCustomerId = await ctx.createCustomer(otherBusinessId);
    const otherOwner = await mintUser(db, ctx, otherBusinessId, "owner");
    const otherToken = await signAccessToken(otherOwner.asgardeoSub);
    const otherWriteOffRes = await postWriteOff(otherToken, {
      partyType: "customer",
      partyCustomerId: otherCustomerId,
      amountMinor: "1000",
      reason: "x",
      writtenOffOn: "2026-07-20",
    });
    expect(otherWriteOffRes.status).toBe(201);
    const otherWriteOffBody: WriteOffResponseBody = await otherWriteOffRes.json();
    ctx.trackCreatedWriteOff(otherWriteOffBody.id);

    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await listWriteOffs(token);
    expect(res.status).toBe(200);
    const body: WriteOffListRowBody[] = await res.json();
    expect(body.map((r) => r.id)).not.toContain(otherWriteOffBody.id);

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await listWriteOffs("");
    expect(res.status).toBe(401);
  });

  it("GAP-155 — a manager can view write-offs (dailyOperations, same gate as recording a recovery)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const customerId = await ctx.createCustomer(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const ownerToken = await signAccessToken(owner.asgardeoSub);
    const writeOffRes = await postWriteOff(ownerToken, {
      partyType: "customer",
      partyCustomerId: customerId,
      amountMinor: "1000",
      reason: "customer vanished",
      writtenOffOn: "2026-07-20",
    });
    expect(writeOffRes.status).toBe(201);
    const writeOffBody: WriteOffResponseBody = await writeOffRes.json();
    ctx.trackCreatedWriteOff(writeOffBody.id);

    const manager = await mintUser(db, ctx, businessId, "manager");
    const managerToken = await signAccessToken(manager.asgardeoSub);
    const res = await listWriteOffs(managerToken);
    expect(res.status).toBe(200);
    const body: WriteOffListRowBody[] = await res.json();
    expect(body.map((r) => r.id)).toContain(writeOffBody.id);

    await ctx.cleanup();
  });

  it("403 — a linked driver cannot view write-offs (W-49)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await listWriteOffs(token);
    expect(res.status).toBe(403);

    await ctx.cleanup();
  });
});
