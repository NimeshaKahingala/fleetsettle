import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { depositMovement, obligation } from "../../src/db/schema.js";
import { voidDepositMovement } from "../../src/domain/deposit.js";
import { mintLinkedDriver, mintUser, signAccessToken } from "../support/auth.js";
import { get, post } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

interface StartLeaseBody {
  id: string;
  depositId: string | null;
}

interface ReleaseResponseBody {
  depositId: string;
  status: "held" | "hold_window" | "released" | "applied" | "retained";
  heldMinor: string;
}

/**
 * GAP-230/F-2.7: a `hold_window` deposit — nothing before this endpoint
 * could ever move money out of one. Every test here starts a lease with a
 * deposit, closes it, then holds it (`action: "hold"`) exactly as
 * `lease-closure.test.ts`'s own settle-deposit suite does, since that is the
 * only way a deposit ever reaches `hold_window` in this system.
 */
describe("release a held deposit (GAP-230, F-2.7)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

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
      depositAmountMinor: "20000",
      ...overrides,
    });
    expect(res.status).toBe(201);
    return res.json();
  }

  /** Start → close → hold, the only path that ever puts a deposit into `hold_window`. */
  async function setUpHeldDeposit(
    ctx: TestContext,
    db: ReturnType<typeof writer>,
    options: { depositHoldDays?: number } = {},
  ) {
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId, {
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
    });
    if (options.depositHoldDays !== undefined) {
      await ctx.setDepositHoldDays(businessId, options.depositHoldDays);
    }
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "A");
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

    const holdRes = await post(`/api/lease/${started.id}/settle-deposit`, token, {
      action: "hold",
      occurredOn: "2026-01-21",
    });
    expect(holdRes.status).toBe(200);
    const holdBody: { holdReleaseDate: string } = await holdRes.json();

    return {
      businessId,
      periodId,
      customerId,
      leaseId: started.id,
      depositId: started.depositId!,
      token,
      userId: owner.userId,
      holdReleaseDate: holdBody.holdReleaseDate,
    };
  }

  it("refund — pays back the full held balance and releases it", async () => {
    const ctx = new TestContext(db);
    const { depositId, token } = await setUpHeldDeposit(ctx, db);

    const res = await post(`/api/deposit/${depositId}/release`, token, {
      action: "refund",
      occurredOn: "2026-01-25",
    });
    expect(res.status).toBe(200);
    const body: ReleaseResponseBody = await res.json();
    expect(body).toMatchObject({ depositId, status: "released", heldMinor: "0" });

    await ctx.cleanup();
  });

  it("retain — keeps a portion with only a reason, no linked charge", async () => {
    const ctx = new TestContext(db);
    const { depositId, token } = await setUpHeldDeposit(ctx, db);

    const res = await post(`/api/deposit/${depositId}/release`, token, {
      action: "retain",
      amountMinor: "5000",
      reason: "Scratched bumper",
      occurredOn: "2026-01-25",
    });
    expect(res.status).toBe(200);
    const body: ReleaseResponseBody = await res.json();
    expect(body).toMatchObject({ depositId, status: "retained", heldMinor: "15000" });

    await ctx.cleanup();
  });

  it("apply — sweeps the held balance against an outstanding due, oldest-due-first", async () => {
    const ctx = new TestContext(db);
    const { depositId, customerId, businessId, periodId, token } = await setUpHeldDeposit(ctx, db);

    // `setUpHeldDeposit`'s own lease closure leaves the full period's rent
    // (3,100,000, `startLease`'s own default) outstanding — settled here
    // first so it is not what the deposit's own apply below sweeps into,
    // the same way the pre-existing GAP-6 apply test in
    // `lease-closure.test.ts` deliberately leaves it unpaid to prove the
    // opposite point. This test is about *this* deposit's own apply, not
    // the lease's unrelated rent.
    const rentPaymentRes = await post("/api/payment", token, {
      partyType: "customer",
      partyId: customerId,
      amountMinor: "3100000",
      occurredOn: "2026-01-22",
    });
    expect(rentPaymentRes.status).toBe(201);
    const rentPaymentBody: { id: string } = await rentPaymentRes.json();
    ctx.trackCreatedPayment(rentPaymentBody.id);

    const obligationId = await ctx.createObligation(businessId, periodId, {
      direction: "owed_to_us",
      partyType: "customer",
      customerId,
      kind: "post_closure_charge",
      amountMinor: 12_000n,
      dueOn: "2026-01-23",
    });
    // The apply below leaves a `deposit_movement.obligation_id` pointing at
    // this obligation — cleared here (LIFO: tracked after `createObligation`,
    // so it runs before that row's own delete) rather than left for the
    // lease's own teardown, which only clears movements for obligations it
    // created itself, not one made directly by this test.
    ctx.track(async () => {
      await db
        .update(depositMovement)
        .set({ obligationId: null })
        .where(eq(depositMovement.obligationId, obligationId));
    });

    const res = await post(`/api/deposit/${depositId}/release`, token, {
      action: "apply",
      occurredOn: "2026-01-25",
    });
    expect(res.status).toBe(200);
    const body: ReleaseResponseBody = await res.json();
    // 'applied' is deliberately not a terminal deposit status (the same
    // shape `settleLeaseDeposit`'s own "apply" already has) — the 8,000 left
    // over stays `hold_window`, available for a follow-up refund.
    expect(body).toMatchObject({ depositId, status: "hold_window", heldMinor: "8000" });

    const [ob] = await db.select().from(obligation).where(eq(obligation.id, obligationId));
    expect(ob).toMatchObject({ settledMinor: 12_000n, status: "paid" });

    await ctx.cleanup();
  });

  it("early release — the release date has not come yet, and this still succeeds (the owner's own answer, 13 Sept 2026)", async () => {
    const ctx = new TestContext(db);
    // A 3,650-day hold window pushes `holdReleaseDate` far past this suite's
    // own real-world "today" — every date the requests themselves carry
    // stays a safely historical 2026-01-2x, only the *derived* release date
    // is in the future, which is the one thing this test needs.
    const { depositId, holdReleaseDate, token } = await setUpHeldDeposit(ctx, db, {
      depositHoldDays: 3650,
    });
    expect(holdReleaseDate > "2026-09-13").toBe(true);

    const homeRes = await get("/api/home/deposit-releases", token);
    const homeRows: { depositId: string }[] = await homeRes.json();
    expect(homeRows.map((r) => r.depositId)).not.toContain(depositId);

    const res = await post(`/api/deposit/${depositId}/release`, token, {
      action: "refund",
      occurredOn: "2026-01-25",
    });
    expect(res.status).toBe(200);
    const body: ReleaseResponseBody = await res.json();
    expect(body).toMatchObject({ depositId, status: "released", heldMinor: "0" });

    await ctx.cleanup();
  });

  it("the deposit leaves the home release list once released", async () => {
    const ctx = new TestContext(db);
    const { depositId, token } = await setUpHeldDeposit(ctx, db);

    const before: { depositId: string }[] = await (
      await get("/api/home/deposit-releases", token)
    ).json();
    expect(before.map((r) => r.depositId)).toContain(depositId);

    const res = await post(`/api/deposit/${depositId}/release`, token, {
      action: "refund",
      occurredOn: "2026-01-25",
    });
    expect(res.status).toBe(200);

    const after: { depositId: string }[] = await (
      await get("/api/home/deposit-releases", token)
    ).json();
    expect(after.map((r) => r.depositId)).not.toContain(depositId);

    await ctx.cleanup();
  });

  it("a retried release is refused, not repeated — a second call finds it no longer in hold_window", async () => {
    const ctx = new TestContext(db);
    const { depositId, token } = await setUpHeldDeposit(ctx, db);

    const first = await post(`/api/deposit/${depositId}/release`, token, {
      action: "refund",
      occurredOn: "2026-01-25",
    });
    expect(first.status).toBe(200);

    const second = await post(`/api/deposit/${depositId}/release`, token, {
      action: "refund",
      occurredOn: "2026-01-26",
    });
    expect(second.status).toBe(400);

    // Not repeated: still exactly one 'refunded' movement, not two.
    const movements = await db
      .select()
      .from(depositMovement)
      .where(eq(depositMovement.depositId, depositId));
    expect(movements.filter((m) => m.movementType === "refunded")).toHaveLength(1);

    await ctx.cleanup();
  });

  it("400 — a held deposit (not yet hold_window) is refused", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId, { periodStart: "2026-01-01", periodEnd: "2026-12-31" });
    const vehicleId = await ctx.createVehicle(businessId);
    await ctx.setVehicleArrangement(vehicleId, "A");
    const customerId = await ctx.createCustomer(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const started = await startLease(token, vehicleId, customerId);
    ctx.trackCreatedLease(started.id);
    // Never closed, never held — the deposit is still plain 'held'.

    const res = await post(`/api/deposit/${started.depositId!}/release`, token, {
      action: "refund",
      occurredOn: "2026-01-25",
    });
    expect(res.status).toBe(400);

    await ctx.cleanup();
  });

  it("404 — the deposit belongs to another business", async () => {
    const ctx = new TestContext(db);
    const other = new TestContext(db);
    const { depositId } = await setUpHeldDeposit(other, db);

    const businessId = await ctx.createBusiness();
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await post(`/api/deposit/${depositId}/release`, token, {
      action: "refund",
      occurredOn: "2026-01-25",
    });
    expect(res.status).toBe(404);

    await ctx.cleanup();
    await other.cleanup();
  });

  it("voiding a release movement returns the deposit to hold_window", async () => {
    const ctx = new TestContext(db);
    const { businessId, depositId, token, userId } = await setUpHeldDeposit(ctx, db);

    const res = await post(`/api/deposit/${depositId}/release`, token, {
      action: "refund",
      occurredOn: "2026-01-25",
    });
    expect(res.status).toBe(200);

    const [movement] = await db
      .select({ id: depositMovement.id })
      .from(depositMovement)
      .where(
        and(eq(depositMovement.depositId, depositId), eq(depositMovement.movementType, "refunded")),
      );
    expect(movement).toBeDefined();

    // GAP-231: `POST /{id}/movement/{movementId}/void` (`voidDepositMovementHandler`)
    // 500s for any customer deposit — its own response-building assumes
    // every deposit is a driver's and throws when `partyDriverId` is null,
    // a pre-existing defect this release path exposes for the first time
    // (filed, not fixed here — out of GAP-230's own scope). The recompute
    // this test actually cares about lives in the domain function the
    // handler wraps, so it is called directly here instead.
    const voided = await voidDepositMovement(db, {
      businessId,
      depositId,
      movementId: movement!.id,
      reason: "Refunded the wrong account, redoing it",
      userId,
    });
    expect(voided.deposit).toMatchObject({ status: "hold_window" });
    expect(voided.heldMinor).toBe(20_000n);

    await ctx.cleanup();
  });

  it("403 — a linked driver cannot release a deposit (leaseAndTripLifecycle is STAFF-only)", async () => {
    const ctx = new TestContext(db);
    const { depositId, businessId } = await setUpHeldDeposit(ctx, db);
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await post(`/api/deposit/${depositId}/release`, token, {
      action: "refund",
      occurredOn: "2026-01-25",
    });
    expect(res.status).toBe(403);

    await ctx.cleanup();
  });
});
