import { and, eq, isNull } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { obligation, offsetAllocation, offsetRecord } from "../../src/db/schema.js";
import { mintLinkedDriver, mintUser, signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

function post(path: string, token: string, body: unknown) {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

function get(path: string, token: string) {
  return request(path, bearer(token));
}

describe("driver advances (P4, F-6.3/UC-53)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — issue, part-settle, then settle in full: the advance closes at zero", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const issueRes = await post("/api/advance", token, {
      driverId,
      amountMinor: "500000",
      issuedOn: "2026-07-15",
    });
    expect(issueRes.status).toBe(201);
    const issued: { id: string; status: string } = await issueRes.json();
    expect(issued.status).toBe("open");
    ctx.trackCreatedAdvance(issued.id);

    const partRes = await post(`/api/advance/${issued.id}/settle`, token, {
      kind: "spent",
      amountMinor: "300000",
      occurredOn: "2026-07-16",
    });
    expect(partRes.status).toBe(200);
    expect(await partRes.json()).toMatchObject({ status: "part_settled", settledMinor: "300000" });

    const fullRes = await post(`/api/advance/${issued.id}/settle`, token, {
      kind: "returned",
      amountMinor: "200000",
      occurredOn: "2026-07-16",
    });
    expect(fullRes.status).toBe(200);
    expect(await fullRes.json()).toMatchObject({ status: "settled", settledMinor: "500000" });

    await ctx.cleanup();
  });

  it("400 — settling more than the advance's original amount", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const issueRes = await post("/api/advance", token, {
      driverId,
      amountMinor: "100000",
      issuedOn: "2026-07-15",
    });
    const issued: { id: string } = await issueRes.json();
    ctx.trackCreatedAdvance(issued.id);

    const res = await post(`/api/advance/${issued.id}/settle`, token, {
      kind: "returned",
      amountMinor: "200000",
      occurredOn: "2026-07-16",
    });
    expect(res.status).toBe(400);

    await ctx.cleanup();
  });

  it("404 — the advance belongs to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    await ctx.createOpenPeriod(otherBusinessId);
    const otherDriverId = await ctx.createDriver(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);
    const otherOwner = await mintUser(db, ctx, otherBusinessId, "owner");
    const otherToken = await signAccessToken(otherOwner.asgardeoSub);

    const issueRes = await post("/api/advance", otherToken, {
      driverId: otherDriverId,
      amountMinor: "100000",
      issuedOn: "2026-07-15",
    });
    const issued: { id: string } = await issueRes.json();
    ctx.trackCreatedAdvance(issued.id);

    const res = await post(`/api/advance/${issued.id}/settle`, token, {
      kind: "returned",
      amountMinor: "1000",
      occurredOn: "2026-07-16",
    });
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await post("/api/advance", "", {});
    expect(res.status).toBe(401);
  });
});

