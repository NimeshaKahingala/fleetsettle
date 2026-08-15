import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import {
  advance,
  deposit,
  incidentRecovery,
  obligation,
  offsetAllocation,
  payment,
} from "../../src/db/schema.js";
import { recordIncidentRecoveryReceived } from "../../src/queries/incident.js";
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

    it("happy path — voiding an 'applied' movement (GAP-6) reverses the obligation it settled", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const driverId = await ctx.createDriver(businessId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const obligationId = await ctx.createObligation(businessId, periodId, {
        direction: "owed_to_us",
        driverId,
        amountMinor: 50_000n,
        dueOn: "2026-07-05",
      });

      const takeRes = await post("/api/deposit", token, {
        driverId,
        amountMinor: "30000",
        occurredOn: "2026-07-01",
      });
      const taken: { id: string } = await takeRes.json();
      ctx.trackCreatedDeposit(taken.id);

      const applyRes = await post(`/api/deposit/${taken.id}/movement`, token, {
        movementType: "applied",
        amountMinor: "30000",
        occurredOn: "2026-07-10",
        obligationId,
      });
      expect(applyRes.status).toBe(200);
      const applied: { movementId: string } = await applyRes.json();

      const [beforeVoid] = await db
        .select()
        .from(obligation)
        .where(eq(obligation.id, obligationId));
      expect(beforeVoid).toMatchObject({ settledMinor: 30_000n, status: "part_paid" });

      const voidRes = await post(
        `/api/deposit/${taken.id}/movement/${applied.movementId}/void`,
        token,
        { reason: "applied against the wrong obligation" },
      );
      expect(voidRes.status).toBe(200);
      const voidedBody: { deposit: { status: string; heldMinor: string } } = await voidRes.json();
      expect(voidedBody.deposit).toMatchObject({ status: "held", heldMinor: "30000" });

      const [afterVoid] = await db.select().from(obligation).where(eq(obligation.id, obligationId));
      expect(afterVoid).toMatchObject({ settledMinor: 0n, status: "pending" });

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
      expect(recovered.status).toBe(201);

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

    it("regression — recordIncidentRecoveryReceived's own UPDATE is a no-op once the recovery is voided", async () => {
      // The domain function's own pre-transaction read means a sequential
      // "void, then receive" HTTP call never reaches this — it 404s before
      // ever touching the query. This is the race that pre-check can't
      // catch: a concurrent voidIncidentRecovery commits between that read
      // and this UPDATE. Exercised directly at the query layer, which is
      // exactly what closes the race — the UPDATE's own `voided_at IS NULL`
      // guard, not a second application-level check.
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

      const voided = await post(
        `/api/incident/${incidentId}/recovery/${agreedBody.id}/void`,
        token,
        { reason: "the concurrent void this test simulates" },
      );
      expect(voided.status).toBe(200);

      const updated = await recordIncidentRecoveryReceived(db, agreedBody.id, {
        receivedAmountMinor: 20_000n,
      });
      expect(updated).toBeUndefined();

      const [row] = await db
        .select({ receivedAmountMinor: incidentRecovery.receivedAmountMinor })
        .from(incidentRecovery)
        .where(eq(incidentRecovery.id, agreedBody.id));
      expect(row?.receivedAmountMinor).toBe(0n);

      const payments = await db
        .select({ id: payment.id })
        .from(payment)
        .where(eq(payment.partyCustomerId, customerId));
      expect(payments).toHaveLength(0);

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

/**
 * GAP-60/D-16: "the replacement writes replaces_id, not the void" — F-8.5's
 * replace half, for every table this file's own void cascades already
 * cover (bar the three landed earlier in partner-void.test.ts, and
 * obligation's own direct-void case in post-closure-charge.test.ts).
 */
describe("replace a voided record (GAP-60/D-16)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  describe("adjustment", () => {
    it("happy path — a fresh adjustment naming a voided one as replacesId links the two", async () => {
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
      const createdBody: { adjustmentId: string } = await created.json();
      await post(`/api/adjustment/${createdBody.adjustmentId}/void`, token, {
        reason: "waived by mistake",
      });

      const res = await post("/api/adjustment", token, {
        obligationId,
        adjustmentType: "waiver",
        amountMinor: "4000",
        sign: -1,
        replacesId: createdBody.adjustmentId,
      });
      expect(res.status).toBe(201);
      const body: { replacesId: string | null } = await res.json();
      expect(body.replacesId).toBe(createdBody.adjustmentId);

      await ctx.cleanup();
    });

    it("409 — replacesId names an adjustment that has not been voided yet", async () => {
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

      const live = await post("/api/adjustment", token, {
        obligationId,
        adjustmentType: "waiver",
        amountMinor: "4000",
        sign: -1,
      });
      const liveBody: { adjustmentId: string } = await live.json();

      const res = await post("/api/adjustment", token, {
        obligationId,
        adjustmentType: "waiver",
        amountMinor: "1000",
        sign: -1,
        replacesId: liveBody.adjustmentId,
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "REPLACES_TARGET_NOT_VOIDED" });

      await ctx.cleanup();
    });
  });

  describe("deposit_movement", () => {
    it("happy path — a fresh movement naming a voided one as replacesId links the two", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const driverId = await ctx.createDriver(businessId);
      const depositId = await ctx.createDeposit(businessId, { partyType: "driver", driverId });
      await ctx.createDepositMovement(businessId, periodId, depositId, {
        movementType: "taken",
        amountMinor: 25_000n,
      });
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const created = await post(`/api/deposit/${depositId}/movement`, token, {
        movementType: "reduced",
        amountMinor: "5000",
        occurredOn: "2026-07-12",
        reason: "damage deduction",
      });
      const createdBody: { movementId: string } = await created.json();
      await post(`/api/deposit/${depositId}/movement/${createdBody.movementId}/void`, token, {
        reason: "wrong deposit",
      });

      const res = await post(`/api/deposit/${depositId}/movement`, token, {
        movementType: "reduced",
        amountMinor: "6000",
        occurredOn: "2026-07-12",
        reason: "damage deduction, corrected amount",
        replacesId: createdBody.movementId,
      });
      expect(res.status).toBe(200);
      const body: { movementReplacesId: string | null } = await res.json();
      expect(body.movementReplacesId).toBe(createdBody.movementId);

      await ctx.cleanup();
    });

    it("409 — replacesId names a movement that has not been voided yet", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const driverId = await ctx.createDriver(businessId);
      const depositId = await ctx.createDeposit(businessId, { partyType: "driver", driverId });
      await ctx.createDepositMovement(businessId, periodId, depositId, {
        movementType: "taken",
        amountMinor: 25_000n,
      });
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const live = await post(`/api/deposit/${depositId}/movement`, token, {
        movementType: "reduced",
        amountMinor: "5000",
        occurredOn: "2026-07-12",
        reason: "damage deduction",
      });
      const liveBody: { movementId: string } = await live.json();

      const res = await post(`/api/deposit/${depositId}/movement`, token, {
        movementType: "reduced",
        amountMinor: "1000",
        occurredOn: "2026-07-12",
        reason: "x",
        replacesId: liveBody.movementId,
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "REPLACES_TARGET_NOT_VOIDED" });

      await ctx.cleanup();
    });
  });

  describe("advance and advance_settlement", () => {
    it("advance — happy path, then 409 when replacesId has already been replaced", async () => {
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
      await post(`/api/advance/${issuedBody.id}/void`, token, { reason: "issued in error" });

      const firstReplacement = await post("/api/advance", token, {
        driverId,
        amountMinor: "5000",
        issuedOn: "2026-07-10",
        replacesId: issuedBody.id,
      });
      expect(firstReplacement.status).toBe(201);
      const firstReplacementBody: { id: string; replacesId: string | null } =
        await firstReplacement.json();
      expect(firstReplacementBody.replacesId).toBe(issuedBody.id);
      ctx.trackCreatedAdvance(firstReplacementBody.id);

      const secondReplacement = await post("/api/advance", token, {
        driverId,
        amountMinor: "5500",
        issuedOn: "2026-07-10",
        replacesId: issuedBody.id,
      });
      expect(secondReplacement.status).toBe(409);
      expect(await secondReplacement.json()).toMatchObject({
        code: "REPLACES_TARGET_ALREADY_REPLACED",
      });

      await ctx.cleanup();
    });

    it("advance_settlement — happy path links the settlement's replacement, and 409 when not voided yet", async () => {
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

      const notVoidedYet = await post(`/api/advance/${issuedBody.id}/settle`, token, {
        kind: "spent",
        amountMinor: "500",
        occurredOn: "2026-07-16",
        replacesId: settledBody.settlementId,
      });
      expect(notVoidedYet.status).toBe(409);
      expect(await notVoidedYet.json()).toMatchObject({ code: "REPLACES_TARGET_NOT_VOIDED" });

      await post(
        `/api/advance/${issuedBody.id}/settlement/${settledBody.settlementId}/void`,
        token,
        { reason: "wrong amount" },
      );

      const res = await post(`/api/advance/${issuedBody.id}/settle`, token, {
        kind: "spent",
        amountMinor: "2500",
        occurredOn: "2026-07-16",
        replacesId: settledBody.settlementId,
      });
      expect(res.status).toBe(200);
      const body: { settlementReplacesId: string | null } = await res.json();
      expect(body.settlementReplacesId).toBe(settledBody.settlementId);

      await ctx.cleanup();
    });
  });

  describe("write_off and write_off_recovery", () => {
    it("write_off — happy path links the replacement to the voided original", async () => {
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
      await post(`/api/write-off/${createdBody.id}/void`, token, { reason: "wrong customer" });

      const res = await post("/api/write-off", token, {
        partyType: "customer",
        partyCustomerId: customerId,
        amountMinor: "40000",
        reason: "written off last quarter, correct customer",
        writtenOffOn: "2026-07-01",
        replacesId: createdBody.id,
      });
      expect(res.status).toBe(201);
      const body: { id: string; replacesId: string | null } = await res.json();
      expect(body.replacesId).toBe(createdBody.id);
      ctx.trackCreatedWriteOff(body.id);

      await ctx.cleanup();
    });

    it("write_off_recovery — happy path links the replacement, and 409 when it's already replaced", async () => {
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
        amountMinor: "10000",
        occurredOn: "2026-07-25",
      });
      const recoveredBody: { id: string } = await recovered.json();
      await post(`/api/write-off/${createdBody.id}/recovery/${recoveredBody.id}/void`, token, {
        reason: "wrong amount",
      });

      const firstReplacement = await post(`/api/write-off/${createdBody.id}/recovery`, token, {
        amountMinor: "15000",
        occurredOn: "2026-07-26",
        replacesId: recoveredBody.id,
      });
      expect(firstReplacement.status).toBe(201);
      const firstReplacementBody: { replacesId: string | null } = await firstReplacement.json();
      expect(firstReplacementBody.replacesId).toBe(recoveredBody.id);

      const secondReplacement = await post(`/api/write-off/${createdBody.id}/recovery`, token, {
        amountMinor: "16000",
        occurredOn: "2026-07-27",
        replacesId: recoveredBody.id,
      });
      expect(secondReplacement.status).toBe(409);
      expect(await secondReplacement.json()).toMatchObject({
        code: "REPLACES_TARGET_ALREADY_REPLACED",
      });

      await ctx.cleanup();
    });
  });

  describe("incident_recovery", () => {
    it("customer contribution — happy path links the replacement to the voided original", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId);
      const vehicleId = await ctx.createVehicle(businessId);
      const customerId = await ctx.createCustomer(businessId);
      const leaseId = await ctx.createLease(businessId, vehicleId, customerId);
      const manager = await mintUser(db, ctx, businessId, "manager");
      const token = await signAccessToken(manager.asgardeoSub);

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
      await post(`/api/incident/${incidentId}/recovery/${agreedBody.id}/void`, token, {
        reason: "amount agreed wrong",
      });

      const res = await post(`/api/incident/${incidentId}/customer-contribution`, token, {
        agreedAmountMinor: "25000",
        agreedOn: "2026-07-20",
        replacesId: agreedBody.id,
      });
      expect(res.status).toBe(201);
      const body: { replacesId: string | null } = await res.json();
      expect(body.replacesId).toBe(agreedBody.id);

      await ctx.cleanup();
    });

    it("customer contribution — 409 when replacesId names one not voided yet", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId);
      const vehicleId = await ctx.createVehicle(businessId);
      const customerId = await ctx.createCustomer(businessId);
      const leaseId = await ctx.createLease(businessId, vehicleId, customerId);
      const manager = await mintUser(db, ctx, businessId, "manager");
      const token = await signAccessToken(manager.asgardeoSub);

      const opened = await post("/api/incident", token, {
        vehicleId,
        leaseId,
        occurredOn: "2026-07-08",
      });
      const { id: incidentId }: { id: string } = await opened.json();
      ctx.trackCreatedIncident(incidentId);

      const live = await post(`/api/incident/${incidentId}/customer-contribution`, token, {
        agreedAmountMinor: "20000",
        agreedOn: "2026-07-20",
      });
      const liveBody: { id: string } = await live.json();

      const res = await post(`/api/incident/${incidentId}/customer-contribution`, token, {
        agreedAmountMinor: "25000",
        agreedOn: "2026-07-20",
        replacesId: liveBody.id,
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "REPLACES_TARGET_NOT_VOIDED" });

      await ctx.cleanup();
    });

    it("insurance claim — the paired recovery row links to the one it replaces", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId);
      const vehicleId = await ctx.createVehicle(businessId);
      const customerId = await ctx.createCustomer(businessId);
      const leaseId = await ctx.createLease(businessId, vehicleId, customerId);
      const manager = await mintUser(db, ctx, businessId, "manager");
      const token = await signAccessToken(manager.asgardeoSub);

      const opened = await post("/api/incident", token, {
        vehicleId,
        leaseId,
        occurredOn: "2026-07-08",
      });
      const { id: incidentId }: { id: string } = await opened.json();
      ctx.trackCreatedIncident(incidentId);

      const claimed = await post(`/api/incident/${incidentId}/insurance-claim`, token, {
        claimedAmountMinor: "75000",
        excessBorneMinor: "15000",
        claimedOn: "2026-07-08",
      });
      expect(claimed.status).toBe(201);

      const recoveries = await db
        .select({ id: incidentRecovery.id, voidedAt: incidentRecovery.voidedAt })
        .from(incidentRecovery)
        .where(eq(incidentRecovery.incidentId, incidentId));
      const insurerRecovery = recoveries[0];
      if (!insurerRecovery)
        throw new Error("expected the insurer recovery row submitting the claim just wrote");

      const voidRes = await post(
        `/api/incident/${incidentId}/recovery/${insurerRecovery.id}/void`,
        token,
        { reason: "claim withdrawn, resubmitting at the right amount" },
      );
      expect(voidRes.status).toBe(200);

      const resubmitted = await post(`/api/incident/${incidentId}/insurance-claim`, token, {
        claimedAmountMinor: "80000",
        excessBorneMinor: "15000",
        claimedOn: "2026-07-08",
        replacesId: insurerRecovery.id,
      });
      expect(resubmitted.status).toBe(201);

      const rows = await db
        .select({ replacesId: incidentRecovery.replacesId })
        .from(incidentRecovery)
        .where(eq(incidentRecovery.incidentId, incidentId));
      expect(rows.map((r) => r.replacesId)).toContain(insurerRecovery.id);

      await ctx.cleanup();
    });
  });

  describe("offset_record", () => {
    it("happy path — a fresh offset naming a voided one as replacesId links the two", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const driverId = await ctx.createDriver(businessId);
      await ctx.createObligation(businessId, periodId, {
        direction: "owed_to_us",
        partyType: "driver",
        driverId,
        amountMinor: 5_000n,
        dueOn: "2026-07-01",
      });
      await ctx.createObligation(businessId, periodId, {
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
      const createdBody: { id: string } = await created.json();
      ctx.trackCreatedOffset(createdBody.id);
      await post(`/api/offset/${createdBody.id}/void`, token, {
        reason: "recorded against the wrong driver",
      });

      const res = await post("/api/offset", token, {
        driverId,
        amountMinor: "5000",
        occurredOn: "2026-07-10",
        replacesId: createdBody.id,
      });
      expect(res.status).toBe(201);
      const body: { id: string; replacesId: string | null } = await res.json();
      expect(body.replacesId).toBe(createdBody.id);
      ctx.trackCreatedOffset(body.id);

      await ctx.cleanup();
    });

    it("409 — replacesId names an offset that has not been voided yet", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const driverId = await ctx.createDriver(businessId);
      await ctx.createObligation(businessId, periodId, {
        direction: "owed_to_us",
        partyType: "driver",
        driverId,
        amountMinor: 10_000n,
        dueOn: "2026-07-01",
      });
      await ctx.createObligation(businessId, periodId, {
        direction: "owed_by_us",
        partyType: "driver",
        driverId,
        amountMinor: 10_000n,
        dueOn: "2026-07-01",
      });
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const live = await post("/api/offset", token, {
        driverId,
        amountMinor: "5000",
        occurredOn: "2026-07-10",
      });
      const liveBody: { id: string } = await live.json();
      ctx.trackCreatedOffset(liveBody.id);

      const res = await post("/api/offset", token, {
        driverId,
        amountMinor: "3000",
        occurredOn: "2026-07-10",
        replacesId: liveBody.id,
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "REPLACES_TARGET_NOT_VOIDED" });

      await ctx.cleanup();
    });
  });
});

