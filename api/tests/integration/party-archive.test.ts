import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { mintLinkedDriver, mintUser, signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

function postArchiveDriver(token: string, id: string, body: unknown = { reason: "test archive" }) {
  return request(`/api/driver/${id}/archive`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

function postUnarchiveDriver(token: string, id: string) {
  return request(`/api/driver/${id}/unarchive`, { method: "POST", ...bearer(token) });
}

function postArchiveCustomer(
  token: string,
  id: string,
  body: unknown = { reason: "test archive" },
) {
  return request(`/api/customer/${id}/archive`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

function postUnarchiveCustomer(token: string, id: string) {
  return request(`/api/customer/${id}/unarchive`, { method: "POST", ...bearer(token) });
}

function getDriver(token: string, id: string) {
  return request(`/api/driver/${id}`, bearer(token));
}

function getCustomer(token: string, id: string) {
  return request(`/api/customer/${id}`, bearer(token));
}

interface ArchiveResponseBody {
  id: string;
  archivedAt: string | null;
}

interface OpenMoneyErrorBody {
  code: string;
  error: string;
  details?: { openItems: Array<{ kind: string; amountMinor: string }> };
}

/**
 * F-1.11/UC-100/W-60/INV-35, 5B-1's Step 0 mechanised (GAP-36). The archive
 * check itself — `findOpenMoneyForParty` in domain/party-archive.ts — is
 * shared by driver and customer, so its due/payable/deposit/advance cases
 * are proven once here rather than duplicated per party type; the
 * driver-only advance case and the two parties' distinct 403 shapes get
 * their own tests.
 */
describe("POST /api/driver/{id}/archive and /unarchive (F-1.11/GAP-36)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — no open money, archives and comes back with archivedAt set", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const driverId = await ctx.createDriver(businessId, { name: "Test Driver" });
    const owner = await mintUser(db, ctx, businessId, "owner_manager");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postArchiveDriver(token, driverId, { reason: "duplicate entry" });
    expect(res.status).toBe(200);
    const body: ArchiveResponseBody = await res.json();
    expect(body.id).toBe(driverId);
    expect(body.archivedAt).toBeTruthy();

    // W-58: archived, not deleted — still resolvable by id.
    const getRes = await getDriver(token, driverId);
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toMatchObject({ id: driverId, archivedAt: body.archivedAt });

    await ctx.cleanup();
  });

  it("400 — a reason is required (migration 0023's own CHECK, matched at the API boundary)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner_manager");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postArchiveDriver(token, driverId, {});
    expect(res.status).toBe(400);

    await ctx.cleanup();
  });

  it("regression: two concurrent archives race cleanly — one wins, the other is refused as already archived rather than clobbering the reason", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner_manager");
    const token = await signAccessToken(owner.asgardeoSub);

    const [a, b] = await Promise.all([
      postArchiveDriver(token, driverId, { reason: "request A" }),
      postArchiveDriver(token, driverId, { reason: "request B" }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request(`/api/driver/${crypto.randomUUID()}/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it("403 — a linked driver cannot archive a driver (W-3: a driver enters nothing)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await postArchiveDriver(token, driverId);
    expect(res.status).toBe(403);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

    await ctx.cleanup();
  });

  it("404 — a driver belonging to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherDriverId = await ctx.createDriver(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner_manager");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postArchiveDriver(token, otherDriverId);
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("409 — already archived", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner_manager");
    const token = await signAccessToken(owner.asgardeoSub);

    const first = await postArchiveDriver(token, driverId);
    expect(first.status).toBe(200);

    const second = await postArchiveDriver(token, driverId);
    expect(second.status).toBe(409);
    const body: { code: string } = await second.json();
    expect(body).toMatchObject({ code: "PARTY_ALREADY_ARCHIVED" });

    await ctx.cleanup();
  });

  it("409 — refused with an open due (obligation owed_to_us), naming the figure", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    await ctx.createObligation(businessId, periodId, {
      direction: "owed_to_us",
      partyType: "driver",
      driverId,
      amountMinor: 12_000n,
      status: "pending",
    });
    const owner = await mintUser(db, ctx, businessId, "owner_manager");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postArchiveDriver(token, driverId);
    expect(res.status).toBe(409);
    const body: OpenMoneyErrorBody = await res.json();
    expect(body.code).toBe("PARTY_HAS_OPEN_MONEY");
    expect(body.details?.openItems).toEqual([{ kind: "due", amountMinor: "12000" }]);

    await ctx.cleanup();
  });

  it("409 — refused with an open payable (obligation owed_by_us) and an open due together, never netted (INV-3)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    await ctx.createObligation(businessId, periodId, {
      direction: "owed_to_us",
      partyType: "driver",
      driverId,
      amountMinor: 12_000n,
      status: "pending",
    });
    await ctx.createObligation(businessId, periodId, {
      direction: "owed_by_us",
      partyType: "driver",
      driverId,
      amountMinor: 9_000n,
      kind: "driver_fee",
      status: "pending",
    });
    const owner = await mintUser(db, ctx, businessId, "owner_manager");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postArchiveDriver(token, driverId);
    expect(res.status).toBe(409);
    const body: OpenMoneyErrorBody = await res.json();
    // Two separate figures, not one net 3,000 — INV-3 forbids netting a
    // driver's two balances anywhere, including this refusal.
    expect(body.details?.openItems).toEqual(
      expect.arrayContaining([
        { kind: "due", amountMinor: "12000" },
        { kind: "payable", amountMinor: "9000" },
      ]),
    );
    expect(body.details?.openItems).toHaveLength(2);

    await ctx.cleanup();
  });

  it("409 — refused with a deposit still held", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const depositId = await ctx.createDeposit(businessId, { partyType: "driver", driverId });
    await ctx.createDepositMovement(businessId, periodId, depositId, {
      movementType: "taken",
      amountMinor: 15_000n,
    });
    const owner = await mintUser(db, ctx, businessId, "owner_manager");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postArchiveDriver(token, driverId);
    expect(res.status).toBe(409);
    const body: OpenMoneyErrorBody = await res.json();
    expect(body.details?.openItems).toEqual([{ kind: "deposit_held", amountMinor: "15000" }]);

    await ctx.cleanup();
  });

  it("409 — refused with an unreconciled advance (driver only)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    await ctx.createAdvance(businessId, periodId, driverId, { amountMinor: 3_000n });
    const owner = await mintUser(db, ctx, businessId, "owner_manager");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postArchiveDriver(token, driverId);
    expect(res.status).toBe(409);
    const body: OpenMoneyErrorBody = await res.json();
    expect(body.details?.openItems).toEqual([{ kind: "advance", amountMinor: "3000" }]);

    await ctx.cleanup();
  });

  it("happy path — a voided obligation, a settled advance and a released deposit never count as open", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    await ctx.createObligation(businessId, periodId, {
      direction: "owed_to_us",
      partyType: "driver",
      driverId,
      amountMinor: 12_000n,
      status: "paid",
      settledMinor: 12_000n,
    });
    await ctx.createAdvance(businessId, periodId, driverId, {
      amountMinor: 3_000n,
      status: "settled",
    });
    const depositId = await ctx.createDeposit(businessId, {
      partyType: "driver",
      driverId,
      status: "released",
    });
    await ctx.createDepositMovement(businessId, periodId, depositId, {
      movementType: "taken",
      amountMinor: 5_000n,
    });
    const owner = await mintUser(db, ctx, businessId, "owner_manager");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postArchiveDriver(token, driverId);
    expect(res.status).toBe(200);

    await ctx.cleanup();
  });

  it("unarchive — happy path clears archivedAt, and the driver can be re-archived afterward", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const driverId = await ctx.createDriver(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner_manager");
    const token = await signAccessToken(owner.asgardeoSub);

    await postArchiveDriver(token, driverId, { reason: "typo" });

    const res = await postUnarchiveDriver(token, driverId);
    expect(res.status).toBe(200);
    const body: ArchiveResponseBody = await res.json();
    expect(body.archivedAt).toBeNull();

    const reArchive = await postArchiveDriver(token, driverId);
    expect(reArchive.status).toBe(200);

    await ctx.cleanup();
  });

  it("unarchive — 404 a driver belonging to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherDriverId = await ctx.createDriver(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner_manager");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postUnarchiveDriver(token, otherDriverId);
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });
});

describe("POST /api/customer/{id}/archive and /unarchive (F-1.11/GAP-36)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — no open money, archives and comes back with archivedAt set", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const customerId = await ctx.createCustomer(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner_manager");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postArchiveCustomer(token, customerId);
    expect(res.status).toBe(200);
    const body: ArchiveResponseBody = await res.json();
    expect(body.archivedAt).toBeTruthy();

    const getRes = await getCustomer(token, customerId);
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toMatchObject({ id: customerId, archivedAt: body.archivedAt });

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request(`/api/customer/${crypto.randomUUID()}/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it("403 — a linked driver cannot archive a customer (W-3: a driver enters nothing)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const driverId = await ctx.createDriver(businessId);
    const customerId = await ctx.createCustomer(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await postArchiveCustomer(token, customerId);
    expect(res.status).toBe(403);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

    await ctx.cleanup();
  });

  it("404 — a customer belonging to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherCustomerId = await ctx.createCustomer(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner_manager");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postArchiveCustomer(token, otherCustomerId);
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("409 — refused with an open due, naming the figure", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const customerId = await ctx.createCustomer(businessId);
    await ctx.createObligation(businessId, periodId, {
      direction: "owed_to_us",
      partyType: "customer",
      customerId,
      amountMinor: 50_000n,
      status: "part_paid",
      settledMinor: 20_000n,
    });
    const owner = await mintUser(db, ctx, businessId, "owner_manager");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postArchiveCustomer(token, customerId);
    expect(res.status).toBe(409);
    const body: OpenMoneyErrorBody = await res.json();
    expect(body.code).toBe("PARTY_HAS_OPEN_MONEY");
    // 50,000 - 20,000 settled = 30,000 still due.
    expect(body.details?.openItems).toEqual([{ kind: "due", amountMinor: "30000" }]);

    await ctx.cleanup();
  });

  it("409 — refused with a deposit still in hold_window (not only 'held')", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const customerId = await ctx.createCustomer(businessId);
    const depositId = await ctx.createDeposit(businessId, {
      partyType: "customer",
      customerId,
      status: "hold_window",
    });
    await ctx.createDepositMovement(businessId, periodId, depositId, {
      movementType: "taken",
      amountMinor: 25_000n,
    });
    const owner = await mintUser(db, ctx, businessId, "owner_manager");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postArchiveCustomer(token, customerId);
    expect(res.status).toBe(409);
    const body: OpenMoneyErrorBody = await res.json();
    expect(body.details?.openItems).toEqual([{ kind: "deposit_held", amountMinor: "25000" }]);

    await ctx.cleanup();
  });

  it("unarchive — happy path clears archivedAt", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const customerId = await ctx.createCustomer(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner_manager");
    const token = await signAccessToken(owner.asgardeoSub);

    await postArchiveCustomer(token, customerId);

    const res = await postUnarchiveCustomer(token, customerId);
    expect(res.status).toBe(200);
    const body: ArchiveResponseBody = await res.json();
    expect(body.archivedAt).toBeNull();

    await ctx.cleanup();
  });
});
