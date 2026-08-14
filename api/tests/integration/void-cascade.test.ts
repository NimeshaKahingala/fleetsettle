import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { advance, deposit, obligation, offsetAllocation, payment } from "../../src/db/schema.js";
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

/**
 * GAP-12/W-61/INV-36: the nine remaining void-cascade tables, per
 * GAP-12-VOID-CASCADE-DESIGN.md §3 — `adjustment`, `offset_record`,
 * `deposit_movement`, `advance`, `advance_settlement`, `write_off`,
 * `write_off_recovery`, `incident_recovery`, `obligation`. Each test seeds
 * state with the `TestContext` factories or the real create endpoint, then
 * asserts the void's own cascade — a status recompute, an unwound
 * allocation, a refusal naming what still blocks it — not just the 200/409.
 */
describe("void cascades (GAP-12/W-61/INV-36)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  describe("adjustment (§3.1)", () => {
    it("happy path — reversing a waiver only lowers waived_minor", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const customerId = await ctx.createCustomer(businessId);
      const obligationId = await ctx.createObligation(businessId, periodId, {
        partyType: "customer",
        customerId,
        amountMinor: 10_000n,
      });
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const created = await post("/api/adjustment", token, {
        obligationId,
        adjustmentType: "waiver",
        amountMinor: "4000",
        sign: -1,
      });
      expect(created.status).toBe(201);
      const createdBody: { adjustmentId: string; waivedMinor: string } = await created.json();
      expect(createdBody.waivedMinor).toBe("4000");

      const res = await post(`/api/adjustment/${createdBody.adjustmentId}/void`, token, {
        reason: "waived by mistake, he never asked",
      });
      expect(res.status).toBe(200);
      const body: { obligation: { amountMinor: string; waivedMinor: string; status: string } } =
        await res.json();
      expect(body.obligation).toMatchObject({
        amountMinor: "10000",
        waivedMinor: "0",
        status: "pending",
      });

      const second = await post(`/api/adjustment/${createdBody.adjustmentId}/void`, token, {
        reason: "again",
      });
      expect(second.status).toBe(409);
      expect(await second.json()).toMatchObject({ code: "ADJUSTMENT_ALREADY_VOIDED" });

      await ctx.cleanup();
    });

    it("happy path — reversing a late fee that pushed amount below settled unwinds the payment allocation into credit", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const customerId = await ctx.createCustomer(businessId);
      const obligationId = await ctx.createObligation(businessId, periodId, {
        partyType: "customer",
        customerId,
        amountMinor: 1_000n,
        dueOn: "2026-07-05",
      });
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const fee = await post("/api/adjustment", token, {
        obligationId,
        adjustmentType: "late_fee",
        amountMinor: "500",
        sign: 1,
      });
      expect(fee.status).toBe(201);
      const feeBody: { adjustmentId: string; amountMinor: string } = await fee.json();
      expect(feeBody.amountMinor).toBe("1500");

      const paid = await post("/api/payment", token, {
        partyType: "customer",
        partyId: customerId,
        amountMinor: "1500",
        occurredOn: "2026-07-10",
      });
      expect(paid.status).toBe(201);
      const paidBody: { id: string } = await paid.json();
      ctx.trackCreatedPayment(paidBody.id);

      const res = await post(`/api/adjustment/${feeBody.adjustmentId}/void`, token, {
        reason: "fee applied to the wrong lease",
      });
      expect(res.status).toBe(200);
      const body: { obligation: { amountMinor: string; settledMinor: string; status: string } } =
        await res.json();
      expect(body.obligation).toMatchObject({ amountMinor: "1000", settledMinor: "1000" });

      await ctx.cleanup();
    });

    it("404 — an adjustment belonging to another business", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
      const otherPeriodId = await ctx.createOpenPeriod(otherBusinessId);
      const otherCustomerId = await ctx.createCustomer(otherBusinessId);
      const otherObligationId = await ctx.createObligation(otherBusinessId, otherPeriodId, {
        partyType: "customer",
        customerId: otherCustomerId,
      });
      const otherAdjustmentId = await ctx.createAdjustment(
        otherBusinessId,
        otherPeriodId,
        otherObligationId,
      );
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await post(`/api/adjustment/${otherAdjustmentId}/void`, token, { reason: "x" });
      expect(res.status).toBe(404);

      await ctx.cleanup();
    });
  });

  describe("obligation, direct void only (§3.10)", () => {
    it("happy path — a post-closure charge with nothing against it voids directly", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const driverId = await ctx.createDriver(businessId);
      const obligationId = await ctx.createObligation(businessId, periodId, {
        partyType: "driver",
        driverId,
        kind: "post_closure_charge",
      });
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await post(`/api/obligation/${obligationId}/void`, token, {
        reason: "fine was actually against a different driver",
      });
      expect(res.status).toBe(200);
      const body: { id: string; voidedAt: string } = await res.json();
      expect(body.voidedAt).toBeTruthy();

      await ctx.cleanup();
    });

    it("400 — a derived obligation (rent) cannot be voided directly", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const customerId = await ctx.createCustomer(businessId);
      const obligationId = await ctx.createObligation(businessId, periodId, {
        partyType: "customer",
        customerId,
        kind: "rent",
        sourceType: "billing_period",
      });
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await post(`/api/obligation/${obligationId}/void`, token, { reason: "x" });
      expect(res.status).toBe(400);

      await ctx.cleanup();
    });

    it("409 VOID_BLOCKED — a live adjustment against it blocks the void", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const driverId = await ctx.createDriver(businessId);
      const obligationId = await ctx.createObligation(businessId, periodId, {
        partyType: "driver",
        driverId,
        kind: "post_closure_charge",
        amountMinor: 5_000n,
      });
      await ctx.createAdjustment(businessId, periodId, obligationId, {
        adjustmentType: "waiver",
        amountMinor: 1_000n,
      });
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await post(`/api/obligation/${obligationId}/void`, token, { reason: "x" });
      expect(res.status).toBe(409);
      const body: { code: string; details?: { blocking?: Array<{ kind: string }> } } =
        await res.json();
      expect(body.code).toBe("VOID_BLOCKED");
      expect(body.details?.blocking).toEqual([expect.objectContaining({ kind: "adjustment" })]);

      await ctx.cleanup();
    });

    it("404 — an obligation belonging to another business", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
      const otherPeriodId = await ctx.createOpenPeriod(otherBusinessId);
      const otherDriverId = await ctx.createDriver(otherBusinessId);
      const otherObligationId = await ctx.createObligation(otherBusinessId, otherPeriodId, {
        partyType: "driver",
        driverId: otherDriverId,
        kind: "post_closure_charge",
      });
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await post(`/api/obligation/${otherObligationId}/void`, token, { reason: "x" });
      expect(res.status).toBe(404);

      await ctx.cleanup();
    });
  });

  describe("deposit_movement (§3.3/§3.4)", () => {
    it("happy path — voiding a refunded movement recomputes deposit.status back to held", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const driverId = await ctx.createDriver(businessId);
      const depositId = await ctx.createDeposit(businessId, { partyType: "driver", driverId });
      await ctx.createDepositMovement(businessId, periodId, depositId, {
        movementType: "taken",
        amountMinor: 25_000n,
      });
      const refundId = await ctx.createDepositMovement(businessId, periodId, depositId, {
        movementType: "refunded",
        amountMinor: 25_000n,
      });
      await db.update(deposit).set({ status: "released" }).where(eq(deposit.id, depositId));
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await post(`/api/deposit/${depositId}/movement/${refundId}/void`, token, {
        reason: "refund recorded against the wrong deposit",
      });
      expect(res.status).toBe(200);
      const body: { deposit: { status: string; heldMinor: string } } = await res.json();
      expect(body.deposit).toMatchObject({ status: "held", heldMinor: "25000" });

      await ctx.cleanup();
    });

    it("404 — a deposit movement belonging to another business", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
      const otherPeriodId = await ctx.createOpenPeriod(otherBusinessId);
      const otherDriverId = await ctx.createDriver(otherBusinessId);
      const otherDepositId = await ctx.createDeposit(otherBusinessId, {
        partyType: "driver",
        driverId: otherDriverId,
      });
      const otherMovementId = await ctx.createDepositMovement(
        otherBusinessId,
        otherPeriodId,
        otherDepositId,
      );
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await post(
        `/api/deposit/${otherDepositId}/movement/${otherMovementId}/void`,
        token,
        { reason: "x" },
      );
      expect(res.status).toBe(404);

      await ctx.cleanup();
    });
  });

  describe("advance and advance_settlement (§3.5/§3.6)", () => {
    it("happy path — voiding a settlement recomputes advance.status back to open", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId);
      const driverId = await ctx.createDriver(businessId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const issued = await post("/api/advance", token, {
        driverId,
        amountMinor: "5000",
        issuedOn: "2026-07-10",
      });
      const issuedBody: { id: string } = await issued.json();
      ctx.trackCreatedAdvance(issuedBody.id);

      const settled = await post(`/api/advance/${issuedBody.id}/settle`, token, {
        kind: "returned",
        amountMinor: "5000",
        occurredOn: "2026-07-15",
      });
      expect(settled.status).toBe(200);
      const settledBody: { status: string; settlementId: string } = await settled.json();
      expect(settledBody.status).toBe("settled");

      const res = await post(
        `/api/advance/${issuedBody.id}/settlement/${settledBody.settlementId}/void`,
        token,
        { reason: "he never actually returned it" },
      );
      expect(res.status).toBe(200);
      const body: { advance: { status: string; settledMinor: string } } = await res.json();
      expect(body.advance).toMatchObject({ status: "open", settledMinor: "0" });

      const row = await db
        .select({ status: advance.status })
        .from(advance)
        .where(eq(advance.id, issuedBody.id));
      expect(row[0]?.status).toBe("open");

      await ctx.cleanup();
    });

    it("409 VOID_BLOCKED — an advance with a live settlement refuses to void", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId);
      const driverId = await ctx.createDriver(businessId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const issued = await post("/api/advance", token, {
        driverId,
        amountMinor: "5000",
        issuedOn: "2026-07-10",
      });
      const issuedBody: { id: string } = await issued.json();
      ctx.trackCreatedAdvance(issuedBody.id);

      const settled = await post(`/api/advance/${issuedBody.id}/settle`, token, {
        kind: "spent",
        amountMinor: "2000",
        occurredOn: "2026-07-15",
      });
      const settledBody: { settlementId: string } = await settled.json();

      const res = await post(`/api/advance/${issuedBody.id}/void`, token, { reason: "x" });
      expect(res.status).toBe(409);
      const body: { code: string; details?: { blocking?: Array<{ kind: string; id: string }> } } =
        await res.json();
      expect(body.code).toBe("VOID_BLOCKED");
      expect(body.details?.blocking).toEqual([
        expect.objectContaining({ kind: "settlement", id: settledBody.settlementId }),
      ]);

      await ctx.cleanup();
    });

    it("happy path — an advance with no settlements voids directly", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId);
      const driverId = await ctx.createDriver(businessId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const issued = await post("/api/advance", token, {
        driverId,
        amountMinor: "5000",
        issuedOn: "2026-07-10",
      });
      const issuedBody: { id: string } = await issued.json();
      ctx.trackCreatedAdvance(issuedBody.id);

      const res = await post(`/api/advance/${issuedBody.id}/void`, token, {
        reason: "issued in error, driver never took it",
      });
      expect(res.status).toBe(200);

      const second = await post(`/api/advance/${issuedBody.id}/void`, token, { reason: "again" });
      expect(second.status).toBe(409);
      expect(await second.json()).toMatchObject({ code: "ADVANCE_ALREADY_VOIDED" });

      await ctx.cleanup();
    });

    it("404 — a settlement belonging to another business", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
      const otherPeriodId = await ctx.createOpenPeriod(otherBusinessId);
      const otherDriverId = await ctx.createDriver(otherBusinessId);
      const otherAdvanceId = await ctx.createAdvance(otherBusinessId, otherPeriodId, otherDriverId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await post(
        `/api/advance/${otherAdvanceId}/settlement/${crypto.randomUUID()}/void`,
        token,
        { reason: "x" },
      );
      expect(res.status).toBe(404);

      await ctx.cleanup();
    });
  });

  describe("write_off and write_off_recovery (§3.7/§3.8)", () => {
    it("happy path — voiding a write-off restores the obligation's prior status", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const customerId = await ctx.createCustomer(businessId);
      const obligationId = await ctx.createObligation(businessId, periodId, {
        partyType: "customer",
        customerId,
        amountMinor: 60_000n,
        settledMinor: 10_000n,
        status: "part_paid",
      });
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const created = await post("/api/write-off", token, {
        obligationId,
        partyType: "customer",
        partyCustomerId: customerId,
        amountMinor: "50000",
        reason: "customer vanished",
        writtenOffOn: "2026-07-20",
      });
      const createdBody: { id: string } = await created.json();
      ctx.trackCreatedWriteOff(createdBody.id);

      const res = await post(`/api/write-off/${createdBody.id}/void`, token, {
        reason: "he actually turned up and paid the rest",
      });
      expect(res.status).toBe(200);

      const row = await db
        .select({ status: obligation.status, settledMinor: obligation.settledMinor })
        .from(obligation)
        .where(eq(obligation.id, obligationId));
      expect(row[0]).toMatchObject({ status: "part_paid", settledMinor: 10_000n });

      const second = await post(`/api/write-off/${createdBody.id}/void`, token, {
        reason: "again",
      });
      expect(second.status).toBe(409);
      expect(await second.json()).toMatchObject({ code: "WRITE_OFF_ALREADY_VOIDED" });

      await ctx.cleanup();
    });

    it("409 VOID_BLOCKED — a write-off with a live recovery refuses to void", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId);
      const customerId = await ctx.createCustomer(businessId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const created = await post("/api/write-off", token, {
        partyType: "customer",
        partyCustomerId: customerId,
        amountMinor: "40000",
        reason: "written off last quarter",
        writtenOffOn: "2026-07-01",
      });
      const createdBody: { id: string } = await created.json();
      ctx.trackCreatedWriteOff(createdBody.id);

      const recovered = await post(`/api/write-off/${createdBody.id}/recovery`, token, {
        amountMinor: "40000",
        occurredOn: "2026-07-25",
      });
      // No separate trackCreatedPayment here — trackCreatedWriteOff (above)
      // already deletes this write-off's own recoveries and their payments,
      // and it must run after this payment is created but the teardown
      // order is LIFO, so tracking the payment separately here would delete
      // it first and violate write_off_recovery's FK on the way out.
      const recoveredBody: { id: string; paymentId: string } = await recovered.json();

      const res = await post(`/api/write-off/${createdBody.id}/void`, token, { reason: "x" });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "VOID_BLOCKED" });

      await ctx.cleanup();
    });

    it("happy path — voiding a recovery cascades to mark its payment reversed (INV-15)", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId);
      const customerId = await ctx.createCustomer(businessId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const created = await post("/api/write-off", token, {
        partyType: "customer",
        partyCustomerId: customerId,
        amountMinor: "40000",
        reason: "written off last quarter",
        writtenOffOn: "2026-07-01",
      });
      const createdBody: { id: string } = await created.json();
      ctx.trackCreatedWriteOff(createdBody.id);

      const recovered = await post(`/api/write-off/${createdBody.id}/recovery`, token, {
        amountMinor: "40000",
        occurredOn: "2026-07-25",
      });
      // No separate trackCreatedPayment here — trackCreatedWriteOff (above)
      // already deletes this write-off's own recoveries and their payments,
      // and it must run after this payment is created but the teardown
      // order is LIFO, so tracking the payment separately here would delete
      // it first and violate write_off_recovery's FK on the way out.
      const recoveredBody: { id: string; paymentId: string } = await recovered.json();

      const res = await post(
        `/api/write-off/${createdBody.id}/recovery/${recoveredBody.id}/void`,
        token,
        { reason: "recorded against the wrong customer's write-off" },
      );
      expect(res.status).toBe(200);

      const row = await db
        .select({ status: payment.status })
        .from(payment)
        .where(eq(payment.id, recoveredBody.paymentId));
      expect(row[0]?.status).toBe("reversed");

      await ctx.cleanup();
    });

    it("404 — a write-off belonging to another business", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
      await ctx.createOpenPeriod(otherBusinessId);
      const otherCustomerId = await ctx.createCustomer(otherBusinessId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const otherOwner = await mintUser(db, ctx, otherBusinessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);
      const otherToken = await signAccessToken(otherOwner.asgardeoSub);

      const created = await post("/api/write-off", otherToken, {
        partyType: "customer",
        partyCustomerId: otherCustomerId,
        amountMinor: "10000",
        reason: "x",
        writtenOffOn: "2026-07-01",
      });
      const createdBody: { id: string } = await created.json();
      ctx.trackCreatedWriteOff(createdBody.id);

      const res = await post(`/api/write-off/${createdBody.id}/void`, token, { reason: "x" });
      expect(res.status).toBe(404);

      await ctx.cleanup();
    });
  });

  describe("incident_recovery (§3.9), and recordRecoveryReceived's own fix", () => {
    it("409 VOID_BLOCKED — a recovery already received refuses to void", async () => {
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
      const agreedBody: { id: string } = await agreed.json();

      await post(`/api/incident/${incidentId}/recovery/${agreedBody.id}/receive`, token, {
        receivedAmountMinor: "20000",
        receivedOn: "2026-07-25",
      });

      const res = await post(`/api/incident/${incidentId}/recovery/${agreedBody.id}/void`, token, {
        reason: "x",
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "VOID_BLOCKED" });

      await ctx.cleanup();
    });

    it("happy path — an unreceived recovery voids and cascades its own obligation", async () => {
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
      const agreedBody: { id: string } = await agreed.json();

      const res = await post(`/api/incident/${incidentId}/recovery/${agreedBody.id}/void`, token, {
        reason: "agreed with the wrong customer, incident had no contribution after all",
      });
      expect(res.status).toBe(200);

      const rows = await db
        .select({ voidedAt: obligation.voidedAt })
        .from(obligation)
        .where(eq(obligation.sourceId, agreedBody.id));
      expect(rows[0]?.voidedAt).toBeTruthy();

      const second = await post(
        `/api/incident/${incidentId}/recovery/${agreedBody.id}/void`,
        token,
        { reason: "again" },
      );
      expect(second.status).toBe(409);
      expect(await second.json()).toMatchObject({ code: "INCIDENT_RECOVERY_ALREADY_VOIDED" });

      await ctx.cleanup();
    });

    it("regression (GAP-12 §3.9) — re-recording a corrected amount never leaves two active payments", async () => {
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
      const agreedBody: { id: string } = await agreed.json();

      // Fat-fingered the first time — 12,000 instead of 20,000 — then corrected.
      await post(`/api/incident/${incidentId}/recovery/${agreedBody.id}/receive`, token, {
        receivedAmountMinor: "12000",
        receivedOn: "2026-07-25",
      });
      const corrected = await post(
        `/api/incident/${incidentId}/recovery/${agreedBody.id}/receive`,
        token,
        { receivedAmountMinor: "20000", receivedOn: "2026-07-26" },
      );
      expect(corrected.status).toBe(200);

      const payments = await db
        .select({ id: payment.id, amountMinor: payment.amountMinor, status: payment.status })
        .from(payment)
        .where(eq(payment.partyCustomerId, customerId));
      const stillActive = payments.filter((p) => p.status === "active");
      expect(stillActive).toHaveLength(1);
      expect(stillActive[0]?.amountMinor).toBe(20_000n);

      const rows = await db
        .select({ settledMinor: obligation.settledMinor, status: obligation.status })
        .from(obligation)
        .where(eq(obligation.sourceId, agreedBody.id));
      expect(rows[0]).toMatchObject({ settledMinor: 20_000n, status: "paid" });

      await ctx.cleanup();
    });

    it("404 — a recovery belonging to another business", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
      await ctx.createOpenPeriod(otherBusinessId);
      const otherVehicleId = await ctx.createVehicle(otherBusinessId);
      const otherCustomerId = await ctx.createCustomer(otherBusinessId);
      const otherLeaseId = await ctx.createLease(otherBusinessId, otherVehicleId, otherCustomerId);
      const owner = await mintUser(db, ctx, businessId, "manager");
      const otherOwner = await mintUser(db, ctx, otherBusinessId, "manager");
      const token = await signAccessToken(owner.asgardeoSub);
      const otherToken = await signAccessToken(otherOwner.asgardeoSub);

      const opened = await post("/api/incident", otherToken, {
        vehicleId: otherVehicleId,
        leaseId: otherLeaseId,
        occurredOn: "2026-07-08",
      });
      const { id: otherIncidentId }: { id: string } = await opened.json();
      ctx.trackCreatedIncident(otherIncidentId);

      const agreed = await post(
        `/api/incident/${otherIncidentId}/customer-contribution`,
        otherToken,
        {
          agreedAmountMinor: "20000",
          agreedOn: "2026-07-20",
        },
      );
      const agreedBody: { id: string } = await agreed.json();

      const res = await post(
        `/api/incident/${otherIncidentId}/recovery/${agreedBody.id}/void`,
        token,
        { reason: "x" },
      );
      expect(res.status).toBe(404);

      await ctx.cleanup();
    });
  });

  describe("offset_record (§3.2, migration 0024)", () => {
    it("happy path — voiding unwinds both sides symmetrically (INV-3)", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const driverId = await ctx.createDriver(businessId);
      const dueObligationId = await ctx.createObligation(businessId, periodId, {
        direction: "owed_to_us",
        partyType: "driver",
        driverId,
        amountMinor: 5_000n,
        dueOn: "2026-07-01",
      });
      const payableObligationId = await ctx.createObligation(businessId, periodId, {
        direction: "owed_by_us",
        partyType: "driver",
        driverId,
        amountMinor: 5_000n,
        dueOn: "2026-07-01",
      });
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const created = await post("/api/offset", token, {
        driverId,
        amountMinor: "5000",
        occurredOn: "2026-07-10",
      });
      expect(created.status).toBe(201);
      const createdBody: { id: string } = await created.json();
      ctx.trackCreatedOffset(createdBody.id);

      const afterOffset = await db
        .select({
          id: obligation.id,
          settledMinor: obligation.settledMinor,
          status: obligation.status,
        })
        .from(obligation)
        .where(eq(obligation.id, dueObligationId));
      expect(afterOffset[0]).toMatchObject({ settledMinor: 5_000n, status: "paid" });

      const res = await post(`/api/offset/${createdBody.id}/void`, token, {
        reason: "offset recorded against the wrong driver",
      });
      expect(res.status).toBe(200);

      const dueAfterVoid = await db
        .select({ settledMinor: obligation.settledMinor, status: obligation.status })
        .from(obligation)
        .where(eq(obligation.id, dueObligationId));
      expect(dueAfterVoid[0]).toMatchObject({ settledMinor: 0n, status: "pending" });

      const payableAfterVoid = await db
        .select({ settledMinor: obligation.settledMinor, status: obligation.status })
        .from(obligation)
        .where(eq(obligation.id, payableObligationId));
      expect(payableAfterVoid[0]).toMatchObject({ settledMinor: 0n, status: "pending" });

      const allocations = await db
        .select({ voidedAt: offsetAllocation.voidedAt })
        .from(offsetAllocation)
        .where(eq(offsetAllocation.offsetId, createdBody.id));
      expect(allocations.length).toBeGreaterThan(0);
      for (const alloc of allocations) expect(alloc.voidedAt).toBeTruthy();

      const second = await post(`/api/offset/${createdBody.id}/void`, token, { reason: "again" });
      expect(second.status).toBe(409);
      expect(await second.json()).toMatchObject({ code: "OFFSET_RECORD_ALREADY_VOIDED" });

      await ctx.cleanup();
    });

    it("404 — an offset belonging to another business", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
      const otherPeriodId = await ctx.createOpenPeriod(otherBusinessId);
      const otherDriverId = await ctx.createDriver(otherBusinessId);
      const otherOwner = await mintUser(db, ctx, otherBusinessId, "owner");
      const otherOffsetId = await ctx.createOffsetRecord(
        otherBusinessId,
        otherPeriodId,
        otherDriverId,
        otherOwner.userId,
      );
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await post(`/api/offset/${otherOffsetId}/void`, token, { reason: "x" });
      expect(res.status).toBe(404);

      await ctx.cleanup();
    });
  });
});
