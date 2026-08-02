import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import {
  billingPeriod as billingPeriodTable,
  deposit as depositTable,
  depositMovement,
  vehicleDayAllocation,
} from "../../src/db/schema.js";
import { mintLinkedDriver, mintUser, signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

async function post(path: string, token: string, body?: unknown) {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function get(path: string, token: string) {
  return request(path, bearer(token));
}

interface StartLeaseBody {
  id: string;
  depositId: string | null;
}

async function startLease(
  token: string,
  vehicleId: string,
  customerId: string,
  overrides: Record<string, unknown> = {},
): Promise<StartLeaseBody> {
  const res = await post("/api/lease", token, {
    vehicleId,
    customerId,
    startDate: "2026-01-12",
    billingDay: 12,
    rentAmountMinor: "3100000",
    mileageDailyLimitKm: 100,
    mileageExcessRateMinor: "5000",
    odometerReadingKm: 0,
    odometerSource: "in_person",
    ...overrides,
  });
  expect(res.status).toBe(201);
  return res.json();
}

/**
 * F-2.6/UC-16 "Close the lease" — a Phase 1 flow discovered unbuilt while
 * wiring P13's deposit-releases read (TRACKER.md): nothing set a deposit to
 * `hold_window` because nothing ever closed a lease. Tests exercise the
 * real chain (start → close → closure-summary → settle-deposit → close-out)
 * through HTTP rather than fixtures wherever practical, since the whole
 * point is that these steps compose correctly against each other.
 */
describe("close a lease (F-2.6/UC-16)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("a lease can take a deposit at handover (F-2.1's own new field)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId, { periodStart: "2026-01-01", periodEnd: "2026-12-31" });
    const vehicleId = await ctx.createVehicle(businessId);
    const customerId = await ctx.createCustomer(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const body = await startLease(token, vehicleId, customerId, { depositAmountMinor: "20000" });
    expect(body.depositId).not.toBeNull();
    ctx.trackCreatedLease(body.id);

    const [depositRow] = await db
      .select()
      .from(depositTable)
      .where(eq(depositTable.id, body.depositId as string));
    expect(depositRow).toMatchObject({
      partyType: "customer",
      partyCustomerId: customerId,
      leaseId: body.id,
      status: "held",
    });
    const movements = await db
      .select()
      .from(depositMovement)
      .where(eq(depositMovement.depositId, body.depositId as string));
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ movementType: "taken", amountMinor: 20_000n });

    await ctx.cleanup();
  });

  describe("POST /{id}/close — steps 1-3", () => {
    it("'days_used': prorates the rent, truncates the period's own allowance, and assesses final mileage", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId, {
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
      });
      const vehicleId = await ctx.createVehicle(businessId);
      const customerId = await ctx.createCustomer(businessId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const started = await startLease(token, vehicleId, customerId);
      ctx.trackCreatedLease(started.id);

      // Jan 12 .. Feb 11 is the natural 31-day period; closing on Jan 21 is
      // 10 days used, so 3,100,000 / 31 = 100,000 per day — no rounding
      // ambiguity to muddy the assertion.
      const res = await post(`/api/lease/${started.id}/close`, token, {
        closingDate: "2026-01-21",
        finalPeriodMode: "days_used",
        closingOdometerKm: 300,
        odometerSource: "at_return",
      });
      expect(res.status).toBe(200);
      const body: {
        finalPeriod: {
          periodEnd: string;
          daysCount: number;
          allowanceKm: number | null;
          amountMinor: string;
        };
      } = await res.json();
      expect(body.finalPeriod).toMatchObject({
        periodEnd: "2026-01-21",
        daysCount: 10,
        allowanceKm: 1000, // 100 km/day × 10 days actually covered
        amountMinor: "1000000", // 3,100,000 prorated to 10 of 31 days
      });

      const [periodRow] = await db
        .select()
        .from(billingPeriodTable)
        .where(eq(billingPeriodTable.leaseId, started.id));
      expect(periodRow).toMatchObject({ periodEnd: "2026-01-21", allowanceKm: 1000 });

      // 300 km driven against a 1,000 km allowance — no excess, nothing owed.
      const getRes = await get(`/api/lease/${started.id}`, token);
      const leaseBody: { status: string } = await getRes.json();
      expect(leaseBody.status).toBe("closing");

      await ctx.cleanup();
    });

    it("'full': charges the full period even though it truncates the mileage allowance to days used", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId, {
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
      });
      const vehicleId = await ctx.createVehicle(businessId);
      const customerId = await ctx.createCustomer(businessId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const started = await startLease(token, vehicleId, customerId);
      ctx.trackCreatedLease(started.id);

      const res = await post(`/api/lease/${started.id}/close`, token, {
        closingDate: "2026-01-21",
        finalPeriodMode: "full",
      });
      expect(res.status).toBe(200);
      const body: { finalPeriod: { amountMinor: string; allowanceKm: number | null } } =
        await res.json();
      expect(body.finalPeriod.amountMinor).toBe("3100000"); // unchanged — full period charged
      expect(body.finalPeriod.allowanceKm).toBe(1000); // still truncated to days actually covered

      await ctx.cleanup();
    });

    it("'agreed': the obligation becomes exactly the agreed figure, recorded as an agreed_discount adjustment", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId, {
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
      });
      const vehicleId = await ctx.createVehicle(businessId);
      const customerId = await ctx.createCustomer(businessId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const started = await startLease(token, vehicleId, customerId);
      ctx.trackCreatedLease(started.id);

      const res = await post(`/api/lease/${started.id}/close`, token, {
        closingDate: "2026-01-21",
        finalPeriodMode: "agreed",
        agreedAmountMinor: "500000",
        note: "Negotiated at handback",
      });
      expect(res.status).toBe(200);
      const body: { finalPeriod: { amountMinor: string } } = await res.json();
      expect(body.finalPeriod.amountMinor).toBe("500000");

      await ctx.cleanup();
    });

    it("400 — a lease already stopped cannot be closed a second time", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId, {
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
      });
      const vehicleId = await ctx.createVehicle(businessId);
      const customerId = await ctx.createCustomer(businessId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const started = await startLease(token, vehicleId, customerId);
      ctx.trackCreatedLease(started.id);

      const first = await post(`/api/lease/${started.id}/close`, token, {
        closingDate: "2026-01-21",
        finalPeriodMode: "full",
      });
      expect(first.status).toBe(200);

      const second = await post(`/api/lease/${started.id}/close`, token, {
        closingDate: "2026-01-25",
        finalPeriodMode: "full",
      });
      expect(second.status).toBe(400);

      await ctx.cleanup();
    });

    it("404 — the lease belongs to another business", async () => {
      const ctx = new TestContext(db);
      const businessA = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessA, { periodStart: "2026-01-01", periodEnd: "2026-12-31" });
      const vehicleId = await ctx.createVehicle(businessA);
      const customerId = await ctx.createCustomer(businessA);
      const ownerA = await mintUser(db, ctx, businessA, "owner");
      const tokenA = await signAccessToken(ownerA.asgardeoSub);
      const started = await startLease(tokenA, vehicleId, customerId);
      ctx.trackCreatedLease(started.id);

      const businessB = await ctx.createBusiness();
      const ownerB = await mintUser(db, ctx, businessB, "owner");
      const tokenB = await signAccessToken(ownerB.asgardeoSub);

      const res = await post(`/api/lease/${started.id}/close`, tokenB, {
        closingDate: "2026-01-21",
        finalPeriodMode: "full",
      });
      expect(res.status).toBe(404);

      await ctx.cleanup();
    });

    it("401 — missing Authorization header", async () => {
      const res = await request(`/api/lease/00000000-0000-4000-8000-000000000000/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ closingDate: "2026-01-21", finalPeriodMode: "full" }),
      });
      expect(res.status).toBe(401);
    });

    it("403 — a linked driver cannot close a lease", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const driverId = await ctx.createDriver(businessId);
      const linked = await mintLinkedDriver(db, ctx, driverId);
      const token = await signAccessToken(linked.asgardeoSub);

      const res = await post(`/api/lease/00000000-0000-4000-8000-000000000000/close`, token, {
        closingDate: "2026-01-21",
        finalPeriodMode: "full",
      });
      expect(res.status).toBe(403);

      await ctx.cleanup();
    });
  });

  describe("GET /{id}/closure-summary — step 4/INV-18", () => {
    it("lists every unpaid amount this customer owes plus any open incident", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId, {
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
      });
      const vehicleId = await ctx.createVehicle(businessId);
      const customerId = await ctx.createCustomer(businessId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const started = await startLease(token, vehicleId, customerId);
      ctx.trackCreatedLease(started.id);

      const closeRes = await post(`/api/lease/${started.id}/close`, token, {
        closingDate: "2026-01-21",
        finalPeriodMode: "full",
      });
      expect(closeRes.status).toBe(200);

      const incidentRes = await post("/api/incident", token, {
        vehicleId,
        leaseId: started.id,
        occurredOn: "2026-01-18",
        description: "Scraped door",
      });
      expect(incidentRes.status).toBe(201);
      const incidentBody: { id: string } = await incidentRes.json();
      ctx.trackCreatedIncident(incidentBody.id);

      const res = await get(`/api/lease/${started.id}/closure-summary`, token);
      expect(res.status).toBe(200);
      const body: {
        unpaidObligations: { amountMinor: string; kind: string }[];
        totalUnpaidMinor: string;
        openIncidents: { id: string }[];
      } = await res.json();

      expect(
        body.unpaidObligations.some((o) => o.kind === "rent" && o.amountMinor === "3100000"),
      ).toBe(true);
      expect(body.totalUnpaidMinor).toBe("3100000");
      expect(body.openIncidents.map((i) => i.id)).toEqual([incidentBody.id]);

      await ctx.cleanup();
    });

    it("404 — the lease belongs to another business", async () => {
      const ctx = new TestContext(db);
      const businessA = await ctx.createBusiness();
      const vehicleId = await ctx.createVehicle(businessA);
      const customerId = await ctx.createCustomer(businessA);
      const leaseId = await ctx.createLease(businessA, vehicleId, customerId, { status: "active" });

      const businessB = await ctx.createBusiness();
      const ownerB = await mintUser(db, ctx, businessB, "owner");
      const tokenB = await signAccessToken(ownerB.asgardeoSub);

      const res = await get(`/api/lease/${leaseId}/closure-summary`, tokenB);
      expect(res.status).toBe(404);

      await ctx.cleanup();
    });
  });

  describe("POST /{id}/settle-deposit — step 6", () => {
    async function startAndCloseWithDeposit(token: string, vehicleId: string, customerId: string) {
      const started = await startLease(token, vehicleId, customerId, {
        depositAmountMinor: "20000",
      });
      const closeRes = await post(`/api/lease/${started.id}/close`, token, {
        closingDate: "2026-01-21",
        finalPeriodMode: "full",
      });
      expect(closeRes.status).toBe(200);
      return started;
    }

    it("refund — pays back the full held balance and releases it", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId, {
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
      });
      const vehicleId = await ctx.createVehicle(businessId);
      const customerId = await ctx.createCustomer(businessId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const started = await startAndCloseWithDeposit(token, vehicleId, customerId);
      ctx.trackCreatedLease(started.id);

      const res = await post(`/api/lease/${started.id}/settle-deposit`, token, {
        action: "refund",
        occurredOn: "2026-01-21",
      });
      expect(res.status).toBe(200);
      const body: { status: string; heldMinor: string; holdReleaseDate: string | null } =
        await res.json();
      expect(body).toMatchObject({ status: "released", heldMinor: "0", holdReleaseDate: null });

      await ctx.cleanup();
    });

    it("retain — keeps a portion with a reason", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId, {
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
      });
      const vehicleId = await ctx.createVehicle(businessId);
      const customerId = await ctx.createCustomer(businessId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const started = await startAndCloseWithDeposit(token, vehicleId, customerId);
      ctx.trackCreatedLease(started.id);

      const res = await post(`/api/lease/${started.id}/settle-deposit`, token, {
        action: "retain",
        amountMinor: "5000",
        reason: "Scratched bumper",
        occurredOn: "2026-01-21",
      });
      expect(res.status).toBe(200);
      const body: { status: string; heldMinor: string } = await res.json();
      expect(body).toMatchObject({ status: "retained", heldMinor: "15000" });

      await ctx.cleanup();
    });

    it("hold — sets hold_window and a release date computed from business_settings.deposit_hold_days", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId, {
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
      });
      const vehicleId = await ctx.createVehicle(businessId);
      const customerId = await ctx.createCustomer(businessId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const started = await startAndCloseWithDeposit(token, vehicleId, customerId);
      ctx.trackCreatedLease(started.id);

      const res = await post(`/api/lease/${started.id}/settle-deposit`, token, {
        action: "hold",
        occurredOn: "2026-01-21",
      });
      expect(res.status).toBe(200);
      const body: { status: string; heldMinor: string; holdReleaseDate: string | null } =
        await res.json();
      expect(body).toMatchObject({
        status: "hold_window",
        heldMinor: "20000",
        holdReleaseDate: "2026-02-20", // 2026-01-21 + 30 days, the default deposit_hold_days
      });

      await ctx.cleanup();
    });

    it("400 — a still-active lease cannot have its deposit settled (step 1 must run first)", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId, {
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
      });
      const vehicleId = await ctx.createVehicle(businessId);
      const customerId = await ctx.createCustomer(businessId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const started = await startLease(token, vehicleId, customerId, {
        depositAmountMinor: "20000",
      });
      ctx.trackCreatedLease(started.id);

      const res = await post(`/api/lease/${started.id}/settle-deposit`, token, {
        action: "refund",
        occurredOn: "2026-01-21",
      });
      expect(res.status).toBe(400);

      await ctx.cleanup();
    });

    it("404 — no deposit was ever taken on this lease", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId, {
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
      });
      const vehicleId = await ctx.createVehicle(businessId);
      const customerId = await ctx.createCustomer(businessId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const started = await startLease(token, vehicleId, customerId);
      ctx.trackCreatedLease(started.id);
      const closeRes = await post(`/api/lease/${started.id}/close`, token, {
        closingDate: "2026-01-21",
        finalPeriodMode: "full",
      });
      expect(closeRes.status).toBe(200);

      const res = await post(`/api/lease/${started.id}/settle-deposit`, token, {
        action: "refund",
        occurredOn: "2026-01-21",
      });
      expect(res.status).toBe(404);

      await ctx.cleanup();
    });
  });

  describe("POST /{id}/close-out — step 7", () => {
    it("marks the lease closed and frees its own future occupancy, keeping days up to and including the closing date", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId, {
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
      });
      const vehicleId = await ctx.createVehicle(businessId);
      const customerId = await ctx.createCustomer(businessId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const started = await startLease(token, vehicleId, customerId);
      ctx.trackCreatedLease(started.id);

      // Simulate P13's cron having already materialised the rolling calendar.
      await ctx.createVehicleDayAllocation(businessId, vehicleId, "2026-01-20", "A", started.id);
      await ctx.createVehicleDayAllocation(businessId, vehicleId, "2026-01-25", "A", started.id);
      await ctx.createVehicleDayAllocation(businessId, vehicleId, "2026-02-01", "A", started.id);

      const closeRes = await post(`/api/lease/${started.id}/close`, token, {
        closingDate: "2026-01-21",
        finalPeriodMode: "full",
      });
      expect(closeRes.status).toBe(200);

      const res = await post(`/api/lease/${started.id}/close-out`, token);
      expect(res.status).toBe(200);
      const body: { status: string; endDate: string } = await res.json();
      expect(body).toMatchObject({ status: "closed", endDate: "2026-01-21" });

      const remaining = await db
        .select({ businessDate: vehicleDayAllocation.businessDate })
        .from(vehicleDayAllocation)
        .where(eq(vehicleDayAllocation.sourceId, started.id));
      expect(remaining.map((r) => r.businessDate).sort()).toEqual(["2026-01-20"]);

      await ctx.cleanup();
    });

    it("400 — a lease that was never stopped cannot be closed out", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId, {
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
      });
      const vehicleId = await ctx.createVehicle(businessId);
      const customerId = await ctx.createCustomer(businessId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const started = await startLease(token, vehicleId, customerId);
      ctx.trackCreatedLease(started.id);

      const res = await post(`/api/lease/${started.id}/close-out`, token);
      expect(res.status).toBe(400);

      await ctx.cleanup();
    });
  });
});
