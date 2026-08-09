import { newId } from "@fleetsettle/shared";
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

async function listPayments(token: string, query = "") {
  return request(`/api/payment${query}`, bearer(token));
}

interface PaymentResponseBody {
  id: string;
  allocations: Array<{ obligationId: string; amountMinor: string }>;
  unallocatedMinor: string;
}

interface PaymentListRowBody {
  id: string;
  direction: "received" | "paid";
  partyType: "customer" | "driver" | "partner";
  partyCustomerId: string | null;
  partyDriverId: string | null;
  partyUserId: string | null;
  amountMinor: string;
  occurredOn: string;
  method: string | null;
  reference: string | null;
  status: "active" | "corrected" | "reversed";
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

  it("404 — GAP-93: partyType 'partner' is checked against this business too, not trusted outright from the request body", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postPayment(token, {
      partyType: "partner",
      partyId: newId(),
      amountMinor: "1000",
      occurredOn: "2026-07-15",
    });
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("happy path — a payment to an active partner of this business still succeeds", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const otherOwner = await mintUser(db, ctx, businessId, "owner_manager");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postPayment(token, {
      partyType: "partner",
      partyId: otherOwner.userId,
      amountMinor: "1000",
      occurredOn: "2026-07-15",
    });
    expect(res.status).toBe(201);
    const body: PaymentResponseBody = await res.json();
    ctx.trackCreatedPayment(body.id);

    await ctx.cleanup();
  });

  it("F-6.1/GAP-63 — direction: 'paid' settles what we owe the driver, never what he owes us", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    // He owes us (a short day) — must stay untouched by a "paid" payment.
    const owedToUs = await ctx.createObligation(businessId, periodId, {
      direction: "owed_to_us",
      driverId,
      amountMinor: 30_000n,
      dueOn: "2026-07-10",
    });
    // We owe him (a trip fee) — this is what "pay the driver" settles.
    const owedByUs = await ctx.createObligation(businessId, periodId, {
      direction: "owed_by_us",
      driverId,
      kind: "driver_fee",
      amountMinor: 90_000n,
      dueOn: "2026-07-12",
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postPayment(token, {
      direction: "paid",
      partyType: "driver",
      partyId: driverId,
      amountMinor: "90000",
      occurredOn: "2026-07-15",
    });
    expect(res.status).toBe(201);
    const body: PaymentResponseBody = await res.json();
    expect(body.allocations).toEqual([{ obligationId: owedByUs, amountMinor: "90000" }]);
    expect(body.allocations.map((a) => a.obligationId)).not.toContain(owedToUs);
    expect(body.unallocatedMinor).toBe("0");
    ctx.trackCreatedPayment(body.id);

    await ctx.cleanup();
  });

  it("F-6.1 — a 'paid' payment with nothing owed is held entirely as unallocated (a no-trip retainer or bonus)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postPayment(token, {
      direction: "paid",
      partyType: "driver",
      partyId: driverId,
      amountMinor: "15000",
      occurredOn: "2026-07-15",
    });
    expect(res.status).toBe(201);
    const body: PaymentResponseBody = await res.json();
    expect(body.allocations).toEqual([]);
    expect(body.unallocatedMinor).toBe("15000");
    ctx.trackCreatedPayment(body.id);

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

/** A3/GAP-38: `POST /api/payment/{id}/correct` has had no caller since P9 — F-8.2's own first step is "open the receipt". */
describe("GET /api/payment (A3, GAP-38)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — every payment for this business, newest first, filterable by party and date", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const customerId = await ctx.createCustomer(businessId);
    const driverId = await ctx.createDriver(businessId);
    await ctx.createObligation(businessId, periodId, {
      partyType: "customer",
      customerId,
      amountMinor: 70_000n,
      dueOn: "2026-07-12",
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const customerPaymentRes = await postPayment(token, {
      partyType: "customer",
      partyId: customerId,
      amountMinor: "70000",
      occurredOn: "2026-07-15",
    });
    expect(customerPaymentRes.status).toBe(201);
    const customerPaymentBody: PaymentResponseBody = await customerPaymentRes.json();
    ctx.trackCreatedPayment(customerPaymentBody.id);

    const driverPaymentRes = await postPayment(token, {
      partyType: "driver",
      partyId: driverId,
      amountMinor: "5000",
      occurredOn: "2026-07-20",
    });
    expect(driverPaymentRes.status).toBe(201);
    const driverPaymentBody: PaymentResponseBody = await driverPaymentRes.json();
    ctx.trackCreatedPayment(driverPaymentBody.id);

    const allRes = await listPayments(token);
    expect(allRes.status).toBe(200);
    const allBody: PaymentListRowBody[] = await allRes.json();
    // Newest first — the driver payment (20th) before the customer one (15th).
    expect(allBody.map((r) => r.id)).toEqual([driverPaymentBody.id, customerPaymentBody.id]);
    expect(allBody[0]).toMatchObject({
      id: driverPaymentBody.id,
      direction: "received",
      partyType: "driver",
      partyDriverId: driverId,
      partyCustomerId: null,
      amountMinor: "5000",
      occurredOn: "2026-07-20",
      status: "active",
    });

    const filteredRes = await listPayments(
      token,
      `?partyType=customer&partyCustomerId=${customerId}`,
    );
    expect(filteredRes.status).toBe(200);
    const filteredBody: PaymentListRowBody[] = await filteredRes.json();
    expect(filteredBody.map((r) => r.id)).toEqual([customerPaymentBody.id]);

    await ctx.cleanup();
  });

  it("scoping — a payment recorded against another business never appears", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherPeriodId = await ctx.createOpenPeriod(otherBusinessId);
    const otherCustomerId = await ctx.createCustomer(otherBusinessId);
    await ctx.createObligation(otherBusinessId, otherPeriodId, {
      partyType: "customer",
      customerId: otherCustomerId,
      amountMinor: 1_000n,
      dueOn: "2026-07-12",
    });
    const otherOwner = await mintUser(db, ctx, otherBusinessId, "owner");
    const otherToken = await signAccessToken(otherOwner.asgardeoSub);
    const otherPaymentRes = await postPayment(otherToken, {
      partyType: "customer",
      partyId: otherCustomerId,
      amountMinor: "1000",
      occurredOn: "2026-07-15",
    });
    expect(otherPaymentRes.status).toBe(201);
    const otherPaymentBody: PaymentResponseBody = await otherPaymentRes.json();
    ctx.trackCreatedPayment(otherPaymentBody.id);

    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await listPayments(token);
    expect(res.status).toBe(200);
    const body: PaymentListRowBody[] = await res.json();
    expect(body.map((r) => r.id)).not.toContain(otherPaymentBody.id);

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await listPayments("");
    expect(res.status).toBe(401);
  });

  it("403 — a linked driver cannot list payments (W-49)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await listPayments(token);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

    await ctx.cleanup();
  });
});
