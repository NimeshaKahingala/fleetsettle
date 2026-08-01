import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { mintLinkedDriver, mintUser, signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

async function putOpeningBalance(token: string, body: unknown) {
  return request("/api/opening-balance", {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

async function getOpeningBalance(token: string) {
  return request("/api/opening-balance", bearer(token));
}

async function commitOpeningBalance(token: string) {
  return request("/api/opening-balance/commit", { method: "POST", ...bearer(token) });
}

/**
 * F-0.2 / UC-09 test matrix. Only `opening_balance_batch` and its entries
 * are written (DM §10.6) — the vehicle/lease/daily-lease terms UC-09 also
 * mentions are entered through F-1.1/F-2.1/F-1.7's own endpoints with a
 * backdated `startDate`, not through this one (route-defs/opening-balance.ts).
 * `manageOpeningBalances` is owners-only (policy.ts) — the same blast-radius
 * class as closing a period, not the STAFF-wide `manageEntities`.
 */
describe("go live mid-stream — opening balances (P2, F-0.2/UC-09)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — save a draft, correct it, then confirm (idempotently)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const customerId = await ctx.createCustomer(businessId);
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const saveRes = await putOpeningBalance(token, {
      goLiveDate: "2026-01-01",
      entries: [
        { kind: "customer_due", partyCustomerId: customerId, amountMinor: "1200000" },
        { kind: "driver_arrears", partyDriverId: driverId, amountMinor: "500000" },
        { kind: "owed_to_driver", partyDriverId: driverId, amountMinor: "300000" },
        { kind: "deposit_held", partyDriverId: driverId, amountMinor: "1000000" },
        { kind: "advance_outstanding", partyDriverId: driverId, amountMinor: "200000" },
        { kind: "cash_held", partyUserId: owner.userId, amountMinor: "5000000" },
      ],
    });
    expect(saveRes.status).toBe(200);
    const saved: { id: string; status: string; entries: unknown[] } = await saveRes.json();
    expect(saved).toMatchObject({ goLiveDate: "2026-01-01", status: "draft", committedAt: null });
    expect(saved.entries).toHaveLength(6);
    ctx.trackCreatedOpeningBalance(saved.id);

    const getRes = await getOpeningBalance(token);
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toMatchObject({ id: saved.id, status: "draft" });

    // A vehicle-scoped correction, replacing the whole set — same call as the
    // initial draft save (domain/opening-balance.ts's full-replace design).
    const correctedRes = await putOpeningBalance(token, {
      goLiveDate: "2026-01-02",
      entries: [{ kind: "customer_due", partyCustomerId: customerId, amountMinor: "999900" }],
    });
    expect(correctedRes.status).toBe(200);
    const corrected: { id: string; entries: { amountMinor: string }[] } = await correctedRes.json();
    expect(corrected.id).toBe(saved.id);
    expect(corrected.entries).toHaveLength(1);
    expect(corrected.entries[0]).toMatchObject({ amountMinor: "999900" });

    const commitRes = await commitOpeningBalance(token);
    expect(commitRes.status).toBe(200);
    const committed: { status: string; committedAt: string | null } = await commitRes.json();
    expect(committed.status).toBe("committed");
    expect(committed.committedAt).not.toBeNull();

    // Confirm is idempotent (CLAUDE.md → Writes) — a retry is a no-op, not a failure.
    const secondCommitRes = await commitOpeningBalance(token);
    expect(secondCommitRes.status).toBe(200);
    const secondCommitted: { status: string; committedAt: string | null } =
      await secondCommitRes.json();
    expect(secondCommitted.status).toBe("committed");
    expect(secondCommitted.committedAt).toBe(committed.committedAt);

    // The Alternates clause: a correction after commit, before the first
    // period closes, is still just a save — this business has vehicle_id in
    // the mix too, exercised once here.
    const postCommitCorrection = await putOpeningBalance(token, {
      goLiveDate: "2026-01-02",
      entries: [{ kind: "customer_due", partyCustomerId: customerId, amountMinor: "1", vehicleId }],
    });
    expect(postCommitCorrection.status).toBe(200);
    expect(await postCommitCorrection.json()).toMatchObject({ status: "committed" });

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const putRes = await request("/api/opening-balance", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goLiveDate: "2026-01-01", entries: [] }),
    });
    expect(putRes.status).toBe(401);
    expect(await putRes.json()).toMatchObject({ code: "MISSING_TOKEN" });

    const commitRes = await request("/api/opening-balance/commit", { method: "POST" });
    expect(commitRes.status).toBe(401);
  });

  it("403 — a manager (not an owner) cannot manage opening balances", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const manager = await mintUser(db, ctx, businessId, "manager");
    const token = await signAccessToken(manager.asgardeoSub);

    const res = await putOpeningBalance(token, { goLiveDate: "2026-01-01", entries: [] });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

    await ctx.cleanup();
  });

  it("403 — a linked driver cannot manage opening balances", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await putOpeningBalance(token, { goLiveDate: "2026-01-01", entries: [] });
    expect(res.status).toBe(403);

    await ctx.cleanup();
  });

  it("400 — an entry's amount must be positive (DM §10.6's CHECK)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const customerId = await ctx.createCustomer(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await putOpeningBalance(token, {
      goLiveDate: "2026-01-01",
      entries: [{ kind: "customer_due", partyCustomerId: customerId, amountMinor: "0" }],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "VALIDATION_ERROR" });

    await ctx.cleanup();
  });

  it("404 — a customer_due entry names a customer in another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherCustomerId = await ctx.createCustomer(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await putOpeningBalance(token, {
      goLiveDate: "2026-01-01",
      entries: [{ kind: "customer_due", partyCustomerId: otherCustomerId, amountMinor: "100" }],
    });
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("404 — a driver_arrears entry names a driver in another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherDriverId = await ctx.createDriver(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await putOpeningBalance(token, {
      goLiveDate: "2026-01-01",
      entries: [{ kind: "driver_arrears", partyDriverId: otherDriverId, amountMinor: "100" }],
    });
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("404 — a cash_held entry names a user who is not a member of this business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherOwner = await mintUser(db, ctx, otherBusinessId, "owner");
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await putOpeningBalance(token, {
      goLiveDate: "2026-01-01",
      entries: [{ kind: "cash_held", partyUserId: otherOwner.userId, amountMinor: "100" }],
    });
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("404 — confirming before anything has ever been saved", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await commitOpeningBalance(token);
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("404 — reading before anything has ever been saved", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await getOpeningBalance(token);
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });
});
