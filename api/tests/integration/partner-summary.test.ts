import { newId } from "@fleetsettle/shared";
import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { ownershipShare, payment } from "../../src/db/schema.js";
import { mintUser, signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

async function getSummary(userId: string, token: string) {
  return request(`/api/partner/${userId}`, bearer(token));
}

async function post(path: string, token: string, body: unknown) {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

interface SummaryBody {
  userId: string;
  displayName: string | null;
  period: { id: string; periodStart: string; periodEnd: string };
  putIn: { contributionsMinor: string; outOfPocketMinor: string };
  takenOut: { payoutsMinor: string; settlementsMinor: string };
  earned: { profitShareMinor: string; managementFeeMinor: string };
  holdingMinor: string;
  balanceMinor: string;
}

/** A2/GAP-9/GAP-4 test matrix — UC-67, W-52, W-53. */
describe("GET /api/partner/{userId} (A2, UC-67/W-52/W-53)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — put in, taken out, earned this period, and holding; the W-52 claim never moves the profit split", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const vehicleA = await ctx.createVehicle(businessId, { registration: "A-1111" });
    const vehicleB = await ctx.createVehicle(businessId, { registration: "B-2222" });
    const customerId = await ctx.createCustomer(businessId);
    const owner1 = await mintUser(db, ctx, businessId, "owner");
    const owner2 = await mintUser(db, ctx, businessId, "owner_manager");
    const owner1Token = await signAccessToken(owner1.asgardeoSub);
    const owner2Token = await signAccessToken(owner2.asgardeoSub);

    // Vehicle A: 50,000 earned, 9,000 cost (paid out of owner1's own pocket)
    // — 41,000 profit, split exactly 50/50 (20,500 each), regardless of
    // who paid for what or who put in how much.
    await ctx.createObligation(businessId, periodId, {
      direction: "owed_to_us",
      partyType: "customer",
      customerId,
      vehicleId: vehicleA,
      kind: "rent",
      amountMinor: 50_000n,
      dueOn: "2026-07-01",
    });
    const costExpense = await post("/api/expense", owner1Token, {
      vehicleId: vehicleA,
      category: "other",
      amountMinor: "9000",
      spentOn: "2026-07-10",
      borneBy: "us",
      paidByUserId: owner1.userId,
    });
    expect(costExpense.status).toBe(201);
    const costExpenseBody: { id: string } = await costExpense.json();
    ctx.trackCreatedExpense(costExpenseBody.id);

    const share1Id = newId();
    const share2Id = newId();
    await db.insert(ownershipShare).values([
      {
        id: share1Id,
        vehicleId: vehicleA,
        userId: owner1.userId,
        shareBp: 5000,
        effectiveFrom: "2026-01-01",
      },
      {
        id: share2Id,
        vehicleId: vehicleA,
        userId: owner2.userId,
        shareBp: 5000,
        effectiveFrom: "2026-01-01",
      },
    ]);
    ctx.trackCreatedOwnershipShares([share1Id, share2Id]);

    // Owner1 manages vehicle B for a fee — a different vehicle from the one
    // he owns a share of, so owning and managing are never conflated.
    const granted = await post("/api/management-fee-agreement", owner2Token, {
      vehicleId: vehicleB,
      managerUserId: owner1.userId,
      monthlyFeeMinor: "15000",
      effectiveFrom: "2026-01-01",
    });
    expect(granted.status).toBe(201);
    const grantedBody: { id: string } = await granted.json();
    ctx.trackCreatedManagementFeeAgreement(grantedBody.id);

    // Owner1 puts in far more than his 50% share would suggest — the whole
    // point of W-52 is that this buys a claim, never a bigger slice.
    const contribution = await post("/api/capital-contribution", owner2Token, {
      userId: owner1.userId,
      amountMinor: "500000",
      contributedOn: "2026-07-05",
    });
    expect(contribution.status).toBe(201);
    const contributionBody: { id: string } = await contribution.json();
    ctx.trackCreatedCapitalContribution(contributionBody.id);

    const payout = await post("/api/partner-payout", owner2Token, {
      userId: owner1.userId,
      amountMinor: "5000",
      kind: "payout",
      occurredOn: "2026-07-12",
    });
    const payoutBody: { id: string } = await payout.json();
    ctx.trackCreatedPartnerPayout(payoutBody.id);
    const settlement = await post("/api/partner-payout", owner2Token, {
      userId: owner1.userId,
      amountMinor: "3000",
      kind: "partner_settlement",
      occurredOn: "2026-07-13",
    });
    const settlementBody: { id: string } = await settlement.json();
    ctx.trackCreatedPartnerPayout(settlementBody.id);

    // Holding: 30,000 received, 10,000 banked out — 20,000 still held.
    const paymentId = newId();
    await db.insert(payment).values({
      id: paymentId,
      businessId,
      direction: "received",
      partyType: "customer",
      partyCustomerId: customerId,
      amountMinor: 30_000n,
      occurredOn: "2026-07-05",
      handledByUserId: owner1.userId,
      postedPeriodId: periodId,
    });
    ctx.trackCreatedPayment(paymentId);
    const bankingRes = await post("/api/banking-event", owner1Token, {
      amountRecordedMinor: "10000",
      amountCountedMinor: "10000",
      bankedOn: "2026-07-06",
      destination: "BOC current account",
    });
    const bankingResBody: { id: string } = await bankingRes.json();
    ctx.trackCreatedBankingEvent(bankingResBody.id);

    // Viewed by the *other* partner — "one page per partner," reachable by
    // any owner, not only by the partner it describes.
    const res = await getSummary(owner1.userId, owner2Token);
    expect(res.status).toBe(200);
    const body: SummaryBody = await res.json();

    expect(body.period.id).toBe(periodId);
    expect(body.displayName).toBe("Test owner");
    expect(body.putIn).toMatchObject({ contributionsMinor: "500000", outOfPocketMinor: "9000" });
    expect(body.takenOut).toMatchObject({ payoutsMinor: "5000", settlementsMinor: "3000" });
    // The W-52 assertion: half of 41,000 profit, not inflated by the
    // 500,000 he put in.
    expect(body.earned).toMatchObject({ profitShareMinor: "20500", managementFeeMinor: "15000" });
    expect(body.holdingMinor).toBe("20000");
    // GAP-74: with only the one open period on record, all-time earned
    // equals this period's earned (20,500 + 15,000 = 35,500) — the real
    // test of the loop crossing a closed period is its own case below.
    // 500,000 + 9,000 + 35,500 − 5,000 − 3,000.
    expect(body.balanceMinor).toBe("536500");

    await ctx.cleanup();
  });

  it("GAP-74: balanceMinor sums profit share across a closed period and the open one — earned stays open-period-only", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const junePeriodId = await ctx.createOpenPeriod(businessId, {
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
    });

    const vehicleId = await ctx.createVehicle(businessId);
    const customerId = await ctx.createCustomer(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const ownerToken = await signAccessToken(owner.asgardeoSub);

    const shareId = newId();
    await db.insert(ownershipShare).values({
      id: shareId,
      vehicleId,
      userId: owner.userId,
      shareBp: 10_000,
      effectiveFrom: "2026-01-01",
    });
    ctx.trackCreatedOwnershipShares([shareId]);

    // June: 50,000 profit, wholly his — posted while June is still open
    // (assert_period_open() forbids posting into a closed one, W-35), then
    // closed. GAP-74's own point is that nothing before this fix could ever
    // add a closed period's share back in.
    await ctx.createObligation(businessId, junePeriodId, {
      direction: "owed_to_us",
      partyType: "customer",
      customerId,
      vehicleId,
      kind: "rent",
      amountMinor: 50_000n,
      dueOn: "2026-06-01",
    });
    await ctx.closePeriod(junePeriodId);

    // `one_open_period` is a real constraint — only legal to open July once
    // June is no longer open.
    const julyPeriodId = await ctx.createOpenPeriod(businessId, {
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
    });
    // July (open): 20,000 profit — this is the figure `earned` alone shows.
    await ctx.createObligation(businessId, julyPeriodId, {
      direction: "owed_to_us",
      partyType: "customer",
      customerId,
      vehicleId,
      kind: "rent",
      amountMinor: 20_000n,
      dueOn: "2026-07-01",
    });

    const res = await getSummary(owner.userId, ownerToken);
    expect(res.status).toBe(200);
    const body: SummaryBody = await res.json();

    expect(body.period.id).toBe(julyPeriodId);
    expect(body.earned.profitShareMinor).toBe("20000");
    expect(body.balanceMinor).toBe("70000");

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request(`/api/partner/${newId()}`);
    expect(res.status).toBe(401);
  });

  it("403 — a manager cannot read a partner's summary", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const manager = await mintUser(db, ctx, businessId, "manager");
    const token = await signAccessToken(manager.asgardeoSub);

    const res = await getSummary(manager.userId, token);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

    await ctx.cleanup();
  });

  it("404 — the user is not a member of this business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);
    const stranger = await mintUser(db, ctx, await ctx.createBusiness({ name: "Other" }), "owner");

    const res = await getSummary(stranger.userId, token);
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("404 — no open accounting period for this business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await getSummary(owner.userId, token);
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });
});
