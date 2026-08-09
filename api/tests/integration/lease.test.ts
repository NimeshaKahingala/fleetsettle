import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { mintLinkedDriver, mintUser, signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

async function postLease(token: string, body: unknown) {
  return request("/api/lease", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

async function getLease(token: string, id: string) {
  return request(`/api/lease/${id}`, bearer(token));
}

async function renewLease(token: string, id: string, body: unknown) {
  return request(`/api/lease/${id}/renew`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

async function generateBillingPeriod(token: string, id: string) {
  return request(`/api/lease/${id}/billing-period`, {
    method: "POST",
    headers: bearer(token).headers,
  });
}

async function getLeaseObligations(token: string, id: string) {
  return request(`/api/lease/${id}/obligation`, bearer(token));
}

async function getLeaseDeposit(token: string, id: string) {
  return request(`/api/lease/${id}/deposit`, bearer(token));
}

/**
 * F-2.1 / UC-10 test matrix. Since P5, starting a lease also writes the
 * handover odometer reading (when a mileage limit is set) and generates the
 * first billing period, raising its rent due — domain/lease.ts — so it now
 * requires an open accounting period the way every other money write does.
 * DM §4.1 still attributes arrangement A's vehicle_day_allocation calendar
 * to a rolling-horizon cron (P13), so there is no INV-1 case here yet (see
 * route-defs/lease.ts).
 */
describe("start a lease (P2, F-2.1/UC-10)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — a 12th-of-the-month lease keeps its start date exactly", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId, { periodStart: "2026-01-01", periodEnd: "2026-12-31" });
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "A");
    const customerId = await ctx.createCustomer(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postLease(token, {
      vehicleId,
      customerId,
      startDate: "2026-01-12",
      billingDay: 12,
      rentAmountMinor: "5000000",
      mileageDailyLimitKm: 100,
      mileageExcessRateMinor: "5000",
      reminderDaysBefore: 3,
      odometerReadingKm: 0,
      odometerSource: "in_person",
    });
    expect(res.status).toBe(201);
    const body: { id: string } = await res.json();
    expect(body).toMatchObject({
      vehicleId,
      customerId,
      status: "active",
      startDate: "2026-01-12",
      endDate: null,
      billingDay: 12,
      rentAmountMinor: "5000000",
      mileageDailyLimitKm: 100,
      mileageExcessRateMinor: "5000",
    });
    ctx.trackCreatedLease(body.id);

    const getRes = await getLease(token, body.id);
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toMatchObject({ id: body.id, startDate: "2026-01-12" });

    await ctx.cleanup();
  });

  it("409 — the vehicle is not configured for arrangement A (GAP-84)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId, { periodStart: "2026-01-01", periodEnd: "2026-12-31" });
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "C");
    const customerId = await ctx.createCustomer(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postLease(token, {
      vehicleId,
      customerId,
      startDate: "2026-01-12",
      billingDay: 12,
      rentAmountMinor: "5000000",
    });
    expect(res.status).toBe(409);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "VEHICLE_ARRANGEMENT_MISMATCH" });

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request("/api/lease", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "MISSING_TOKEN" });
  });

  it("403 — a linked driver cannot start a lease", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "A");
    const customerId = await ctx.createCustomer(businessId);
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await postLease(token, {
      vehicleId,
      customerId,
      startDate: "2026-01-01",
      billingDay: 1,
      rentAmountMinor: "5000000",
    });
    expect(res.status).toBe(403);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

    await ctx.cleanup();
  });

  it("404 — the vehicle belongs to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherVehicleId = await ctx.createVehicle(otherBusinessId);
    const customerId = await ctx.createCustomer(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postLease(token, {
      vehicleId: otherVehicleId,
      customerId,
      startDate: "2026-01-01",
      billingDay: 1,
      rentAmountMinor: "5000000",
    });
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("404 — the customer belongs to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "A");
    const otherCustomerId = await ctx.createCustomer(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postLease(token, {
      vehicleId,
      customerId: otherCustomerId,
      startDate: "2026-01-01",
      billingDay: 1,
      rentAmountMinor: "5000000",
    });
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("409 — no accounting period open yet rejects the first rent due", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "A");
    const customerId = await ctx.createCustomer(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postLease(token, {
      vehicleId,
      customerId,
      startDate: "2026-01-01",
      billingDay: 1,
      rentAmountMinor: "5000000",
    });
    expect(res.status).toBe(409);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "PERIOD_CLOSED" });

    await ctx.cleanup();
  });
});