describe("GET /api/advance/{id}/settlement (GAP-147)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — every settlement against this advance, newest first", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const issueRes = await post("/api/advance", token, {
      driverId,
      amountMinor: "500000",
      issuedOn: "2026-07-15",
    });
    const issued: { id: string } = await issueRes.json();
    ctx.trackCreatedAdvance(issued.id);

    const firstRes = await post(`/api/advance/${issued.id}/settle`, token, {
      kind: "spent",
      amountMinor: "300000",
      occurredOn: "2026-07-16",
    });
    expect(firstRes.status).toBe(200);
    const secondRes = await post(`/api/advance/${issued.id}/settle`, token, {
      kind: "returned",
      amountMinor: "200000",
      occurredOn: "2026-07-20",
    });
    expect(secondRes.status).toBe(200);

    const res = await get(`/api/advance/${issued.id}/settlement`, token);
    expect(res.status).toBe(200);
    const body: Array<{
      id: string;
      advanceId: string;
      kind: string;
      amountMinor: string;
      occurredOn: string;
      voidedAt: string | null;
      voidedReason: string | null;
    }> = await res.json();
    expect(body).toHaveLength(2);
    // Newest first — the 20th before the 16th.
    expect(body[0]).toMatchObject({
      advanceId: issued.id,
      kind: "returned",
      amountMinor: "200000",
      occurredOn: "2026-07-20",
      voidedAt: null,
    });
    expect(body[1]).toMatchObject({
      kind: "spent",
      amountMinor: "300000",
      occurredOn: "2026-07-16",
    });

    await ctx.cleanup();
  });

  it("a voided settlement stays in the list, struck through with its reason (W-50)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const issueRes = await post("/api/advance", token, {
      driverId,
      amountMinor: "500000",
      issuedOn: "2026-07-15",
    });
    const issued: { id: string } = await issueRes.json();
    ctx.trackCreatedAdvance(issued.id);

    const settleRes = await post(`/api/advance/${issued.id}/settle`, token, {
      kind: "spent",
      amountMinor: "300000",
      occurredOn: "2026-07-16",
    });
    const settled: { settlementId: string } = await settleRes.json();

    const voidRes = await post(
      `/api/advance/${issued.id}/settlement/${settled.settlementId}/void`,
      token,
      { reason: "Entered against the wrong advance" },
    );
    expect(voidRes.status).toBe(200);

    const res = await get(`/api/advance/${issued.id}/settlement`, token);
    const body: Array<{ voidedAt: string | null; voidedReason: string | null }> = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0]?.voidedAt).not.toBeNull();
    expect(body[0]?.voidedReason).toBe("Entered against the wrong advance");

    await ctx.cleanup();
  });

  it("404 — an advance belonging to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    await ctx.createOpenPeriod(otherBusinessId);
    const otherDriverId = await ctx.createDriver(otherBusinessId);
    const otherOwner = await mintUser(db, ctx, otherBusinessId, "owner");
    const otherToken = await signAccessToken(otherOwner.asgardeoSub);
    const issueRes = await post("/api/advance", otherToken, {
      driverId: otherDriverId,
      amountMinor: "100000",
      issuedOn: "2026-07-15",
    });
    const issued: { id: string } = await issueRes.json();
    ctx.trackCreatedAdvance(issued.id);

    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await get(`/api/advance/${issued.id}/settlement`, token);
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await get("/api/advance/11111111-1111-4111-8111-111111111111/settlement", "");
    expect(res.status).toBe(401);
  });

  it("403 — a linked driver cannot view advance settlements (W-49)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await get("/api/advance/11111111-1111-4111-8111-111111111111/settlement", token);
    expect(res.status).toBe(403);

    await ctx.cleanup();
  });
});

