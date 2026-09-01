import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { customer, driver } from "../../src/db/schema.js";
import { mintUser, signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

/**
 * GAP-178 PR A. The two findings from Claude's review of #117 that are only
 * visible through a real endpoint — a mapping with no caller, and an index
 * with no mapping. Both surfaced as a bare 500 to whoever hit them.
 */

const db = writer(TEST_DATABASE_URL);
const ctx = new TestContext(db);

afterAll(async () => {
  await ctx.cleanup();
});

function post(path: string, token: string, body: unknown) {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

describe("GAP-178/B13 — an archived party is a 409, never an unexplained 500", () => {
  /**
   * `isPartyArchivedViolation`/`PartyArchivedError` were added by this PR and
   * referenced nowhere, so migration 0031's trigger fired into the generic
   * handler. The message was written and never reached anyone.
   */
  it("returns PARTY_ARCHIVED when an expense is borne by an archived driver", async () => {
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const manager = await mintUser(db, ctx, businessId, "manager");
    const token = await signAccessToken(manager.asgardeoSub);

    await db
      .update(driver)
      .set({ voidedAt: sql`now()`, voidedReason: "left", voidedBy: manager.userId })
      .where(eq(driver.id, driverId));

    const res = await post("/api/expense", token, {
      category: "fuel",
      amountMinor: "500000",
      spentOn: "2026-07-10",
      borneBy: "driver",
      borneByDriverId: driverId,
      vehicleId,
    });

    expect(res.status).toBe(409);
    const body: { code: string; error: string } = await res.json();
    expect(body.code).toBe("PARTY_ARCHIVED");
    // The remedy is in the message, because it is a real one.
    expect(body.error).toMatch(/restore/i);
  });

  it("returns PARTY_ARCHIVED for an archived customer as well", async () => {
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const customerId = await ctx.createCustomer(businessId);
    const manager = await mintUser(db, ctx, businessId, "manager");
    const token = await signAccessToken(manager.asgardeoSub);

    await db
      .update(customer)
      .set({ voidedAt: sql`now()`, voidedReason: "gone", voidedBy: manager.userId })
      .where(eq(customer.id, customerId));

    const res = await post("/api/expense", token, {
      category: "repairs",
      amountMinor: "250000",
      spentOn: "2026-07-11",
      borneBy: "customer",
      borneByCustomerId: customerId,
      vehicleId,
    });

    expect(res.status).toBe(409);
    const body: { code: string } = await res.json();
    expect(body.code).toBe("PARTY_ARCHIVED");
  });
});

describe("GAP-208/NM-2/NM-3/GAP-187 — adjustment and deposit also refuse new money against an archived party", () => {
  /**
   * `adjustment` has no direct foreign key to `driver`/`customer` at all —
   * only `obligation_id` — so migration 0031's own catalogue-driven view
   * could never see it, no matter how it was phrased. A dedicated trigger
   * (`assert_adjustment_party_not_archived`, migration 0037) resolves the
   * party through that join instead.
   */
  it("returns PARTY_ARCHIVED when a waiver is applied against an archived customer's obligation", async () => {
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const customerId = await ctx.createCustomer(businessId);
    // A manual waiver above the auto-waive threshold (0 by default, OQ-3)
    // escalates to writeOffOrWaiveAboveThreshold — owners only — so this
    // needs an owner token, not the manager used elsewhere in this file.
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);
    const obligationId = await ctx.createObligation(businessId, periodId, {
      partyType: "customer",
      customerId,
      amountMinor: 34_000n,
    });

    await db
      .update(customer)
      .set({ voidedAt: sql`now()`, voidedReason: "gone", voidedBy: owner.userId })
      .where(eq(customer.id, customerId));

    const res = await post("/api/adjustment", token, {
      obligationId,
      adjustmentType: "waiver",
      amountMinor: "34000",
      sign: -1,
      reason: "Below the auto-waive threshold, waived by hand",
    });

    expect(res.status).toBe(409);
    const body: { code: string } = await res.json();
    expect(body.code).toBe("PARTY_ARCHIVED");
  });

  /**
   * `deposit` carries `party_driver_id`/`party_customer_id` directly, but
   * has no `posted_period_id` of its own (the money lives in
   * `deposit_movement`) — the *other* half of the view's own membership
   * test, so it was structurally invisible for a different reason than
   * `adjustment` above. `assert_party_not_archived()` already does the
   * right check for a table with direct party columns; migration 0037
   * attaches it by hand.
   */
  it("returns PARTY_ARCHIVED when a new deposit is taken from an archived driver", async () => {
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const manager = await mintUser(db, ctx, businessId, "manager");
    const token = await signAccessToken(manager.asgardeoSub);

    await db
      .update(driver)
      .set({ voidedAt: sql`now()`, voidedReason: "left", voidedBy: manager.userId })
      .where(eq(driver.id, driverId));

    const res = await post("/api/deposit", token, {
      driverId,
      amountMinor: "1000000",
      occurredOn: "2026-07-01",
    });

    expect(res.status).toBe(409);
    const body: { code: string } = await res.json();
    expect(body.code).toBe("PARTY_ARCHIVED");
  });
});

describe("GAP-178/B19 — a duplicate customer contribution is a 409, never a 500", () => {
  /**
   * No concurrency required, which is what makes this worth a test: a
   * re-submitted form, or a manager re-entering a revised figure without
   * voiding the first, took this path. It succeeded before migration 0031
   * (leaving two live claims against one source) and would have 500'd after
   * it, until the index was mapped.
   */
  it("refuses a second live contribution against the same incident", async () => {
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

    const first = await post(`/api/incident/${incidentId}/customer-contribution`, token, {
      agreedAmountMinor: "20000",
      agreedOn: "2026-07-20",
    });
    expect(first.status).toBe(201);

    const second = await post(`/api/incident/${incidentId}/customer-contribution`, token, {
      agreedAmountMinor: "25000",
      agreedOn: "2026-07-21",
    });

    expect(second.status).toBe(409);
    const body: { code: string; error: string } = await second.json();
    expect(body.code).toBe("RECOVERY_ALREADY_RECORDED");
    // W-50: the way out is void-and-replace, and the message says so.
    expect(body.error).toMatch(/void it first/i);
  });
});
