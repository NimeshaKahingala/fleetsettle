import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { mintUser, signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

async function post(path: string, token: string, body: unknown) {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

interface VoidedBody {
  id: string;
  voidedAt: string;
}

/**
 * GAP-12/A9b, the first slice of the twelve remaining void endpoints —
 * `capital_contribution`, `banking_event`, `partner_payout`, the group with
 * no child rows to unwind (unlike `adjustment`/`offset_record`, which still
 * need their own reversal logic and are not built yet). Each mirrors
 * `voidExpense`'s shape exactly, sharing `voidRequestSchema`/
 * `voidedResponseSchema` on the wire rather than one bespoke pair per table.
 */
describe("POST /api/capital-contribution/{id}/void (GAP-12)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — voids, and a second call is refused as already voided", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const created = await post("/api/capital-contribution", token, {
      userId: owner.userId,
      amountMinor: "500000",
      contributedOn: "2026-07-15",
    });
    const { id }: { id: string } = await created.json();
    ctx.trackCreatedCapitalContribution(id);

    const res = await post(`/api/capital-contribution/${id}/void`, token, {
      reason: "entered twice",
    });
    expect(res.status).toBe(200);
    const body: VoidedBody = await res.json();
    expect(body).toMatchObject({ id });
    expect(body.voidedAt).toBeTruthy();

    const second = await post(`/api/capital-contribution/${id}/void`, token, {
      reason: "again",
    });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ code: "CAPITAL_CONTRIBUTION_ALREADY_VOIDED" });

    await ctx.cleanup();
  });

  it("regression: two concurrent voids race cleanly — one wins, the other is refused as already voided rather than clobbering the reason", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const created = await post("/api/capital-contribution", token, {
      userId: owner.userId,
      amountMinor: "500000",
      contributedOn: "2026-07-15",
    });
    const { id }: { id: string } = await created.json();
    ctx.trackCreatedCapitalContribution(id);

    const [a, b] = await Promise.all([
      post(`/api/capital-contribution/${id}/void`, token, { reason: "request A" }),
      post(`/api/capital-contribution/${id}/void`, token, { reason: "request B" }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request(`/api/capital-contribution/${crypto.randomUUID()}/void`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "x" }),
    });
    expect(res.status).toBe(401);
  });

  it("404 — a capital contribution belonging to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    await ctx.createOpenPeriod(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const otherOwner = await mintUser(db, ctx, otherBusinessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);
    const otherToken = await signAccessToken(otherOwner.asgardeoSub);

    const created = await post("/api/capital-contribution", otherToken, {
      userId: otherOwner.userId,
      amountMinor: "500000",
      contributedOn: "2026-07-15",
    });
    const { id }: { id: string } = await created.json();
    ctx.trackCreatedCapitalContribution(id);

    const res = await post(`/api/capital-contribution/${id}/void`, token, { reason: "x" });
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("400 — a reason is required", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const created = await post("/api/capital-contribution", token, {
      userId: owner.userId,
      amountMinor: "500000",
      contributedOn: "2026-07-15",
    });
    const { id }: { id: string } = await created.json();
    ctx.trackCreatedCapitalContribution(id);

    const res = await post(`/api/capital-contribution/${id}/void`, token, {});
    expect(res.status).toBe(400);

    await ctx.cleanup();
  });
});

describe("POST /api/banking-event/{id}/void (GAP-12)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — a manager (dailyOperations, not owners-only) can void it", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const manager = await mintUser(db, ctx, businessId, "manager");
    const token = await signAccessToken(manager.asgardeoSub);

    const created = await post("/api/banking-event", token, {
      amountRecordedMinor: "1000000",
      amountCountedMinor: "1000000",
      bankedOn: "2026-07-10",
      destination: "BOC current account",
    });
    const { id }: { id: string } = await created.json();
    ctx.trackCreatedBankingEvent(id);

    const res = await post(`/api/banking-event/${id}/void`, token, { reason: "wrong account" });
    expect(res.status).toBe(200);
    const body: VoidedBody = await res.json();
    expect(body.voidedAt).toBeTruthy();

    await ctx.cleanup();
  });

  it("404 — a banking event belonging to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    await ctx.createOpenPeriod(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const otherOwner = await mintUser(db, ctx, otherBusinessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);
    const otherToken = await signAccessToken(otherOwner.asgardeoSub);

    const created = await post("/api/banking-event", otherToken, {
      amountRecordedMinor: "1000000",
      amountCountedMinor: "1000000",
      bankedOn: "2026-07-10",
      destination: "BOC current account",
    });
    const { id }: { id: string } = await created.json();
    ctx.trackCreatedBankingEvent(id);

    const res = await post(`/api/banking-event/${id}/void`, token, { reason: "x" });
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });
});

describe("POST /api/partner-payout/{id}/void (GAP-12)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — voids a payout, and a second call is refused as already voided", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const created = await post("/api/partner-payout", token, {
      userId: owner.userId,
      amountMinor: "500000",
      kind: "payout",
      occurredOn: "2026-07-10",
    });
    const { id }: { id: string } = await created.json();
    ctx.trackCreatedPartnerPayout(id);

    const res = await post(`/api/partner-payout/${id}/void`, token, { reason: "wrong amount" });
    expect(res.status).toBe(200);
    const body: VoidedBody = await res.json();
    expect(body.voidedAt).toBeTruthy();

    const second = await post(`/api/partner-payout/${id}/void`, token, { reason: "again" });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ code: "PARTNER_PAYOUT_ALREADY_VOIDED" });

    await ctx.cleanup();
  });

  it("404 — a payout belonging to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    await ctx.createOpenPeriod(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const otherOwner = await mintUser(db, ctx, otherBusinessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);
    const otherToken = await signAccessToken(otherOwner.asgardeoSub);

    const created = await post("/api/partner-payout", otherToken, {
      userId: otherOwner.userId,
      amountMinor: "500000",
      kind: "payout",
      occurredOn: "2026-07-10",
    });
    const { id }: { id: string } = await created.json();
    ctx.trackCreatedPartnerPayout(id);

    const res = await post(`/api/partner-payout/${id}/void`, token, { reason: "x" });
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });
});
