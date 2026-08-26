import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import {
  accountingPeriod,
  incidentRecovery,
  lease as leaseTable,
  obligation,
} from "../../src/db/schema.js";
import { mintLinkedDriver, mintUser, signAccessToken } from "../support/auth.js";
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

async function get(path: string, token: string) {
  return request(path, bearer(token));
}

async function getIncidentExpenses(token: string, id: string) {
  return request(`/api/incident/${id}/expense`, bearer(token));
}

async function postExpense(token: string, body: unknown) {
  return post("/api/expense", token, body);
}

/** F-3.4/UC-12/W-9/W-10/W-11 test matrix, and §7.2's golden fixture (G-2). */
describe("incident (P8, F-3.4/UC-12)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  describe("open an incident (step 1)", () => {
    it("happy path — the container, opened with its minimal fields", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId);
      const vehicleId = await ctx.createVehicle(businessId);
      const owner = await mintUser(db, ctx, businessId, "manager");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await post("/api/incident", token, {
        vehicleId,
        occurredOn: "2026-07-08",
        description: "Rear bumper damage",
      });
      expect(res.status).toBe(201);
      const body: {
        id: string;
        vehicleId: string;
        status: string;
        bottomLine: Record<string, string>;
      } = await res.json();
      expect(body).toMatchObject({
        vehicleId,
        status: "open",
        occurredOn: "2026-07-08",
        description: "Rear bumper damage",
        offRoadFrom: null,
        rentTreatment: null,
      });
      expect(body.bottomLine).toEqual({
        totalRepairCostMinor: "0",
        totalRecoveredMinor: "0",
        pendingRecoveryMinor: "0",
        netCostMinor: "0",
      });
      ctx.trackCreatedIncident(body.id);

      await ctx.cleanup();
    });

    it("401 — missing Authorization header", async () => {
      const res = await post("/api/incident", "", {
        vehicleId: "00000000-0000-0000-0000-000000000000",
        occurredOn: "2026-07-08",
      });
      expect(res.status).toBe(401);
    });

    it("403 — a linked driver cannot open an incident", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId);
      const vehicleId = await ctx.createVehicle(businessId);
      const driverId = await ctx.createDriver(businessId);
      const linked = await mintLinkedDriver(db, ctx, driverId);
      const token = await signAccessToken(linked.asgardeoSub);

      const res = await post("/api/incident", token, {
        vehicleId,
        occurredOn: "2026-07-08",
      });
      expect(res.status).toBe(403);

      await ctx.cleanup();
    });

    it("404 — the vehicle belongs to another business", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId);
      const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
      const otherVehicleId = await ctx.createVehicle(otherBusinessId);
      const owner = await mintUser(db, ctx, businessId, "manager");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await post("/api/incident", token, {
        vehicleId: otherVehicleId,
        occurredOn: "2026-07-08",
      });
      expect(res.status).toBe(404);

      await ctx.cleanup();
    });
  });

  describe("record off-road and rent treatment (step 2/W-9)", () => {
    it("'continue' — the default, safe path: no lease touched", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId);
      const vehicleId = await ctx.createVehicle(businessId);
      await ctx.setVehicleArrangement(vehicleId, "A");
      const customerId = await ctx.createCustomer(businessId);
      const leaseId = await ctx.createLease(businessId, vehicleId, customerId, {
        status: "active",
        endDate: "2026-12-31",
      });
      const owner = await mintUser(db, ctx, businessId, "manager");
      const token = await signAccessToken(owner.asgardeoSub);

      const opened = await post("/api/incident", token, {
        vehicleId,
        leaseId,
        occurredOn: "2026-07-08",
      });
      const { id: incidentId }: { id: string } = await opened.json();
      ctx.trackCreatedIncident(incidentId);

      const res = await post(`/api/incident/${incidentId}/off-road`, token, {
        offRoadFrom: "2026-07-08",
        offRoadTo: "2026-07-19",
        rentTreatment: "continue",
      });
      expect(res.status).toBe(200);
      const body: { incident: { rentTreatment: string }; leaseExtensionId?: string } =
        await res.json();
      expect(body.incident.rentTreatment).toBe("continue");
      expect(body.leaseExtensionId).toBeUndefined();

      const [leaseRow] = await db.select().from(leaseTable).where(eq(leaseTable.id, leaseId));
      expect(leaseRow?.endDate).toBe("2026-12-31");

      await ctx.cleanup();
    });

    it("'credit_days' — a pro-rata rent discount against the billing period's own obligation", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId, {
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
      });
      const vehicleId = await ctx.createVehicle(businessId);
      await ctx.setVehicleArrangement(vehicleId, "A");
      const customerId = await ctx.createCustomer(businessId);
      const leaseId = await ctx.createLease(businessId, vehicleId, customerId, {
        status: "active",
        rentAmountMinor: 31_000n,
      });
      const billingPeriodId = await ctx.createBillingPeriod(leaseId, {
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        rentAmountMinor: 31_000n,
      });
      // Minted before the obligation it will later be `created_by` on —
      // `ctx.cleanup()` unwinds most-recently-tracked first, so the user's
      // own teardown must be registered before anything that will reference
      // it via a FK, or its DELETE runs first and violates that FK.
      const owner = await mintUser(db, ctx, businessId, "manager");
      const token = await signAccessToken(owner.asgardeoSub);
      const obligationId = await ctx.createObligation(businessId, periodId, {
        direction: "owed_to_us",
        partyType: "customer",
        customerId,
        amountMinor: 31_000n,
        dueOn: "2026-07-01",
        sourceType: "billing_period",
        sourceId: billingPeriodId,
      });

      const opened = await post("/api/incident", token, {
        vehicleId,
        leaseId,
        occurredOn: "2026-07-08",
      });
      const { id: incidentId }: { id: string } = await opened.json();
      ctx.trackCreatedIncident(incidentId);

      // 10 off-road days of a 31-day July: 31,000 * 10/31 = 10,000 (largest-remainder).
      const res = await post(`/api/incident/${incidentId}/off-road`, token, {
        offRoadFrom: "2026-07-01",
        offRoadTo: "2026-07-10",
        rentTreatment: "credit_days",
      });
      expect(res.status).toBe(200);
      const body: { adjustmentId?: string } = await res.json();
      expect(body.adjustmentId).toBeDefined();

      const obligationRows = await db
        .select()
        .from(obligation)
        .where(eq(obligation.id, obligationId));
      expect(obligationRows[0]?.amountMinor).toBe(21_000n);

      await ctx.cleanup();
    });

    it("'extend' — pushes the lease's end date out and records why (D-7)", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId);
      const vehicleId = await ctx.createVehicle(businessId);
      await ctx.setVehicleArrangement(vehicleId, "A");
      const customerId = await ctx.createCustomer(businessId);
      const leaseId = await ctx.createLease(businessId, vehicleId, customerId, {
        status: "active",
        endDate: "2026-12-31",
      });
      const owner = await mintUser(db, ctx, businessId, "manager");
      const token = await signAccessToken(owner.asgardeoSub);

      const opened = await post("/api/incident", token, {
        vehicleId,
        leaseId,
        occurredOn: "2026-07-08",
      });
      const { id: incidentId }: { id: string } = await opened.json();
      ctx.trackCreatedIncident(incidentId);

      const res = await post(`/api/incident/${incidentId}/off-road`, token, {
        offRoadFrom: "2026-07-08",
        offRoadTo: "2026-07-19",
        rentTreatment: "extend",
      });
      expect(res.status).toBe(200);
      const body: { leaseExtensionId?: string } = await res.json();
      expect(body.leaseExtensionId).toBeDefined();

      const [leaseRow] = await db.select().from(leaseTable).where(eq(leaseTable.id, leaseId));
      expect(leaseRow?.endDate).toBe("2027-01-12");

      await ctx.cleanup();
    });

    it("400 — 'extend' on a lease with no end date to push", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId);
      const vehicleId = await ctx.createVehicle(businessId);
      const customerId = await ctx.createCustomer(businessId);
      const leaseId = await ctx.createLease(businessId, vehicleId, customerId, {
        status: "active",
      });
      const owner = await mintUser(db, ctx, businessId, "manager");
      const token = await signAccessToken(owner.asgardeoSub);

      const opened = await post("/api/incident", token, {
        vehicleId,
        leaseId,
        occurredOn: "2026-07-08",
      });
      const { id: incidentId }: { id: string } = await opened.json();
      ctx.trackCreatedIncident(incidentId);

      const res = await post(`/api/incident/${incidentId}/off-road`, token, {
        offRoadFrom: "2026-07-08",
        offRoadTo: "2026-07-19",
        rentTreatment: "extend",
      });
      expect(res.status).toBe(400);

      await ctx.cleanup();
    });

    it("404 — the incident belongs to another business", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
      const otherVehicleId = await ctx.createVehicle(otherBusinessId);
      await ctx.createOpenPeriod(otherBusinessId);
      const owner = await mintUser(db, ctx, businessId, "manager");
      const token = await signAccessToken(owner.asgardeoSub);

      const otherOwner = await mintUser(db, ctx, otherBusinessId, "manager");
      const otherToken = await signAccessToken(otherOwner.asgardeoSub);
      const opened = await post("/api/incident", otherToken, {
        vehicleId: otherVehicleId,
        occurredOn: "2026-07-08",
      });
      const { id: incidentId }: { id: string } = await opened.json();
      ctx.trackCreatedIncident(incidentId);

      const res = await post(`/api/incident/${incidentId}/off-road`, token, {
        offRoadFrom: "2026-07-08",
        offRoadTo: "2026-07-19",
        rentTreatment: "continue",
      });
      expect(res.status).toBe(404);

      await ctx.cleanup();
    });
  });

  describe("customer contribution (step 4/W-10)", () => {
    it("happy path — agreed opens a payable obligation, then received settles it (D-9/GAP-10)", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId);
      const vehicleId = await ctx.createVehicle(businessId);
      const customerId = await ctx.createCustomer(businessId);
      const leaseId = await ctx.createLease(businessId, vehicleId, customerId);
      const owner = await mintUser(db, ctx, businessId, "manager");
      const token = await signAccessToken(owner.asgardeoSub);

      const opened = await post("/api/incident", token, {
        vehicleId,
        leaseId,
        occurredOn: "2026-07-08",
      });
      const { id: incidentId }: { id: string } = await opened.json();
      ctx.trackCreatedIncident(incidentId);

      const agreed = await post(`/api/incident/${incidentId}/customer-contribution`, token, {
        agreedAmountMinor: "20000",
        agreedOn: "2026-07-20",
        note: "Agreed after repair estimate",
      });
      expect(agreed.status).toBe(201);
      const agreedBody: { id: string; agreedAmountMinor: string; receivedAmountMinor: string } =
        await agreed.json();
      expect(agreedBody).toMatchObject({ agreedAmountMinor: "20000", receivedAmountMinor: "0" });

      const obligationsAfterAgree = await db
        .select({
          amountMinor: obligation.amountMinor,
          settledMinor: obligation.settledMinor,
          status: obligation.status,
          partyCustomerId: obligation.partyCustomerId,
        })
        .from(obligation)
        .where(eq(obligation.sourceId, agreedBody.id));
      expect(obligationsAfterAgree).toEqual([
        { amountMinor: 20000n, settledMinor: 0n, status: "pending", partyCustomerId: customerId },
      ]);

      const received = await post(
        `/api/incident/${incidentId}/recovery/${agreedBody.id}/receive`,
        token,
        { receivedAmountMinor: "20000", receivedOn: "2026-07-25" },
      );
      expect(received.status).toBe(200);
      const receivedBody: { receivedAmountMinor: string } = await received.json();
      expect(receivedBody.receivedAmountMinor).toBe("20000");

      const obligationsAfterReceive = await db
        .select({ settledMinor: obligation.settledMinor, status: obligation.status })
        .from(obligation)
        .where(eq(obligation.sourceId, agreedBody.id));
      expect(obligationsAfterReceive).toEqual([{ settledMinor: 20000n, status: "paid" }]);

      const detail = await get(`/api/incident/${incidentId}`, token);
      const detailBody: { bottomLine: Record<string, string> } = await detail.json();
      expect(detailBody.bottomLine).toMatchObject({
        totalRecoveredMinor: "20000",
        pendingRecoveryMinor: "0",
      });

      await ctx.cleanup();
    });

    it("GAP-147 — voiding an unreceived contribution keeps history but removes it from the bottom line", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId);
      const vehicleId = await ctx.createVehicle(businessId);
      const customerId = await ctx.createCustomer(businessId);
      const leaseId = await ctx.createLease(businessId, vehicleId, customerId);
      const owner = await mintUser(db, ctx, businessId, "manager");
      const token = await signAccessToken(owner.asgardeoSub);

      const opened = await post("/api/incident", token, {
        vehicleId,
        leaseId,
        occurredOn: "2026-07-08",
      });
      const { id: incidentId }: { id: string } = await opened.json();
      ctx.trackCreatedIncident(incidentId);

      const agreed = await post(`/api/incident/${incidentId}/customer-contribution`, token, {
        agreedAmountMinor: "20000",
        agreedOn: "2026-07-20",
      });
      expect(agreed.status).toBe(201);
      const agreedBody: {
        id: string;
        voidedAt: string | null;
        voidedReason: string | null;
      } = await agreed.json();
      expect(agreedBody).toMatchObject({ voidedAt: null, voidedReason: null });

      const beforeVoid = await get(`/api/incident/${incidentId}`, token);
      const beforeVoidBody: { bottomLine: Record<string, string> } = await beforeVoid.json();
      expect(beforeVoidBody.bottomLine).toMatchObject({ pendingRecoveryMinor: "20000" });

      const voided = await post(
        `/api/incident/${incidentId}/recovery/${agreedBody.id}/void`,
        token,
        { reason: "entered against the wrong customer" },
      );
      expect(voided.status).toBe(200);

      const afterVoid = await get(`/api/incident/${incidentId}`, token);
      const afterVoidBody: {
        bottomLine: Record<string, string>;
        recoveries: Array<{
          id: string;
          agreedAmountMinor: string;
          voidedAt: string | null;
          voidedReason: string | null;
        }>;
      } = await afterVoid.json();
      expect(afterVoidBody.bottomLine).toMatchObject({
        totalRecoveredMinor: "0",
        pendingRecoveryMinor: "0",
        netCostMinor: "0",
      });
      expect(afterVoidBody.recoveries).toEqual([
        expect.objectContaining({
          id: agreedBody.id,
          agreedAmountMinor: "20000",
          voidedReason: "entered against the wrong customer",
        }),
      ]);
      expect(afterVoidBody.recoveries[0]?.voidedAt).toEqual(expect.any(String));

      await ctx.cleanup();
    });

    it("400 — an incident with no lease has no customer to bill a contribution to (D-9/GAP-10)", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId);
      const vehicleId = await ctx.createVehicle(businessId);
      const owner = await mintUser(db, ctx, businessId, "manager");
      const token = await signAccessToken(owner.asgardeoSub);

      const opened = await post("/api/incident", token, {
        vehicleId,
        occurredOn: "2026-07-08",
      });
      const { id: incidentId }: { id: string } = await opened.json();
      ctx.trackCreatedIncident(incidentId);

      const res = await post(`/api/incident/${incidentId}/customer-contribution`, token, {
        agreedAmountMinor: "20000",
        agreedOn: "2026-07-20",
      });
      expect(res.status).toBe(400);

      await ctx.cleanup();
    });

    it("409 — a closed accounting period rejects the write", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const vehicleId = await ctx.createVehicle(businessId);
      const customerId = await ctx.createCustomer(businessId);
      const leaseId = await ctx.createLease(businessId, vehicleId, customerId);
      const owner = await mintUser(db, ctx, businessId, "manager");
      const token = await signAccessToken(owner.asgardeoSub);

      const opened = await post("/api/incident", token, {
        vehicleId,
        leaseId,
        occurredOn: "2026-07-08",
      });
      const { id: incidentId }: { id: string } = await opened.json();
      ctx.trackCreatedIncident(incidentId);

      await ctx.closePeriod(periodId);

      const res = await post(`/api/incident/${incidentId}/customer-contribution`, token, {
        agreedAmountMinor: "20000",
        agreedOn: "2026-07-20",
      });
      expect(res.status).toBe(409);
      const body: { code: string } = await res.json();
      expect(body).toMatchObject({ code: "PERIOD_CLOSED" });

      await ctx.cleanup();
    });

    it("409 — receiving into a closed period rejects the payment this now writes (D-9/GAP-10)", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId, {
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
      });
      const vehicleId = await ctx.createVehicle(businessId);
      const customerId = await ctx.createCustomer(businessId);
      const leaseId = await ctx.createLease(businessId, vehicleId, customerId);
      const owner = await mintUser(db, ctx, businessId, "manager");
      const token = await signAccessToken(owner.asgardeoSub);

      const opened = await post("/api/incident", token, {
        vehicleId,
        leaseId,
        occurredOn: "2026-07-08",
      });
      const { id: incidentId }: { id: string } = await opened.json();
      ctx.trackCreatedIncident(incidentId);

      const agreed = await post(`/api/incident/${incidentId}/customer-contribution`, token, {
        agreedAmountMinor: "20000",
        agreedOn: "2026-07-20",
      });
      const agreedBody: { id: string } = await agreed.json();

      await ctx.closePeriod(periodId);

      const res = await post(
        `/api/incident/${incidentId}/recovery/${agreedBody.id}/receive`,
        token,
        { receivedAmountMinor: "20000", receivedOn: "2026-07-25" },
      );
      expect(res.status).toBe(409);
      const body: { code: string } = await res.json();
      expect(body).toMatchObject({ code: "PERIOD_CLOSED" });

      await ctx.cleanup();
    });
  });

  describe("insurance claim (step 5/W-11)", () => {
    it("happy path — submitted, then settled", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId);
      const vehicleId = await ctx.createVehicle(businessId);
      const owner = await mintUser(db, ctx, businessId, "manager");
      const token = await signAccessToken(owner.asgardeoSub);

      const opened = await post("/api/incident", token, {
        vehicleId,
        occurredOn: "2026-07-08",
      });
      const { id: incidentId }: { id: string } = await opened.json();
      ctx.trackCreatedIncident(incidentId);

      const submitted = await post(`/api/incident/${incidentId}/insurance-claim`, token, {
        claimedAmountMinor: "75000",
        excessBorneMinor: "15000",
        claimedOn: "2026-07-10",
      });
      expect(submitted.status).toBe(201);
      const submittedBody: { id: string; status: string } = await submitted.json();
      expect(submittedBody.status).toBe("submitted");

      const settled = await post(
        `/api/incident/${incidentId}/insurance-claim/${submittedBody.id}/settle`,
        token,
        { receivedAmountMinor: "60000", receivedOn: "2026-09-15" },
      );
      expect(settled.status).toBe(200);
      const settledBody: {
        claim: { status: string; receivedAmountMinor: string };
        recovery?: { receivedAmountMinor: string };
      } = await settled.json();
      expect(settledBody.claim).toMatchObject({ status: "settled", receivedAmountMinor: "60000" });
      expect(settledBody.recovery?.receivedAmountMinor).toBe("60000");

      const detail = await get(`/api/incident/${incidentId}`, token);
      const detailBody: { bottomLine: Record<string, string> } = await detail.json();
      expect(detailBody.bottomLine).toMatchObject({
        totalRecoveredMinor: "60000",
        pendingRecoveryMinor: "0",
      });

      await ctx.cleanup();
    });

    it("409 — a second insurance claim for the same incident is rejected", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId);
      const vehicleId = await ctx.createVehicle(businessId);
      const owner = await mintUser(db, ctx, businessId, "manager");
      const token = await signAccessToken(owner.asgardeoSub);

      const opened = await post("/api/incident", token, {
        vehicleId,
        occurredOn: "2026-07-08",
      });
      const { id: incidentId }: { id: string } = await opened.json();
      ctx.trackCreatedIncident(incidentId);

      const first = await post(`/api/incident/${incidentId}/insurance-claim`, token, {
        claimedAmountMinor: "75000",
        excessBorneMinor: "15000",
        claimedOn: "2026-07-10",
      });
      expect(first.status).toBe(201);

      const second = await post(`/api/incident/${incidentId}/insurance-claim`, token, {
        claimedAmountMinor: "10000",
        claimedOn: "2026-07-11",
      });
      expect(second.status).toBe(409);
      const body: { code: string } = await second.json();
      expect(body).toMatchObject({ code: "INSURANCE_CLAIM_ALREADY_EXISTS" });

      await ctx.cleanup();
    });
  });

  /**
   * §7.2/DM §16.1's G-2: "95,000 spent, 80,000 recovered, net 15,000",
   * repairs July 70,000 / August 25,000, recoveries August 20,000
   * (customer) / September 60,000 (insurer), pending 60,000 visible in July
   * and August, zero by September, lease extended 12 days. The seed walks
   * the real period lifecycle (open July, write July, close July and open
   * August, …) — there is no other way to write into a closed period.
   */
  it("G-2 reproduces: 95,000 spent, 80,000 recovered, net 15,000", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "A");
    const customerId = await ctx.createCustomer(businessId);
    const leaseId = await ctx.createLease(businessId, vehicleId, customerId, {
      status: "active",
      rentAmountMinor: 70_000n,
      endDate: "2026-12-31",
    });
    const owner = await mintUser(db, ctx, businessId, "manager");
    const token = await signAccessToken(owner.asgardeoSub);

    // July: the accident, the extension, the first repair invoice, and the
    // insurance claim — all submitted while July is still open.
    const julyPeriodId = await ctx.createOpenPeriod(businessId, {
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
    });

    const opened = await post("/api/incident", token, {
      vehicleId,
      leaseId,
      occurredOn: "2026-07-08",
      description: "Accident on 8 July",
    });
    expect(opened.status).toBe(201);
    const { id: incidentId }: { id: string } = await opened.json();
    // Tracked at the end, not here — August and September are created
    // later in this test, after this point, so their own cleanup entries
    // would otherwise be registered (and so unwound) before this one,
    // trying to delete a period `insurance_claim.received_period_id` still
    // points to. Registering last means unwinding first.

    const offRoad = await post(`/api/incident/${incidentId}/off-road`, token, {
      offRoadFrom: "2026-07-08",
      offRoadTo: "2026-07-19",
      rentTreatment: "extend",
    });
    expect(offRoad.status).toBe(200);
    const offRoadBody: { leaseExtensionId?: string } = await offRoad.json();
    expect(offRoadBody.leaseExtensionId).toBeDefined();

    const bodyWork = await post("/api/expense", token, {
      vehicleId,
      incidentId,
      category: "repairs",
      amountMinor: "70000",
      spentOn: "2026-07-28",
      borneBy: "us",
    });
    expect(bodyWork.status).toBe(201);
    const bodyWorkBody: { id: string } = await bodyWork.json();
    // Tracked at the end, with the incident — GAP-59's composite FK
    // (expense.incident_id, vehicle_id) now means these must unwind before
    // the incident they reference, not before it's even tracked.

    // GAP-181: G-2 gains a voided row, which it did not have. The body-work
    // quote was first entered against this incident at the wrong figure and
    // voided (W-50 — voided and replaced, never edited away). It must not
    // reach `sumIncidentCostMinor`, so the bottom line below stays exactly
    // 95,000 / 80,000 / 15,000. Until now no golden fixture contained a
    // voided row at all, so that filter had no regression guard on a figure
    // FL §9.1 calls breaking to move.
    const mistypedQuote = await post("/api/expense", token, {
      vehicleId,
      incidentId,
      category: "repairs",
      amountMinor: "700000",
      spentOn: "2026-07-28",
      borneBy: "us",
    });
    expect(mistypedQuote.status).toBe(201);
    const mistypedQuoteBody: { id: string } = await mistypedQuote.json();
    const voidedQuote = await post(`/api/expense/${mistypedQuoteBody.id}/void`, token, {
      reason: "typed 700,000 instead of 70,000",
    });
    expect(voidedQuote.status).toBe(200);

    const claim = await post(`/api/incident/${incidentId}/insurance-claim`, token, {
      claimedAmountMinor: "75000",
      excessBorneMinor: "15000",
      claimedOn: "2026-07-10",
    });
    expect(claim.status).toBe(201);
    const claimBody: { id: string } = await claim.json();

    await ctx.closePeriod(julyPeriodId);

    // August: the second repair invoice (parts), and the customer's
    // contribution — agreed and paid in the same month.
    await ctx.createOpenPeriod(businessId, { periodStart: "2026-08-01", periodEnd: "2026-08-31" });

    const parts = await post("/api/expense", token, {
      vehicleId,
      incidentId,
      category: "repairs",
      amountMinor: "25000",
      spentOn: "2026-08-05",
      borneBy: "us",
    });
    expect(parts.status).toBe(201);
    const partsBody: { id: string } = await parts.json();
    // Tracked at the end too, same reason as bodyWork above.

    const contribution = await post(`/api/incident/${incidentId}/customer-contribution`, token, {
      agreedAmountMinor: "20000",
      agreedOn: "2026-08-20",
      note: "Agreed once the repair cost was known",
    });
    expect(contribution.status).toBe(201);
    const contributionBody: { id: string } = await contribution.json();

    const contributionReceived = await post(
      `/api/incident/${incidentId}/recovery/${contributionBody.id}/receive`,
      token,
      { receivedAmountMinor: "20000", receivedOn: "2026-08-20" },
    );
    expect(contributionReceived.status).toBe(200);

    // Bottom line as of August: 95,000 spent, 20,000 recovered, 60,000 still
    // pending (the insurer's, not yet settled) — the same visibly-temporary
    // reading §7.2 describes.
    const detailAfterAugust = await get(`/api/incident/${incidentId}`, token);
    const detailAfterAugustBody: { bottomLine: Record<string, string> } =
      await detailAfterAugust.json();
    expect(detailAfterAugustBody.bottomLine).toEqual({
      totalRepairCostMinor: "95000",
      totalRecoveredMinor: "20000",
      pendingRecoveryMinor: "60000",
      netCostMinor: "75000",
    });

    const periodsSoFar = await db
      .select()
      .from(accountingPeriod)
      .where(eq(accountingPeriod.businessId, businessId));
    const augustPeriodId = periodsSoFar.find((p) => p.periodStart === "2026-08-01")!.id;
    await ctx.closePeriod(augustPeriodId);

    // September: the insurer settles.
    await ctx.createOpenPeriod(businessId, { periodStart: "2026-09-01", periodEnd: "2026-09-30" });

    const settle = await post(
      `/api/incident/${incidentId}/insurance-claim/${claimBody.id}/settle`,
      token,
      { receivedAmountMinor: "60000", receivedOn: "2026-09-15" },
    );
    expect(settle.status).toBe(200);

    // The bottom line: 95,000 spent, 80,000 recovered, net cost 15,000.
    const finalDetail = await get(`/api/incident/${incidentId}`, token);
    const finalDetailBody: { bottomLine: Record<string, string> } = await finalDetail.json();
    expect(finalDetailBody.bottomLine).toEqual({
      totalRepairCostMinor: "95000",
      totalRecoveredMinor: "80000",
      pendingRecoveryMinor: "0",
      netCostMinor: "15000",
    });

    // The lease extended by 12 days — the audit trail for why this term
    // runs long (D-7).
    const [leaseRow] = await db.select().from(leaseTable).where(eq(leaseTable.id, leaseId));
    expect(leaseRow?.endDate).toBe("2027-01-12");

    // The month-by-month table (§7.2): costs and recoveries each carry the
    // period they actually posted to and (once received) the period the
    // money arrived — the two are routinely different, and that difference
    // is the whole point of the container.
    const recoveryRows = await db
      .select()
      .from(incidentRecovery)
      .where(eq(incidentRecovery.incidentId, incidentId));
    const allPeriods = await db
      .select()
      .from(accountingPeriod)
      .where(eq(accountingPeriod.businessId, businessId));
    const septemberPeriodId = allPeriods.find((p) => p.periodStart === "2026-09-01")!.id;

    const insurerRow = recoveryRows.find((r) => r.source === "insurer")!;
    expect(insurerRow.postedPeriodId).toBe(julyPeriodId);
    expect(insurerRow.receivedPeriodId).toBe(septemberPeriodId);
    expect(insurerRow.agreedAmountMinor).toBe(60_000n);
    expect(insurerRow.receivedAmountMinor).toBe(60_000n);

    const customerRow = recoveryRows.find((r) => r.source === "customer")!;
    expect(customerRow.postedPeriodId).toBe(augustPeriodId);
    expect(customerRow.receivedPeriodId).toBe(augustPeriodId);

    // GAP-59: expense.incident_id now carries a real composite FK, so the
    // two repair expenses must be tracked (and so unwound) after the
    // incident is tracked, not before — registered last, unwound first
    // (TestContext.cleanup's own LIFO order), same rule this file's own
    // comment above already applies between the incident and its periods.
    ctx.trackCreatedIncident(incidentId);
    ctx.trackCreatedExpense(bodyWorkBody.id);
    ctx.trackCreatedExpense(partsBody.id);
    ctx.trackCreatedExpense(mistypedQuoteBody.id); // GAP-181's voided row
    await ctx.cleanup();
    // GAP-181: G-2 walks the real period lifecycle (open July, write, close,
    // open August, …) across ~20 round trips against a live Neon branch, and
    // the voided-row seed added two more, tipping it past the suite's 20s
    // default. Raised rather than trimmed — writing into a closed period has
    // no shortcut, which is exactly what makes this fixture worth having.
  }, 60_000);

  describe("an incident's costs so far (Web-P8a, GET /{id}/expense)", () => {
    it("happy path — every repair cost against this incident, newest first, voided ones included", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId);
      const vehicleId = await ctx.createVehicle(businessId);
      const owner = await mintUser(db, ctx, businessId, "manager");
      const token = await signAccessToken(owner.asgardeoSub);

      const opened = await post("/api/incident", token, {
        vehicleId,
        occurredOn: "2026-07-08",
      });
      const { id: incidentId }: { id: string } = await opened.json();
      ctx.trackCreatedIncident(incidentId);

      const bodyWork = await postExpense(token, {
        vehicleId,
        incidentId,
        category: "repairs",
        amountMinor: "70000",
        spentOn: "2026-07-28",
        borneBy: "us",
      });
      expect(bodyWork.status).toBe(201);
      const bodyWorkBody: { id: string } = await bodyWork.json();
      ctx.trackCreatedExpense(bodyWorkBody.id);

      const parts = await postExpense(token, {
        vehicleId,
        incidentId,
        category: "repairs",
        amountMinor: "25000",
        spentOn: "2026-08-05",
        borneBy: "us",
      });
      expect(parts.status).toBe(201);
      const partsBody: { id: string } = await parts.json();
      ctx.trackCreatedExpense(partsBody.id);

      const res = await getIncidentExpenses(token, incidentId);
      expect(res.status).toBe(200);
      const body: Array<{ id: string; category: string; amountMinor: string; spentOn: string }> =
        await res.json();
      // Newest first — the parts invoice (5 Aug) before the body work (28 Jul).
      expect(body.map((r) => r.id)).toEqual([partsBody.id, bodyWorkBody.id]);
      expect(body[0]).toMatchObject({ category: "repairs", amountMinor: "25000" });
      expect(body[1]).toMatchObject({ category: "repairs", amountMinor: "70000" });

      await ctx.cleanup();
    });

    it("401 — missing Authorization header", async () => {
      const res = await request(`/api/incident/${crypto.randomUUID()}/expense`);
      expect(res.status).toBe(401);
    });

    it("403 — a linked driver cannot read an incident's costs", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId);
      const vehicleId = await ctx.createVehicle(businessId);
      const driverId = await ctx.createDriver(businessId);
      const owner = await mintUser(db, ctx, businessId, "manager");
      const ownerToken = await signAccessToken(owner.asgardeoSub);
      const opened = await post("/api/incident", ownerToken, {
        vehicleId,
        occurredOn: "2026-07-08",
      });
      const { id: incidentId }: { id: string } = await opened.json();
      ctx.trackCreatedIncident(incidentId);

      const linked = await mintLinkedDriver(db, ctx, driverId);
      const token = await signAccessToken(linked.asgardeoSub);

      const res = await getIncidentExpenses(token, incidentId);
      expect(res.status).toBe(403);

      await ctx.cleanup();
    });

    it("404 — an incident belonging to another business", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
      await ctx.createOpenPeriod(otherBusinessId);
      const otherVehicleId = await ctx.createVehicle(otherBusinessId);
      const otherOwner = await mintUser(db, ctx, otherBusinessId, "manager");
      const otherToken = await signAccessToken(otherOwner.asgardeoSub);
      const otherIncident = await post("/api/incident", otherToken, {
        vehicleId: otherVehicleId,
        occurredOn: "2026-07-08",
      });
      const otherIncidentBody: { id: string } = await otherIncident.json();
      ctx.trackCreatedIncident(otherIncidentBody.id);

      const owner = await mintUser(db, ctx, businessId, "manager");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await getIncidentExpenses(token, otherIncidentBody.id);
      expect(res.status).toBe(404);

      await ctx.cleanup();
    });
  });
});