describe("driver deposits (P4, F-6.7/UC-58/W-8)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — take, top up, then refund in full: the balance is the SUM of movements", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const takeRes = await post("/api/deposit", token, {
      driverId,
      amountMinor: "1000000",
      occurredOn: "2026-07-01",
    });
    expect(takeRes.status).toBe(201);
    const taken: { id: string; heldMinor: string } = await takeRes.json();
    expect(taken.heldMinor).toBe("1000000");
    ctx.trackCreatedDeposit(taken.id);

    const topUpRes = await post(`/api/deposit/${taken.id}/movement`, token, {
      movementType: "topped_up",
      amountMinor: "200000",
      occurredOn: "2026-07-10",
    });
    expect(topUpRes.status).toBe(200);
    expect(await topUpRes.json()).toMatchObject({ heldMinor: "1200000", status: "held" });

    const refundRes = await post(`/api/deposit/${taken.id}/movement`, token, {
      movementType: "refunded",
      amountMinor: "1200000",
      occurredOn: "2026-07-20",
    });
    expect(refundRes.status).toBe(200);
    expect(await refundRes.json()).toMatchObject({ heldMinor: "0", status: "released" });

    await ctx.cleanup();
  });

  it("400 — a movement that would draw the deposit below zero", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const takeRes = await post("/api/deposit", token, {
      driverId,
      amountMinor: "50000",
      occurredOn: "2026-07-01",
    });
    const taken: { id: string } = await takeRes.json();
    ctx.trackCreatedDeposit(taken.id);

    const res = await post(`/api/deposit/${taken.id}/movement`, token, {
      movementType: "reduced",
      amountMinor: "60000",
      occurredOn: "2026-07-10",
    });
    expect(res.status).toBe(400);

    await ctx.cleanup();
  });

  it("400 — a movement against a deposit that is no longer held", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const takeRes = await post("/api/deposit", token, {
      driverId,
      amountMinor: "50000",
      occurredOn: "2026-07-01",
    });
    const taken: { id: string } = await takeRes.json();
    ctx.trackCreatedDeposit(taken.id);

    const retainRes = await post(`/api/deposit/${taken.id}/movement`, token, {
      movementType: "retained",
      amountMinor: "50000",
      occurredOn: "2026-07-10",
    });
    expect(retainRes.status).toBe(200);
    expect(await retainRes.json()).toMatchObject({ status: "retained" });

    const res = await post(`/api/deposit/${taken.id}/movement`, token, {
      movementType: "topped_up",
      amountMinor: "1000",
      occurredOn: "2026-07-11",
    });
    expect(res.status).toBe(400);

    await ctx.cleanup();
  });

  it("404 — the deposit belongs to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    await ctx.createOpenPeriod(otherBusinessId);
    const otherDriverId = await ctx.createDriver(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);
    const otherOwner = await mintUser(db, ctx, otherBusinessId, "owner");
    const otherToken = await signAccessToken(otherOwner.asgardeoSub);

    const takeRes = await post("/api/deposit", otherToken, {
      driverId: otherDriverId,
      amountMinor: "50000",
      occurredOn: "2026-07-01",
    });
    const taken: { id: string } = await takeRes.json();
    ctx.trackCreatedDeposit(taken.id);

    const res = await post(`/api/deposit/${taken.id}/movement`, token, {
      movementType: "topped_up",
      amountMinor: "1000",
      occurredOn: "2026-07-10",
    });
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("GAP-6 — applied against an obligation settles it directly, no payment row minted", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const obligationId = await ctx.createObligation(businessId, periodId, {
      direction: "owed_to_us",
      driverId,
      amountMinor: 50_000n,
      dueOn: "2026-07-05",
    });

    const takeRes = await post("/api/deposit", token, {
      driverId,
      amountMinor: "30000",
      occurredOn: "2026-07-01",
    });
    const taken: { id: string } = await takeRes.json();
    ctx.trackCreatedDeposit(taken.id);

    const res = await post(`/api/deposit/${taken.id}/movement`, token, {
      movementType: "applied",
      amountMinor: "30000",
      occurredOn: "2026-07-10",
      obligationId,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ heldMinor: "0", status: "held" });

    const [obRow] = await db.select().from(obligation).where(eq(obligation.id, obligationId));
    expect(obRow).toMatchObject({ settledMinor: 30_000n, status: "part_paid" });

    await ctx.cleanup();
  });

  it("400 — applied with no obligationId", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const takeRes = await post("/api/deposit", token, {
      driverId,
      amountMinor: "30000",
      occurredOn: "2026-07-01",
    });
    const taken: { id: string } = await takeRes.json();
    ctx.trackCreatedDeposit(taken.id);

    const res = await post(`/api/deposit/${taken.id}/movement`, token, {
      movementType: "applied",
      amountMinor: "30000",
      occurredOn: "2026-07-10",
    });
    expect(res.status).toBe(400);

    await ctx.cleanup();
  });

  it("400 — obligationId given for a movementType other than 'applied'", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const obligationId = await ctx.createObligation(businessId, periodId, {
      direction: "owed_to_us",
      driverId,
      amountMinor: 50_000n,
    });

    const takeRes = await post("/api/deposit", token, {
      driverId,
      amountMinor: "30000",
      occurredOn: "2026-07-01",
    });
    const taken: { id: string } = await takeRes.json();
    ctx.trackCreatedDeposit(taken.id);

    const res = await post(`/api/deposit/${taken.id}/movement`, token, {
      movementType: "topped_up",
      amountMinor: "1000",
      occurredOn: "2026-07-10",
      obligationId,
    });
    expect(res.status).toBe(400);

    await ctx.cleanup();
  });

  it("400 — the named obligation belongs to a different party than the deposit", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const otherDriverId = await ctx.createDriver(businessId, { name: "Someone Else" });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const obligationId = await ctx.createObligation(businessId, periodId, {
      direction: "owed_to_us",
      driverId: otherDriverId,
      amountMinor: 50_000n,
    });

    const takeRes = await post("/api/deposit", token, {
      driverId,
      amountMinor: "30000",
      occurredOn: "2026-07-01",
    });
    const taken: { id: string } = await takeRes.json();
    ctx.trackCreatedDeposit(taken.id);

    const res = await post(`/api/deposit/${taken.id}/movement`, token, {
      movementType: "applied",
      amountMinor: "30000",
      occurredOn: "2026-07-10",
      obligationId,
    });
    expect(res.status).toBe(400);

    await ctx.cleanup();
  });

  it("400 — the named obligation is owed_by_us, not owed_to_us", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const obligationId = await ctx.createObligation(businessId, periodId, {
      direction: "owed_by_us",
      driverId,
      amountMinor: 50_000n,
    });

    const takeRes = await post("/api/deposit", token, {
      driverId,
      amountMinor: "30000",
      occurredOn: "2026-07-01",
    });
    const taken: { id: string } = await takeRes.json();
    ctx.trackCreatedDeposit(taken.id);

    const res = await post(`/api/deposit/${taken.id}/movement`, token, {
      movementType: "applied",
      amountMinor: "30000",
      occurredOn: "2026-07-10",
      obligationId,
    });
    expect(res.status).toBe(400);

    await ctx.cleanup();
  });

  it("400 — the application would exceed what remains outstanding on the obligation", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const obligationId = await ctx.createObligation(businessId, periodId, {
      direction: "owed_to_us",
      driverId,
      amountMinor: 10_000n,
    });

    const takeRes = await post("/api/deposit", token, {
      driverId,
      amountMinor: "30000",
      occurredOn: "2026-07-01",
    });
    const taken: { id: string } = await takeRes.json();
    ctx.trackCreatedDeposit(taken.id);

    const res = await post(`/api/deposit/${taken.id}/movement`, token, {
      movementType: "applied",
      amountMinor: "30000",
      occurredOn: "2026-07-10",
      obligationId,
    });
    expect(res.status).toBe(400);

    await ctx.cleanup();
  });

  it("404 — the named obligation belongs to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherPeriodId = await ctx.createOpenPeriod(otherBusinessId);
    const otherDriverId = await ctx.createDriver(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const otherObligationId = await ctx.createObligation(otherBusinessId, otherPeriodId, {
      direction: "owed_to_us",
      driverId: otherDriverId,
      amountMinor: 50_000n,
    });

    const takeRes = await post("/api/deposit", token, {
      driverId,
      amountMinor: "30000",
      occurredOn: "2026-07-01",
    });
    const taken: { id: string } = await takeRes.json();
    ctx.trackCreatedDeposit(taken.id);

    const res = await post(`/api/deposit/${taken.id}/movement`, token, {
      movementType: "applied",
      amountMinor: "30000",
      occurredOn: "2026-07-10",
      obligationId: otherObligationId,
    });
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });
});