/**
 * Found by Gitar's review of PR #45: the replacesId checks above proved the
 * target belongs to this business and is voided, but never that it belongs
 * to the *same parent* as the new record — an adjustment could name a voided
 * adjustment against a different obligation, a recovery a different
 * incident, and so on, leaving F-8.6's "what corrected this?" pointing at an
 * unrelated fact. Every table with a real single-parent shape now refuses
 * (400) a replacesId that crosses parents; `expense` is deliberately exempt
 * (F-8.5 names "wrong vehicle" as a legitimate correction).
 */
describe("replacesId across a different parent is refused (Gitar, PR #45)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("adjustment — replacesId naming an adjustment against a different obligation", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const customerId = await ctx.createCustomer(businessId);
    const obligationA = await ctx.createObligation(businessId, periodId, {
      partyType: "customer",
      customerId,
      amountMinor: 10_000n,
    });
    const obligationB = await ctx.createObligation(businessId, periodId, {
      partyType: "customer",
      customerId,
      amountMinor: 10_000n,
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const voidedOnA = await post("/api/adjustment", token, {
      obligationId: obligationA,
      adjustmentType: "waiver",
      amountMinor: "1000",
      sign: -1,
    });
    const voidedOnABody: { adjustmentId: string } = await voidedOnA.json();
    await post(`/api/adjustment/${voidedOnABody.adjustmentId}/void`, token, { reason: "x" });

    const res = await post("/api/adjustment", token, {
      obligationId: obligationB,
      adjustmentType: "waiver",
      amountMinor: "1000",
      sign: -1,
      replacesId: voidedOnABody.adjustmentId,
    });
    expect(res.status).toBe(400);

    await ctx.cleanup();
  });

  it("incident_recovery — replacesId naming a recovery against a different incident", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const customerId = await ctx.createCustomer(businessId);
    const leaseId = await ctx.createLease(businessId, vehicleId, customerId);
    const manager = await mintUser(db, ctx, businessId, "manager");
    const token = await signAccessToken(manager.asgardeoSub);

    const incidentA = await post("/api/incident", token, {
      vehicleId,
      leaseId,
      occurredOn: "2026-07-08",
    });
    const { id: incidentAId }: { id: string } = await incidentA.json();
    ctx.trackCreatedIncident(incidentAId);
    const incidentB = await post("/api/incident", token, {
      vehicleId,
      leaseId,
      occurredOn: "2026-07-09",
    });
    const { id: incidentBId }: { id: string } = await incidentB.json();
    ctx.trackCreatedIncident(incidentBId);

    const agreedOnA = await post(`/api/incident/${incidentAId}/customer-contribution`, token, {
      agreedAmountMinor: "20000",
      agreedOn: "2026-07-20",
    });
    const agreedOnABody: { id: string } = await agreedOnA.json();
    await post(`/api/incident/${incidentAId}/recovery/${agreedOnABody.id}/void`, token, {
      reason: "x",
    });

    const res = await post(`/api/incident/${incidentBId}/customer-contribution`, token, {
      agreedAmountMinor: "20000",
      agreedOn: "2026-07-20",
      replacesId: agreedOnABody.id,
    });
    expect(res.status).toBe(400);

    await ctx.cleanup();
  });

  it("offset_record — replacesId naming an offset against a different driver", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const driverA = await ctx.createDriver(businessId);
    const driverB = await ctx.createDriver(businessId);
    for (const driverId of [driverA, driverB]) {
      await ctx.createObligation(businessId, periodId, {
        direction: "owed_to_us",
        partyType: "driver",
        driverId,
        amountMinor: 5_000n,
        dueOn: "2026-07-01",
      });
      await ctx.createObligation(businessId, periodId, {
        direction: "owed_by_us",
        partyType: "driver",
        driverId,
        amountMinor: 5_000n,
        dueOn: "2026-07-01",
      });
    }
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const onDriverA = await post("/api/offset", token, {
      driverId: driverA,
      amountMinor: "5000",
      occurredOn: "2026-07-10",
    });
    const onDriverABody: { id: string } = await onDriverA.json();
    ctx.trackCreatedOffset(onDriverABody.id);
    await post(`/api/offset/${onDriverABody.id}/void`, token, { reason: "x" });

    const res = await post("/api/offset", token, {
      driverId: driverB,
      amountMinor: "5000",
      occurredOn: "2026-07-10",
      replacesId: onDriverABody.id,
    });
    expect(res.status).toBe(400);

    await ctx.cleanup();
  });

  it("deposit_movement — replacesId naming a movement against a different deposit", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const driverA = await ctx.createDriver(businessId);
    const driverB = await ctx.createDriver(businessId);
    const depositA = await ctx.createDeposit(businessId, {
      partyType: "driver",
      driverId: driverA,
    });
    const depositB = await ctx.createDeposit(businessId, {
      partyType: "driver",
      driverId: driverB,
    });
    await ctx.createDepositMovement(businessId, periodId, depositA, {
      movementType: "taken",
      amountMinor: 25_000n,
    });
    await ctx.createDepositMovement(businessId, periodId, depositB, {
      movementType: "taken",
      amountMinor: 25_000n,
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const onDepositA = await post(`/api/deposit/${depositA}/movement`, token, {
      movementType: "reduced",
      amountMinor: "5000",
      occurredOn: "2026-07-12",
      reason: "x",
    });
    const onDepositABody: { movementId: string } = await onDepositA.json();
    await post(`/api/deposit/${depositA}/movement/${onDepositABody.movementId}/void`, token, {
      reason: "x",
    });

    const res = await post(`/api/deposit/${depositB}/movement`, token, {
      movementType: "reduced",
      amountMinor: "5000",
      occurredOn: "2026-07-12",
      reason: "x",
      replacesId: onDepositABody.movementId,
    });
    expect(res.status).toBe(400);

    await ctx.cleanup();
  });

  it("advance — replacesId naming an advance against a different driver", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const driverA = await ctx.createDriver(businessId);
    const driverB = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const onDriverA = await post("/api/advance", token, {
      driverId: driverA,
      amountMinor: "5000",
      issuedOn: "2026-07-10",
    });
    const onDriverABody: { id: string } = await onDriverA.json();
    ctx.trackCreatedAdvance(onDriverABody.id);
    await post(`/api/advance/${onDriverABody.id}/void`, token, { reason: "x" });

    const res = await post("/api/advance", token, {
      driverId: driverB,
      amountMinor: "5000",
      issuedOn: "2026-07-10",
      replacesId: onDriverABody.id,
    });
    expect(res.status).toBe(400);

    await ctx.cleanup();
  });

  it("advance_settlement — replacesId naming a settlement against a different advance", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const advanceA = await post("/api/advance", token, {
      driverId,
      amountMinor: "5000",
      issuedOn: "2026-07-10",
    });
    const advanceABody: { id: string } = await advanceA.json();
    ctx.trackCreatedAdvance(advanceABody.id);
    const advanceB = await post("/api/advance", token, {
      driverId,
      amountMinor: "5000",
      issuedOn: "2026-07-10",
    });
    const advanceBBody: { id: string } = await advanceB.json();
    ctx.trackCreatedAdvance(advanceBBody.id);

    const settledOnA = await post(`/api/advance/${advanceABody.id}/settle`, token, {
      kind: "spent",
      amountMinor: "2000",
      occurredOn: "2026-07-15",
    });
    const settledOnABody: { settlementId: string } = await settledOnA.json();
    await post(
      `/api/advance/${advanceABody.id}/settlement/${settledOnABody.settlementId}/void`,
      token,
      { reason: "x" },
    );

    const res = await post(`/api/advance/${advanceBBody.id}/settle`, token, {
      kind: "spent",
      amountMinor: "2000",
      occurredOn: "2026-07-15",
      replacesId: settledOnABody.settlementId,
    });
    expect(res.status).toBe(400);

    await ctx.cleanup();
  });

  it("write_off — replacesId naming a write-off against a different party", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const customerA = await ctx.createCustomer(businessId);
    const customerB = await ctx.createCustomer(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const onCustomerA = await post("/api/write-off", token, {
      partyType: "customer",
      partyCustomerId: customerA,
      amountMinor: "40000",
      reason: "x",
      writtenOffOn: "2026-07-01",
    });
    const onCustomerABody: { id: string } = await onCustomerA.json();
    ctx.trackCreatedWriteOff(onCustomerABody.id);
    await post(`/api/write-off/${onCustomerABody.id}/void`, token, { reason: "x" });

    const res = await post("/api/write-off", token, {
      partyType: "customer",
      partyCustomerId: customerB,
      amountMinor: "40000",
      reason: "x",
      writtenOffOn: "2026-07-01",
      replacesId: onCustomerABody.id,
    });
    expect(res.status).toBe(400);

    await ctx.cleanup();
  });

  it("write_off_recovery — replacesId naming a recovery against a different write-off", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const customerId = await ctx.createCustomer(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const writeOffA = await post("/api/write-off", token, {
      partyType: "customer",
      partyCustomerId: customerId,
      amountMinor: "40000",
      reason: "x",
      writtenOffOn: "2026-07-01",
    });
    const writeOffABody: { id: string } = await writeOffA.json();
    ctx.trackCreatedWriteOff(writeOffABody.id);
    const writeOffB = await post("/api/write-off", token, {
      partyType: "customer",
      partyCustomerId: customerId,
      amountMinor: "40000",
      reason: "x",
      writtenOffOn: "2026-07-01",
    });
    const writeOffBBody: { id: string } = await writeOffB.json();
    ctx.trackCreatedWriteOff(writeOffBBody.id);

    const recoveredOnA = await post(`/api/write-off/${writeOffABody.id}/recovery`, token, {
      amountMinor: "10000",
      occurredOn: "2026-07-25",
    });
    const recoveredOnABody: { id: string } = await recoveredOnA.json();
    await post(`/api/write-off/${writeOffABody.id}/recovery/${recoveredOnABody.id}/void`, token, {
      reason: "x",
    });

    const res = await post(`/api/write-off/${writeOffBBody.id}/recovery`, token, {
      amountMinor: "10000",
      occurredOn: "2026-07-26",
      replacesId: recoveredOnABody.id,
    });
    expect(res.status).toBe(400);

    await ctx.cleanup();
  });
});
