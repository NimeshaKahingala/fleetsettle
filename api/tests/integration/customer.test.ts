import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { mintLinkedDriver, mintUser, signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

async function postCustomer(token: string, body: unknown) {
  return request("/api/customer", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

async function getCustomer(token: string, id: string) {
  return request(`/api/customer/${id}`, bearer(token));
}

async function listCustomers(token: string) {
  return request("/api/customer", bearer(token));
}

async function getCustomerObligations(token: string, id: string) {
  return request(`/api/customer/${id}/obligation`, bearer(token));
}

async function getCustomerPayments(token: string, id: string) {
  return request(`/api/customer/${id}/payment`, bearer(token));
}

async function postPayment(token: string, body: unknown) {
  return request("/api/payment", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

interface CustomerObligationRowBody {
  id: string;
  kind: string;
  dueOn: string;
  amountMinor: string;
  settledMinor: string;
  waivedMinor: string;
  status: string;
}

interface PaymentListRowBody {
  id: string;
  partyType: "customer" | "driver" | "partner";
  partyCustomerId: string | null;
  amountMinor: string;
  occurredOn: string;
}

/**
 * F-2.1 / UC-10 / W-55 test matrix. 401 and 403 are proven once here rather
 * than per route — all three routes share the same `authMiddleware` chain
 * and the same `manageEntities` capability check (already exhaustively
 * covered for the middleware itself in auth.test.ts).
 */
describe("customer CRUD (P2, F-2.1/UC-10, W-55)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — a person with an NIC", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postCustomer(token, {
      customerType: "person",
      name: "Anura Bandara",
      nic: "912345678V",
      mobile: "0771234567",
      address: "12 Galle Road, Colombo",
    });
    expect(res.status).toBe(201);
    const body: { id: string } = await res.json();
    expect(body).toMatchObject({
      customerType: "person",
      name: "Anura Bandara",
      nic: "912345678V",
      registrationNo: null,
    });
    ctx.trackCreatedCustomer(body.id);

    const getRes = await getCustomer(token, body.id);
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toMatchObject({ id: body.id, name: "Anura Bandara" });

    await ctx.cleanup();
  });

  it("happy path — an organisation with a registration number and no NIC field at all", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postCustomer(token, {
      customerType: "organisation",
      name: "Lanka Tours (Pvt) Ltd",
      registrationNo: "PV00123456",
      contactPerson: "Nadeesha Fernando",
    });
    expect(res.status).toBe(201);
    const body: { id: string } = await res.json();
    expect(body).toMatchObject({
      customerType: "organisation",
      name: "Lanka Tours (Pvt) Ltd",
      registrationNo: "PV00123456",
      contactPerson: "Nadeesha Fernando",
      nic: null,
    });
    ctx.trackCreatedCustomer(body.id);

    await ctx.cleanup();
  });

  it("400 — a person with neither an NIC nor a mobile (DM §5's CHECK constraint, mirrored in the schema)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postCustomer(token, { customerType: "person", name: "Nobody's Number" });
    expect(res.status).toBe(400);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "VALIDATION_ERROR" });

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request("/api/customer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerType: "person", name: "No Token", mobile: "0770000000" }),
    });
    expect(res.status).toBe(401);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "MISSING_TOKEN" });
  });

  it("403 — a linked driver cannot add a customer (W-3: a driver enters nothing)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await postCustomer(token, {
      customerType: "person",
      name: "Someone New",
      mobile: "0770000001",
    });
    expect(res.status).toBe(403);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

    await ctx.cleanup();
  });

  it("404 — a customer belonging to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherCustomerId = await ctx.createCustomer(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await getCustomer(token, otherCustomerId);
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("list — returns only this business's customers", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const ownCustomerId = await ctx.createCustomer(businessId, { name: "Own Customer" });
    await ctx.createCustomer(otherBusinessId, { name: "Other Customer" });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await listCustomers(token);
    expect(res.status).toBe(200);
    const body: Array<{ id: string; name: string }> = await res.json();
    expect(body.map((cust) => cust.id)).toEqual([ownCustomerId]);
    expect(body[0]).toMatchObject({ name: "Own Customer" });

    await ctx.cleanup();
  });
});

/**
 * A4/GAP-22: the customer detail screen's dues and payments —
 * `findOutstandingObligationsForParty`, the same query `recordPayment`
 * allocates through, reused rather than a second party-scoped read.
 */