/** F-2.5/UC-17. Old periods keep their old figure — only the next generated period picks up a renewal. */
describe("renew a lease (P5, F-2.5/UC-17)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — a new rent applies only to periods generated from now on", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId, { periodStart: "2026-01-01", periodEnd: "2026-12-31" });
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "A");
    const customerId = await ctx.createCustomer(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const leaseRes = await postLease(token, {
      vehicleId,
      customerId,
      startDate: "2026-01-12",
      billingDay: 12,
      rentAmountMinor: "70000",
    });
    const { id: leaseId }: { id: string } = await leaseRes.json();
    ctx.trackCreatedLease(leaseId);

    const renewRes = await renewLease(token, leaseId, { rentAmountMinor: "80000" });
    expect(renewRes.status).toBe(200);
    expect(await renewRes.json()).toMatchObject({ id: leaseId, rentAmountMinor: "80000" });

    const period1Res = await request(`/api/lease/${leaseId}/billing-period`, bearer(token));
    const periods: Array<{ seq: number; rentAmountMinor: string }> = await period1Res.json();
    expect(periods).toHaveLength(1);
    expect(periods[0]).toMatchObject({ seq: 1, rentAmountMinor: "70000" });

    const period2Res = await generateBillingPeriod(token, leaseId);
    expect(period2Res.status).toBe(201);
    expect(await period2Res.json()).toMatchObject({ seq: 2, rentAmountMinor: "80000" });

    await ctx.cleanup();
  });

  it("404 — the lease belongs to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherVehicleId = await ctx.createVehicle(otherBusinessId);
    const otherCustomerId = await ctx.createCustomer(otherBusinessId);
    const otherLeaseId = await ctx.createLease(otherBusinessId, otherVehicleId, otherCustomerId, {
      status: "active",
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await renewLease(token, otherLeaseId, { rentAmountMinor: "80000" });
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });
});

/**
 * F-2.1's invisible step, made callable — one call advances the schedule by
 * exactly one period (this endpoint has no notion of "today"; deciding
 * *when* to call it is P13's cron's job once it exists, not this domain
 * function's). The idempotency `generateNextBillingPeriodTx` actually
 * provides is DB-level: two *concurrent* calls racing for the same next
 * `seq` collide on `billing_period_lease_id_seq_key`, and the loser reads
 * back the winner's row rather than erroring — not re-tested here, since
 * forcing a real race deterministically through the HTTP layer is not
 * reliable; confirmDay's identical pattern (P3) already exercises the same
 * catch-and-replay mechanics against a natural key.
 */
describe("generate the next billing period (P5)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("advances the schedule by one period per call — seq 2, then seq 3", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId, { periodStart: "2026-01-01", periodEnd: "2026-12-31" });
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "A");
    const customerId = await ctx.createCustomer(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const leaseRes = await postLease(token, {
      vehicleId,
      customerId,
      startDate: "2026-01-12",
      billingDay: 12,
      rentAmountMinor: "70000",
    });
    const { id: leaseId }: { id: string } = await leaseRes.json();
    ctx.trackCreatedLease(leaseId);

    const first = await generateBillingPeriod(token, leaseId);
    expect(first.status).toBe(201);
    const firstBody: { id: string; seq: number } = await first.json();
    expect(firstBody.seq).toBe(2);

    const second = await generateBillingPeriod(token, leaseId);
    expect(second.status).toBe(201);
    const secondBody: { id: string; seq: number } = await second.json();
    expect(secondBody.seq).toBe(3);
    expect(secondBody.id).not.toBe(firstBody.id);

    await ctx.cleanup();
  });

  it("400 — a draft lease generates no billing periods", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId, { periodStart: "2026-01-01", periodEnd: "2026-12-31" });
    const vehicleId = await ctx.createVehicle(businessId);
    const customerId = await ctx.createCustomer(businessId);
    const leaseId = await ctx.createLease(businessId, vehicleId, customerId, { status: "draft" });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await generateBillingPeriod(token, leaseId);
    expect(res.status).toBe(400);

    await ctx.cleanup();
  });

  it("404 — the lease belongs to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherVehicleId = await ctx.createVehicle(otherBusinessId);
    const otherCustomerId = await ctx.createCustomer(otherBusinessId);
    const otherLeaseId = await ctx.createLease(otherBusinessId, otherVehicleId, otherCustomerId, {
      status: "active",
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await generateBillingPeriod(token, otherLeaseId);
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });
});

/**
 * Web-P6b's lease hub: every due a lease has ever raised, from all three of
 * its source paths — a rent due (`sourceType: billing_period`), a mileage
 * excess due (`sourceType: mileage_assessment`) and a post-closure charge
 * billed directly against the lease (`sourceType: lease`, F-8.4). There is
 * deliberately no `lease_id` column on `obligation` itself, so this is the
 * one test proving the three-way join actually reassembles them as one list
 * rather than each staying invisible to the others.
 */