describe("offset and the two-balances query (P4, F-6.4/UC-56/W-2)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — never netted: two separate figures, and only an explicit offset moves both (INV-3)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    // He owes 8,000 (a shortfall); we owe him 12,000 (an unpaid trip fee) — §6.4's own walkthrough.
    await ctx.createObligation(businessId, periodId, {
      direction: "owed_to_us",
      driverId,
      amountMinor: 8_000n,
      dueOn: "2026-07-14",
    });
    await ctx.createObligation(businessId, periodId, {
      direction: "owed_by_us",
      driverId,
      amountMinor: 12_000n,
      dueOn: "2026-07-20",
    });

    const before = await get(`/api/driver/${driverId}/balances`, token);
    expect(await before.json()).toMatchObject({ owedToUsMinor: "8000", owedByUsMinor: "12000" });

    const offsetRes = await post("/api/offset", token, {
      driverId,
      amountMinor: "8000",
      occurredOn: "2026-07-21",
      note: "Settling his shortfalls against the unpaid trip fee",
    });
    expect(offsetRes.status).toBe(201);
    const offsetBody: { id: string } = await offsetRes.json();
    ctx.trackCreatedOffset(offsetBody.id);

    const after = await get(`/api/driver/${driverId}/balances`, token);
    expect(await after.json()).toMatchObject({ owedToUsMinor: "0", owedByUsMinor: "4000" });

    await ctx.cleanup();
  });

  it("400 — an offset exceeding what the driver owes", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    await ctx.createObligation(businessId, periodId, {
      direction: "owed_to_us",
      driverId,
      amountMinor: 1_000n,
    });
    await ctx.createObligation(businessId, periodId, {
      direction: "owed_by_us",
      driverId,
      amountMinor: 50_000n,
    });

    const res = await post("/api/offset", token, {
      driverId,
      amountMinor: "5000",
      occurredOn: "2026-07-21",
    });
    expect(res.status).toBe(400);

    await ctx.cleanup();
  });

  it("400 — an offset exceeding what the business owes the driver", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    await ctx.createObligation(businessId, periodId, {
      direction: "owed_to_us",
      driverId,
      amountMinor: 50_000n,
    });
    await ctx.createObligation(businessId, periodId, {
      direction: "owed_by_us",
      driverId,
      amountMinor: 1_000n,
    });

    const res = await post("/api/offset", token, {
      driverId,
      amountMinor: "5000",
      occurredOn: "2026-07-21",
    });
    expect(res.status).toBe(400);

    await ctx.cleanup();
  });

  it("GAP-5a — two concurrent offsets against one obligation never both allocate past its own amount", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const owedToUsId = await ctx.createObligation(businessId, periodId, {
      direction: "owed_to_us",
      driverId,
      amountMinor: 10_000n,
      dueOn: "2026-07-14",
    });
    await ctx.createObligation(businessId, periodId, {
      direction: "owed_by_us",
      driverId,
      amountMinor: 20_000n,
      dueOn: "2026-07-20",
    });

    const body = { driverId, amountMinor: "10000", occurredOn: "2026-07-21" };
    const [r1, r2] = await Promise.all([
      post("/api/offset", token, body),
      post("/api/offset", token, body),
    ]);

    // GAP-178/B11 changed what the loser does, and the change is the point.
    //
    // Before: both returned 201, and this test asserted `totalAllocated` was
    // 10,000 — which is to say the second offset created an `offset_record`
    // for 10,000 carrying **no allocations at all** on the owed_to_us side.
    // The obligation was correctly protected from over-allocation, and the
    // phantom offset was tolerated. But INV-3/W-2 is that an offset moves the
    // *same amount on both* of a driver's balances, so a record claiming
    // 10,000 with nothing behind it on one side breaks the one invariant the
    // whole mechanism exists for, silently and permanently.
    //
    // Now: the winner allocates in full, the loser finds nothing outstanding
    // once it holds the lock, and is refused rather than writing a record it
    // cannot back. One 201, one 400.
    const statuses = [r1.status, r2.status].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 400]);

    const created = r1.status === 201 ? r1 : r2;
    const { id: offsetId } = (await created.json()) as { id: string };
    ctx.trackCreatedOffset(offsetId);

    const [obRow] = await db.select().from(obligation).where(eq(obligation.id, owedToUsId));
    const allocRows = await db
      .select()
      .from(offsetAllocation)
      .where(eq(offsetAllocation.obligationId, owedToUsId));
    const totalAllocated = allocRows.reduce((sum, a) => sum + a.amountMinor, 0n);

    // Unchanged and still the heart of GAP-5a: the obligation is never
    // allocated past its own amount.
    expect(totalAllocated).toBe(10_000n);
    expect(obRow?.settledMinor).toBe(10_000n);
    expect(obRow?.settledMinor).toBe(totalAllocated);

    // GAP-178/B11: and no offset_record stands without allocations behind it.
    const liveOffsets = await db
      .select({ id: offsetRecord.id, amountMinor: offsetRecord.amountMinor })
      .from(offsetRecord)
      .where(and(eq(offsetRecord.driverId, driverId), isNull(offsetRecord.voidedAt)));
    expect(liveOffsets).toHaveLength(1);

    await ctx.cleanup();
  });

  it("404 — the driver belongs to another business (balances read)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherDriverId = await ctx.createDriver(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await get(`/api/driver/${otherDriverId}/balances`, token);
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await get("/api/driver/00000000-0000-0000-0000-000000000000/balances", "");
    expect(res.status).toBe(401);
  });
});