describe("GET /api/customer/{id}/obligation and /payment (A4, GAP-22)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("obligation happy path — outstanding dues only, oldest due first, a fully paid one excluded", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const customerId = await ctx.createCustomer(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    await ctx.createObligation(businessId, periodId, {
      partyType: "customer",
      customerId,
      kind: "rent",
      amountMinor: 70_000_00n,
      settledMinor: 70_000_00n,
      dueOn: "2026-06-12",
      status: "paid",
    });
    const partPaidId = await ctx.createObligation(businessId, periodId, {
      partyType: "customer",
      customerId,
      kind: "rent",
      amountMinor: 70_000_00n,
      settledMinor: 20_000_00n,
      dueOn: "2026-07-12",
      status: "part_paid",
    });
    const pendingId = await ctx.createObligation(businessId, periodId, {
      partyType: "customer",
      customerId,
      kind: "mileage_excess",
      amountMinor: 5_000_00n,
      dueOn: "2026-08-11",
      status: "pending",
    });

    const res = await getCustomerObligations(token, customerId);
    expect(res.status).toBe(200);
    const body: CustomerObligationRowBody[] = await res.json();

    expect(body.map((o) => o.id)).toEqual([partPaidId, pendingId]);
    expect(body[0]).toMatchObject({
      dueOn: "2026-07-12",
      amountMinor: "7000000",
      settledMinor: "2000000",
      status: "part_paid",
    });
    expect(body[1]).toMatchObject({
      dueOn: "2026-08-11",
      amountMinor: "500000",
      status: "pending",
    });

    await ctx.cleanup();
  });

  it("obligation scoping — another business's customer's dues never appear, and 404s by id", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherPeriodId = await ctx.createOpenPeriod(otherBusinessId);
    const otherCustomerId = await ctx.createCustomer(otherBusinessId);
    await ctx.createObligation(otherBusinessId, otherPeriodId, {
      partyType: "customer",
      customerId: otherCustomerId,
      amountMinor: 1_000n,
      dueOn: "2026-07-12",
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await getCustomerObligations(token, otherCustomerId);
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("obligation 401 — missing Authorization header", async () => {
    const res = await request(`/api/customer/${crypto.randomUUID()}/obligation`);
    expect(res.status).toBe(401);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "MISSING_TOKEN" });
  });

  it("obligation 403 — a linked driver cannot read a customer's dues (dailyOperations is STAFF-only)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const customerId = await ctx.createCustomer(businessId);
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await getCustomerObligations(token, customerId);
    expect(res.status).toBe(403);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

    await ctx.cleanup();
  });

  it("payment happy path — every payment this customer has made, newest first", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const customerId = await ctx.createCustomer(businessId);
    const otherCustomerId = await ctx.createCustomer(businessId, { name: "Someone Else" });
    await ctx.createObligation(businessId, periodId, {
      partyType: "customer",
      customerId,
      amountMinor: 70_000n,
      dueOn: "2026-07-12",
    });
    await ctx.createObligation(businessId, periodId, {
      partyType: "customer",
      customerId: otherCustomerId,
      amountMinor: 1_000n,
      dueOn: "2026-07-12",
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const earlierRes = await postPayment(token, {
      partyType: "customer",
      partyId: customerId,
      amountMinor: "30000",
      occurredOn: "2026-07-10",
    });
    expect(earlierRes.status).toBe(201);
    const earlierBody: { id: string } = await earlierRes.json();
    ctx.trackCreatedPayment(earlierBody.id);

    const laterRes = await postPayment(token, {
      partyType: "customer",
      partyId: customerId,
      amountMinor: "40000",
      occurredOn: "2026-07-15",
    });
    expect(laterRes.status).toBe(201);
    const laterBody: { id: string } = await laterRes.json();
    ctx.trackCreatedPayment(laterBody.id);

    const otherRes = await postPayment(token, {
      partyType: "customer",
      partyId: otherCustomerId,
      amountMinor: "1000",
      occurredOn: "2026-07-15",
    });
    expect(otherRes.status).toBe(201);
    const otherBody: { id: string } = await otherRes.json();
    ctx.trackCreatedPayment(otherBody.id);

    const res = await getCustomerPayments(token, customerId);
    expect(res.status).toBe(200);
    const body: PaymentListRowBody[] = await res.json();
    expect(body.map((p) => p.id)).toEqual([laterBody.id, earlierBody.id]);
    expect(body[0]).toMatchObject({
      partyType: "customer",
      partyCustomerId: customerId,
      amountMinor: "40000",
      occurredOn: "2026-07-15",
    });

    await ctx.cleanup();
  });

  it("payment scoping — another business's customer's payments never appear, and 404s by id", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherCustomerId = await ctx.createCustomer(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await getCustomerPayments(token, otherCustomerId);
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("payment 401 — missing Authorization header", async () => {
    const res = await request(`/api/customer/${crypto.randomUUID()}/payment`);
    expect(res.status).toBe(401);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "MISSING_TOKEN" });
  });

  it("payment 403 — a linked driver cannot read a customer's payments (dailyOperations is STAFF-only)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const customerId = await ctx.createCustomer(businessId);
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await getCustomerPayments(token, customerId);
    expect(res.status).toBe(403);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

    await ctx.cleanup();
  });
});