describe("a lease's dues (Web-P6a, GET /{id}/obligation)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — rent, mileage-excess and post-closure-charge dues, oldest first", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId, {
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
    });
    const vehicleId = await ctx.createVehicle(businessId);
    const customerId = await ctx.createCustomer(businessId);
    const leaseId = await ctx.createLease(businessId, vehicleId, customerId, { status: "active" });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const billingPeriodId = await ctx.createBillingPeriod(leaseId, {
      periodStart: "2026-03-12",
      periodEnd: "2026-04-11",
    });
    await ctx.createObligation(businessId, periodId, {
      partyType: "customer",
      customerId,
      kind: "rent",
      sourceType: "billing_period",
      sourceId: billingPeriodId,
      amountMinor: 70_000_00n,
      settledMinor: 70_000_00n,
      dueOn: "2026-03-12",
      status: "paid",
    });

    const readingId = await ctx.createOdometerReading(businessId, vehicleId, 5_000, "2026-04-11", {
      leaseId,
    });
    const assessmentId = await ctx.createMileageAssessment(
      businessId,
      leaseId,
      periodId,
      readingId,
    );
    await ctx.createObligation(businessId, periodId, {
      partyType: "customer",
      customerId,
      kind: "mileage_excess",
      sourceType: "mileage_assessment",
      sourceId: assessmentId,
      amountMinor: 5_000_00n,
      dueOn: "2026-04-11",
      status: "pending",
    });

    await ctx.createObligation(businessId, periodId, {
      partyType: "customer",
      customerId,
      kind: "post_closure_charge",
      sourceType: "lease",
      sourceId: leaseId,
      amountMinor: 1_500_00n,
      dueOn: "2026-05-01",
      status: "pending",
    });

    const res = await getLeaseObligations(token, leaseId);
    expect(res.status).toBe(200);
    const body: Array<{ kind: string; dueOn: string; amountMinor: string; status: string }> =
      await res.json();

    expect(body).toHaveLength(3);
    expect(body.map((o) => o.kind)).toEqual(["rent", "mileage_excess", "post_closure_charge"]);
    expect(body[0]).toMatchObject({ dueOn: "2026-03-12", amountMinor: "7000000", status: "paid" });
    expect(body[2]).toMatchObject({ dueOn: "2026-05-01", amountMinor: "150000" });

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request(`/api/lease/${crypto.randomUUID()}/obligation`);
    expect(res.status).toBe(401);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "MISSING_TOKEN" });
  });

  it("403 — a linked driver cannot read a lease's dues (dailyOperations is STAFF-only)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const customerId = await ctx.createCustomer(businessId);
    const leaseId = await ctx.createLease(businessId, vehicleId, customerId);
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await getLeaseObligations(token, leaseId);
    expect(res.status).toBe(403);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

    await ctx.cleanup();
  });

  it("404 — a lease belonging to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherVehicleId = await ctx.createVehicle(otherBusinessId);
    const otherCustomerId = await ctx.createCustomer(otherBusinessId);
    const otherLeaseId = await ctx.createLease(otherBusinessId, otherVehicleId, otherCustomerId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await getLeaseObligations(token, otherLeaseId);
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });
});

/**
 * Web-P6d's closure wizard: whether this lease has a deposit at all, and
 * its current held balance (the SUM of movements, DM §10.4 — never a
 * stored figure). F-2.1's own Alternates says "no deposit taken" is
 * normal, so a lease with none is its own case, not an error.
 */
describe("a lease's deposit (Web-P6d, GET /{id}/deposit)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("null when no deposit was ever taken", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const customerId = await ctx.createCustomer(businessId);
    const leaseId = await ctx.createLease(businessId, vehicleId, customerId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await getLeaseDeposit(token, leaseId);
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();

    await ctx.cleanup();
  });

  it("the held balance is the sum of movements, not a stored figure", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const customerId = await ctx.createCustomer(businessId);
    const leaseId = await ctx.createLease(businessId, vehicleId, customerId);
    const depositId = await ctx.createDeposit(businessId, {
      customerId,
      leaseId,
      status: "held",
    });
    await ctx.createDepositMovement(businessId, periodId, depositId, {
      movementType: "taken",
      amountMinor: 30_000_00n,
    });
    await ctx.createDepositMovement(businessId, periodId, depositId, {
      movementType: "applied",
      amountMinor: 5_000_00n,
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await getLeaseDeposit(token, leaseId);
    expect(res.status).toBe(200);
    const body: { id: string; status: string; heldMinor: string; holdReleaseDate: string | null } =
      await res.json();
    expect(body).toMatchObject({ id: depositId, status: "held", heldMinor: "2500000" });

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request(`/api/lease/${crypto.randomUUID()}/deposit`);
    expect(res.status).toBe(401);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "MISSING_TOKEN" });
  });

  it("403 — a linked driver cannot read a lease's deposit (leaseAndTripLifecycle is STAFF-only)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const customerId = await ctx.createCustomer(businessId);
    const leaseId = await ctx.createLease(businessId, vehicleId, customerId);
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await getLeaseDeposit(token, leaseId);
    expect(res.status).toBe(403);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

    await ctx.cleanup();
  });

  it("404 — a lease belonging to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherVehicleId = await ctx.createVehicle(otherBusinessId);
    const otherCustomerId = await ctx.createCustomer(otherBusinessId);
    const otherLeaseId = await ctx.createLease(otherBusinessId, otherVehicleId, otherCustomerId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await getLeaseDeposit(token, otherLeaseId);
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });
});
