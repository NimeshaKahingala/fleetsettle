import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { mintLinkedDriver, mintUser, signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

async function postPayment(token: string, body: unknown) {
  return request("/api/payment", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

interface PaymentResponseBody {
  id: string;
  allocations: Array<{ obligationId: string; amountMinor: string }>;
  unallocatedMinor: string;
}

/**
 * F-2.2/UC-11. §6.5's allocation discipline — oldest-`due_on`-first, the
 * same mechanic driver offsets already use (P4), generalised here to any
 * party owed_to_us. Customer rent is the first real user of it.
 */
describe("record a payment (P5, F-2.2/UC-11)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — a full payment settles a single due", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const customerId = await ctx.createCustomer(businessId);
    const obligationId = await ctx.createObligation(businessId, periodId, {
      partyType: "customer",
      customerId,
      amountMinor: 70_000n,
      dueOn: "2026-07-12",
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postPayment(token, {
      partyType: "customer",
      partyId: customerId,
      amountMinor: "70000",
      occurredOn: "2026-07-15",
    });
    expect(res.status).toBe(201);
    const body: PaymentResponseBody = await res.json();
    expect(body.allocations).toEqual([{ obligationId, amountMinor: "70000" }]);
    expect(body.unallocatedMinor).toBe("0");
    ctx.trackCreatedPayment(body.id);

    await ctx.cleanup();
  });

  it("§6.5 — oldest due first, across two obligations, with a surplus held unallocated", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const customerId = await ctx.createCustomer(businessId);
    const older = await ctx.createObligation(businessId, periodId, {
      partyType: "customer",
      customerId,
      amountMinor: 70_000n,
      dueOn: "2026-06-12",
    });
    const newer = await ctx.createObligation(businessId, periodId, {
      partyType: "customer",
      customerId,
      amountMinor: 70_000n,
      dueOn: "2026-07-12",
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    // 100,000 covers the older due (70,000) in full, part-pays the newer
    // one (30,000 of 70,000), and leaves nothing over.
    const res = await postPayment(token, {
      partyType: "customer",
      partyId: customerId,
      amountMinor: "100000",
      occurredOn: "2026-07-15",
    });
    expect(res.status).toBe(201);
    const body: PaymentResponseBody = await res.json();
    expect(body.allocations).toEqual([
      { obligationId: older, amountMinor: "70000" },
      { obligationId: newer, amountMinor: "30000" },
    ]);
    expect(body.unallocatedMinor).toBe("0");
    ctx.trackCreatedPayment(body.id);

    await ctx.cleanup();
  });

  it("a surplus beyond every outstanding due is held as unallocated credit, never dropped", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const customerId = await ctx.createCustomer(businessId);
    const obligationId = await ctx.createObligation(businessId, periodId, {
      partyType: "customer",
      customerId,
      amountMinor: 70_000n,
      dueOn: "2026-07-12",
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postPayment(token, {
      partyType: "customer",
      partyId: customerId,
      amountMinor: "90000",
      occurredOn: "2026-07-15",
    });
    expect(res.status).toBe(201);
    const body: PaymentResponseBody = await res.json();
    expect(body.allocations).toEqual([{ obligationId, amountMinor: "70000" }]);
    expect(body.unallocatedMinor).toBe("20000");
    ctx.trackCreatedPayment(body.id);

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await postPayment("", {
      partyType: "customer",
      partyId: "11111111-1111-4111-8111-111111111111",
      amountMinor: "1",
      occurredOn: "2026-07-15",
    });
    expect(res.status).toBe(401);
  });

  it("403 — a linked driver cannot record a payment", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await postPayment(token, {
      partyType: "driver",
      partyId: driverId,
      amountMinor: "1",
      occurredOn: "2026-07-15",
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

    const res = await postPayment(token, {
      partyType: "customer",
      partyId: otherCustomerId,
      amountMinor: "1000",
      occurredOn: "2026-07-15",
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

    const res = await postPayment(token, {
      partyType: "customer",
      partyId: customerId,
      amountMinor: "1000",
      occurredOn: "2026-07-15",
    });
    expect(res.status).toBe(409);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "PERIOD_CLOSED" });

    await ctx.cleanup();
  });
});
