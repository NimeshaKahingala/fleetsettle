import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { deposit } from "../../src/db/schema.js";
import {
  insertBatch,
  insertEntries,
  markBatchCommitted,
} from "../../src/queries/opening-balance.js";
import { newId } from "@fleetsettle/shared";
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

async function getReceivables(token: string) {
  return request("/api/reports/receivables", bearer(token));
}

async function getCashPosition(token: string) {
  return request("/api/reports/cash-position", bearer(token));
}

async function getDriverBalances(token: string, driverId: string) {
  return request(`/api/driver/${driverId}/balances`, bearer(token));
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
    // GAP-103: commit now materialises into obligation/deposit/advance/payment,
    // which needs a real accounting period to post to — the same period a real
    // business always already has by the time it can reach this screen
    // (domain/setup.ts creates one in the same transaction as the business
    // itself; this factory doesn't, so the test supplies it explicitly).
    await ctx.createOpenPeriod(businessId, { periodStart: "2026-01-01", periodEnd: "2026-01-31" });
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

    // GAP-103: the commit that just happened materialised the sole
    // surviving entry (customer_due, 999900) into a real obligation —
    // "Who owes us" is the report that was blind to it before this fix.
    const receivablesAfterCommit: { partyId: string; outstandingMinor: string }[] = await (
      await getReceivables(token)
    ).json();
    expect(receivablesAfterCommit).toContainEqual(
      expect.objectContaining({ partyId: customerId, outstandingMinor: "999900" }),
    );

    // Confirm is idempotent (CLAUDE.md → Writes) — a retry is a no-op, not a failure.
    const secondCommitRes = await commitOpeningBalance(token);
    expect(secondCommitRes.status).toBe(200);
    const secondCommitted: { status: string; committedAt: string | null } =
      await secondCommitRes.json();
    expect(secondCommitted.status).toBe("committed");
    expect(secondCommitted.committedAt).toBe(committed.committedAt);

    // A retried commit must not double the receivable — still exactly 999900,
    // not 1999800, and still exactly one row for this customer.
    const receivablesAfterRetry: { partyId: string; outstandingMinor: string }[] = await (
      await getReceivables(token)
    ).json();
    expect(receivablesAfterRetry.filter((r) => r.partyId === customerId)).toEqual([
      expect.objectContaining({ partyId: customerId, outstandingMinor: "999900" }),
    ]);

    // The Alternates clause: a correction after commit, before the first
    // period closes, is still just a save — this business has vehicle_id in
    // the mix too, exercised once here.
    const postCommitCorrection = await putOpeningBalance(token, {
      goLiveDate: "2026-01-02",
      entries: [{ kind: "customer_due", partyCustomerId: customerId, amountMinor: "1", vehicleId }],
    });
    expect(postCommitCorrection.status).toBe(200);
    expect(await postCommitCorrection.json()).toMatchObject({ status: "committed" });

    // GAP-103's correction path: the prior commit's obligation (999900) is
    // reversed, not left standing beside the new one — the receivable for
    // this customer is now exactly the corrected figure, never both.
    const receivablesAfterCorrection: { partyId: string; outstandingMinor: string }[] = await (
      await getReceivables(token)
    ).json();
    expect(receivablesAfterCorrection.filter((r) => r.partyId === customerId)).toEqual([
      expect.objectContaining({ partyId: customerId, outstandingMinor: "1" }),
    ]);

    await ctx.cleanup();
  });

  it("GAP-103: commit materialises all six entry kinds into the real tables their own reports read", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId, { periodStart: "2026-01-01", periodEnd: "2026-01-31" });
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
    const saved: { id: string } = await saveRes.json();
    ctx.trackCreatedOpeningBalance(saved.id);

    const commitRes = await commitOpeningBalance(token);
    expect(commitRes.status).toBe(200);

    // customer_due → obligation, owed_to_us/customer — "Who owes us".
    const receivables: { partyId: string; outstandingMinor: string }[] = await (
      await getReceivables(token)
    ).json();
    expect(receivables).toContainEqual(
      expect.objectContaining({ partyId: customerId, outstandingMinor: "1200000" }),
    );

    // driver_arrears (owed_to_us) and owed_to_driver (owed_by_us) →
    // obligation, both sides — CLAUDE.md's "never net the driver's two
    // balances" means both must be independently visible.
    const balances: { owedToUsMinor: string; owedByUsMinor: string } = await (
      await getDriverBalances(token, driverId)
    ).json();
    expect(balances).toMatchObject({ owedToUsMinor: "500000", owedByUsMinor: "300000" });

    // deposit_held → deposit + deposit_movement, advance_outstanding →
    // advance, cash_held → payment — all three read by one report (UC-75).
    const cashPosition: {
      partners: { userId: string; heldMinor: string }[];
      depositsHeldMinor: string;
      driverAdvances: { driverId: string; outstandingMinor: string }[];
    } = await (await getCashPosition(token)).json();
    expect(cashPosition.depositsHeldMinor).toBe("1000000");
    expect(cashPosition.driverAdvances).toContainEqual(
      expect.objectContaining({ driverId, outstandingMinor: "200000" }),
    );
    expect(cashPosition.partners).toContainEqual(
      expect.objectContaining({ userId: owner.userId, heldMinor: "5000000" }),
    );

    await ctx.cleanup();
  });

  it("M-10: correcting a committed batch releases the old deposit instead of leaving a second one held", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId, { periodStart: "2026-01-01", periodEnd: "2026-01-31" });
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const saveRes = await putOpeningBalance(token, {
      goLiveDate: "2026-01-01",
      entries: [{ kind: "deposit_held", partyDriverId: driverId, amountMinor: "2000000" }],
    });
    expect(saveRes.status).toBe(200);
    const savedBatch: { id: string } = await saveRes.json();
    ctx.trackCreatedOpeningBalance(savedBatch.id);
    expect((await commitOpeningBalance(token)).status).toBe(200);

    // The correction. `reverseOpeningBalancePostings` refunds the old deposit
    // in full, then `materializeOpeningBalanceEntries` inserts a fresh one for
    // the same driver — so before this fix the driver held two deposits at
    // once, and with migration 0038's unique index live this call came back
    // 500 on an unhandled 23505 rather than 200.
    const correctionRes = await putOpeningBalance(token, {
      goLiveDate: "2026-01-01",
      entries: [{ kind: "deposit_held", partyDriverId: driverId, amountMinor: "1500000" }],
    });
    expect(correctionRes.status).toBe(200);

    // One held deposit, not two. The reversed one is `released` — the status
    // `recordDepositMovement`'s TERMINAL map would have set had this path gone
    // through it, which is the invariant 0038's repair restored for rows
    // written before this fix existed.
    const rows = await db
      .select({ status: deposit.status })
      .from(deposit)
      .where(eq(deposit.partyDriverId, driverId));
    expect(rows.filter((r) => r.status === "held")).toHaveLength(1);
    expect(rows.filter((r) => r.status === "released")).toHaveLength(1);

    // And the money the business believes it is holding is the corrected
    // figure alone — never the old one standing beside it.
    const cashPosition: { depositsHeldMinor: string } = await (await getCashPosition(token)).json();
    expect(cashPosition.depositsHeldMinor).toBe("1500000");

    await ctx.cleanup();
  });

  it("GAP-109: re-confirming a batch committed before F3 shipped materialises it, and a normal retry after that stays a no-op", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId, { periodStart: "2026-01-01", periodEnd: "2026-01-31" });
    const customerId = await ctx.createCustomer(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    // Reproduces the exact pre-F3 state directly, bypassing the domain
    // function entirely — the whole point of GAP-109 is that this state
    // can no longer be *produced* through the API once the fix lands, only
    // *found*, the same way a real batch confirmed before 11 Aug 2026 sits
    // today: `status: 'committed'`, zero rows in `opening_balance_posting`.
    const batchId = newId();
    await insertBatch(db, { id: batchId, businessId, goLiveDate: "2026-01-01" });
    await insertEntries(db, [
      {
        id: newId(),
        batchId,
        kind: "customer_due",
        partyCustomerId: customerId,
        amountMinor: 750000n,
      },
    ]);
    await markBatchCommitted(db, batchId);
    ctx.trackCreatedOpeningBalance(batchId);

    // The stranded precondition, confirmed rather than assumed (this
    // project's own "make it fail on purpose" discipline) — QA-2026-08-11-01
    // live, reproduced here: a committed customer due that "Who owes us"
    // cannot see.
    const before: { partyId: string; outstandingMinor: string }[] = await (
      await getReceivables(token)
    ).json();
    expect(before.find((r) => r.partyId === customerId)).toBeUndefined();

    const getRes = await getOpeningBalance(token);
    expect(await getRes.json()).toMatchObject({ id: batchId, status: "committed" });

    // GAP-110's own fix is what makes this reachable on a phone — the
    // backend half is this call succeeding, not silently no-op'ing because
    // `status` already said "committed".
    const commitRes = await commitOpeningBalance(token);
    expect(commitRes.status).toBe(200);
    const committed: { status: string } = await commitRes.json();
    expect(committed.status).toBe("committed");

    const after: { partyId: string; outstandingMinor: string }[] = await (
      await getReceivables(token)
    ).json();
    expect(after).toContainEqual(
      expect.objectContaining({ partyId: customerId, outstandingMinor: "750000" }),
    );

    // Now that this batch has real postings, a further retry must go back
    // to being a pure no-op — the exact idempotency the happy-path test
    // already covers for the ordinary case, checked again here because
    // this batch took the GAP-109 recovery path to get there rather than
    // the ordinary one.
    const secondCommitRes = await commitOpeningBalance(token);
    expect(secondCommitRes.status).toBe(200);
    const afterRetry: { partyId: string; outstandingMinor: string }[] = await (
      await getReceivables(token)
    ).json();
    expect(afterRetry.filter((r) => r.partyId === customerId)).toEqual([
      expect.objectContaining({ partyId: customerId, outstandingMinor: "750000" }),
    ]);

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

  it("409 — once the first accounting period has closed, this is an ordinary adjustment instead (P9/F-0.2 Alternates)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId, {
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    await ctx.closePeriod(periodId);

    const res = await putOpeningBalance(token, {
      goLiveDate: "2026-01-01",
      entries: [],
    });
    expect(res.status).toBe(409);
    const body: { code: string } = await res.json();
    expect(body).toMatchObject({ code: "OPENING_BALANCE_LOCKED" });

    await ctx.cleanup();
  });
});
