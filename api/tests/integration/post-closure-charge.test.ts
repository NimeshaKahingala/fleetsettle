import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { mintLinkedDriver, mintUser, signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

async function postPostClosureCharge(token: string, body: unknown) {
  return request("/api/post-closure-charge", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

interface PostClosureChargeResponseBody {
  obligationId: string;
  amountMinor: string;
  status: string;
}

/**
 * F-8.4/UC-91/W-29 test matrix. A fine or toll arriving weeks after the
 * lease or trip has already closed still creates an outstanding balance —
 * this endpoint deliberately never checks whether `sourceId` is itself
 * closed, which is the whole point of the flow.
 */
describe("charge something after everything has closed (P10, F-8.4/UC-91)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — against an already-closed lease", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const customerId = await ctx.createCustomer(businessId);
    const leaseId = await ctx.createLease(businessId, vehicleId, customerId, {
      status: "closed",
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postPostClosureCharge(token, {
      partyType: "customer",
      partyCustomerId: customerId,
      vehicleId,
      sourceType: "lease",
      sourceId: leaseId,
      amountMinor: "500000",
      dueOn: "2026-08-05",
      note: "camera fine, arrived three weeks after the car went back",
    });
    expect(res.status).toBe(201);
    const body: PostClosureChargeResponseBody = await res.json();
    expect(body).toMatchObject({ amountMinor: "500000", status: "pending" });
    ctx.trackCreatedPostClosureCharge(body.obligationId);

    await ctx.cleanup();
  });

  it("happy path — against a trip, driver bears it", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "C");
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const tripRes = await request("/api/trip", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...bearer(token).headers },
      body: JSON.stringify({
        vehicleId,
        driverId,
        startDate: "2026-07-10",
        endDate: "2026-07-12",
      }),
    });
    const tripBody: { id: string } = await tripRes.json();
    ctx.trackCreatedTrip(tripBody.id);

    const res = await postPostClosureCharge(token, {
      partyType: "driver",
      partyDriverId: driverId,
      vehicleId,
      sourceType: "trip",
      sourceId: tripBody.id,
      amountMinor: "150000",
      dueOn: "2026-08-01",
    });
    expect(res.status).toBe(201);
    const body: PostClosureChargeResponseBody = await res.json();
    ctx.trackCreatedPostClosureCharge(body.obligationId);

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await postPostClosureCharge("", {
      partyType: "customer",
      partyCustomerId: "11111111-1111-4111-8111-111111111111",
      sourceType: "lease",
      sourceId: "11111111-1111-4111-8111-111111111111",
      amountMinor: "1",
      dueOn: "2026-08-01",
    });
    expect(res.status).toBe(401);
  });

  it("403 — a linked driver cannot record a post-closure charge", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await postPostClosureCharge(token, {
      partyType: "driver",
      partyDriverId: driverId,
      sourceType: "trip",
      sourceId: "11111111-1111-4111-8111-111111111111",
      amountMinor: "1",
      dueOn: "2026-08-01",
    });
    expect(res.status).toBe(403);

    await ctx.cleanup();
  });

  it("404 — the lease belongs to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherVehicleId = await ctx.createVehicle(otherBusinessId);
    const otherCustomerId = await ctx.createCustomer(otherBusinessId);
    const otherLeaseId = await ctx.createLease(otherBusinessId, otherVehicleId, otherCustomerId, {
      status: "closed",
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postPostClosureCharge(token, {
      partyType: "customer",
      partyCustomerId: otherCustomerId,
      sourceType: "lease",
      sourceId: otherLeaseId,
      amountMinor: "1000",
      dueOn: "2026-08-01",
    });
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("409 — a closed accounting period rejects the write", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const customerId = await ctx.createCustomer(businessId);
    const leaseId = await ctx.createLease(businessId, vehicleId, customerId, { status: "closed" });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    await ctx.closePeriod(periodId);

    const res = await postPostClosureCharge(token, {
      partyType: "customer",
      partyCustomerId: customerId,
      sourceType: "lease",
      sourceId: leaseId,
      amountMinor: "1000",
      dueOn: "2026-08-01",
    });
    expect(res.status).toBe(409);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "PERIOD_CLOSED" });

    await ctx.cleanup();
  });
});
