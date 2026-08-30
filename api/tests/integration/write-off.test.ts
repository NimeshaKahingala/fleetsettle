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

async function listWriteOffRecoveries(token: string, writeOffId: string) {
  return request(`/api/write-off/${writeOffId}/recovery`, bearer(token));
}

interface WriteOffResponseBody {
  id: string;
  obligationId: string | null;
  amountMinor: string;
}

/**
 * GAP-203: the fixture every partial-write-off test needs — a customer
 * carrying one 70,000 obligation, untouched otherwise, and an owner's own
 * token. Named once rather than repeated per test (SonarCloud flagged the
 * inline repeats as new-code duplication once a third test needed it).
 */
async function setupWriteOffObligation(ctx: TestContext, db: ReturnType<typeof writer>) {
  const businessId = await ctx.createBusiness();
  const periodId = await ctx.createOpenPeriod(businessId);
  const customerId = await ctx.createCustomer(businessId);
  const obligationId = await ctx.createObligation(businessId, periodId, {
    partyType: "customer",
    customerId,
    amountMinor: 70_000n,
  });
  const owner = await mintUser(db, ctx, businessId, "owner");
  const token = await signAccessToken(owner.asgardeoSub);
  return { businessId, customerId, obligationId, token };
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

  it("GAP-203/H-1/D2 — a partial write-off leaves the remainder outstanding, collectible by a later payment, not silently discarded", async () => {
    const ctx = new TestContext(db);
    const { customerId, obligationId, token } = await setupWriteOffObligation(ctx, db);

    const res = await postWriteOff(token, {
      obligationId,
      partyType: "customer",
      partyCustomerId: customerId,
      amountMinor: "30000",
      reason: "he'll never pay this last bit, but the rest is still good",
      writtenOffOn: "2026-07-20",
    });
    expect(res.status).toBe(201);
    const body: WriteOffResponseBody = await res.json();
    ctx.trackCreatedWriteOff(body.id);

    const afterWriteOff = await db
      .select({
        status: obligation.status,
        settledMinor: obligation.settledMinor,
        writtenOffMinor: obligation.writtenOffMinor,
      })
      .from(obligation)
      .where(eq(obligation.id, obligationId));
    // Not "written_off" — the old (unfixed) behaviour flipped status straight
    // there regardless of the amount given, discarding the 40,000 remainder
    // with no row recording it.
    expect(afterWriteOff[0]).toMatchObject({
      status: "part_paid",
      settledMinor: 0n,
      writtenOffMinor: 30_000n,
    });

    // Proof by consequence: a payment of 50,000 — more than the 40,000
    // genuinely remaining — must settle this obligation at exactly 40,000
    // and leave 10,000 unallocated credit. If the written-off 30,000 were
    // still counted as collectible, the payment would try to take the full
    // 70,000 - 0 = 70,000, fully absorbing all 50,000 with nothing left over.
    const paymentRes = await request("/api/payment", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...bearer(token).headers },
      body: JSON.stringify({
        partyType: "customer",
        partyId: customerId,
        amountMinor: "50000",
        occurredOn: "2026-07-21",
      }),
    });
    expect(paymentRes.status).toBe(201);
    const paymentBody: { id: string; unallocatedMinor: string } = await paymentRes.json();
    expect(paymentBody.unallocatedMinor).toBe("10000");
    ctx.trackCreatedPayment(paymentBody.id);

    // Still "written_off", not "paid" — the same precedence a waiver already
    // has (computeObligationStatus's own docstring): "paid" is reserved for
    // when settled_minor alone reaches the full original amount, so a
    // partial write-off can never fade back into looking like an ordinary
    // fully-collected obligation just because the rest came in.
    const afterPayment = await db
      .select({ status: obligation.status, settledMinor: obligation.settledMinor })
      .from(obligation)
      .where(eq(obligation.id, obligationId));
    expect(afterPayment[0]).toMatchObject({ status: "written_off", settledMinor: 40_000n });

    await ctx.cleanup();
  });

  it("GAP-203/H-1/D2 — a second write-off accumulates against the same obligation and can complete it", async () => {
    const ctx = new TestContext(db);
    const { customerId, obligationId, token } = await setupWriteOffObligation(ctx, db);

    const first = await postWriteOff(token, {
      obligationId,
      partyType: "customer",
      partyCustomerId: customerId,
      amountMinor: "30000",
      reason: "first tranche, unrecoverable",
      writtenOffOn: "2026-07-20",
    });
    expect(first.status).toBe(201);
    const firstBody: WriteOffResponseBody = await first.json();
    ctx.trackCreatedWriteOff(firstBody.id);

    const second = await postWriteOff(token, {
      obligationId,
      partyType: "customer",
      partyCustomerId: customerId,
      amountMinor: "40000",
      reason: "the rest is gone too, closing this out",
      writtenOffOn: "2026-07-25",
    });
    expect(second.status).toBe(201);
    const secondBody: WriteOffResponseBody = await second.json();
    ctx.trackCreatedWriteOff(secondBody.id);

    const rows = await db
      .select({ status: obligation.status, writtenOffMinor: obligation.writtenOffMinor })
      .from(obligation)
      .where(eq(obligation.id, obligationId));
    expect(rows[0]).toMatchObject({ status: "written_off", writtenOffMinor: 70_000n });

    await ctx.cleanup();
  });

  it("400 — obligationId names an obligation against a different party than this write-off (GAP-203/H-1)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const customerA = await ctx.createCustomer(businessId);
    const customerB = await ctx.createCustomer(businessId);
    const obligationId = await ctx.createObligation(businessId, periodId, {
      partyType: "customer",
      customerId: customerA,
      amountMinor: 70_000n,
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postWriteOff(token, {
      obligationId,
      partyType: "customer",
      partyCustomerId: customerB,
      amountMinor: "30000",
      reason: "entered against the wrong customer by id typo",
      writtenOffOn: "2026-07-20",
    });
    expect(res.status).toBe(400);

    await ctx.cleanup();
  });

  it("GAP-203/H-1/D2 — voiding a partial write-off restores exactly its own share, not the whole column", async () => {
    const ctx = new TestContext(db);
    const { customerId, obligationId, token } = await setupWriteOffObligation(ctx, db);

    const first = await postWriteOff(token, {
      obligationId,
      partyType: "customer",
      partyCustomerId: customerId,
      amountMinor: "30000",
      reason: "first tranche",
      writtenOffOn: "2026-07-20",
    });
    const firstBody: WriteOffResponseBody = await first.json();
    ctx.trackCreatedWriteOff(firstBody.id);

    const second = await postWriteOff(token, {
      obligationId,
      partyType: "customer",
      partyCustomerId: customerId,
      amountMinor: "20000",
      reason: "second tranche",
      writtenOffOn: "2026-07-25",
    });
    const secondBody: WriteOffResponseBody = await second.json();
    ctx.trackCreatedWriteOff(secondBody.id);

    const voided = await request(`/api/write-off/${firstBody.id}/void`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...bearer(token).headers },
      body: JSON.stringify({ reason: "entered in error" }),
    });
    expect(voided.status).toBe(200);

    const rows = await db
      .select({ status: obligation.status, writtenOffMinor: obligation.writtenOffMinor })
      .from(obligation)
      .where(eq(obligation.id, obligationId));
    // 50,000 (both tranches) minus the 30,000 just voided — not reset to 0,
    // and not left at 50,000 either.
    expect(rows[0]).toMatchObject({ status: "part_paid", writtenOffMinor: 20_000n });

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

describe("GET /api/write-off/{id}/recovery (GAP-147)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — every recovery against this write-off, newest first, with the date it was recorded through", async () => {
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

    const firstRecoveryRes = await postWriteOffRecovery(token, writeOffBody.id, {
      amountMinor: "10000",
      occurredOn: "2026-07-10",
    });
    expect(firstRecoveryRes.status).toBe(201);
    const secondRecoveryRes = await postWriteOffRecovery(token, writeOffBody.id, {
      amountMinor: "15000",
      occurredOn: "2026-07-20",
    });
    expect(secondRecoveryRes.status).toBe(201);
    const secondRecoveryBody: { id: string } = await secondRecoveryRes.json();

    const res = await listWriteOffRecoveries(token, writeOffBody.id);
    expect(res.status).toBe(200);
    const body: Array<{
      id: string;
      writeOffId: string;
      amountMinor: string;
      occurredOn: string;
      voidedAt: string | null;
      voidedReason: string | null;
    }> = await res.json();
    // Newest first — the 20th before the 10th.
    expect(body).toHaveLength(2);
    expect(body[0]).toMatchObject({
      id: secondRecoveryBody.id,
      writeOffId: writeOffBody.id,
      amountMinor: "15000",
      occurredOn: "2026-07-20",
      voidedAt: null,
    });
    expect(body[1]).toMatchObject({ amountMinor: "10000", occurredOn: "2026-07-10" });

    await ctx.cleanup();
  });

  it("a voided recovery stays in the list, struck through with its reason (W-50)", async () => {
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

    const recoveryRes = await postWriteOffRecovery(token, writeOffBody.id, {
      amountMinor: "10000",
      occurredOn: "2026-07-10",
    });
    const recoveryBody: { id: string } = await recoveryRes.json();

    const voidRes = await request(
      `/api/write-off/${writeOffBody.id}/recovery/${recoveryBody.id}/void`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...bearer(token).headers },
        body: JSON.stringify({ reason: "Entered against the wrong write-off" }),
      },
    );
    expect(voidRes.status).toBe(200);

    const res = await listWriteOffRecoveries(token, writeOffBody.id);
    const body: Array<{ id: string; voidedAt: string | null; voidedReason: string | null }> =
      await res.json();
    expect(body).toHaveLength(1);
    expect(body[0]?.voidedAt).not.toBeNull();
    expect(body[0]?.voidedReason).toBe("Entered against the wrong write-off");

    await ctx.cleanup();
  });

  it("404 — a write-off belonging to another business", async () => {
    const ctx = new TestContext(db);
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
    const otherWriteOffBody: WriteOffResponseBody = await otherWriteOffRes.json();
    ctx.trackCreatedWriteOff(otherWriteOffBody.id);

    const businessId = await ctx.createBusiness();
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await listWriteOffRecoveries(token, otherWriteOffBody.id);
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await listWriteOffRecoveries("", "11111111-1111-4111-8111-111111111111");
    expect(res.status).toBe(401);
  });

  it("403 — a linked driver cannot view write-off recoveries (W-49)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await listWriteOffRecoveries(token, "11111111-1111-4111-8111-111111111111");
    expect(res.status).toBe(403);

    await ctx.cleanup();
  });
});
