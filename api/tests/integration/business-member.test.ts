import { and, eq, isNull } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { businessMember, businessMemberInvite } from "../../src/db/schema.js";
import { writer } from "../../src/db/client.js";
import { hashInviteCode } from "../../src/domain/invite-code.js";
import { mintLinkedDriver, mintUser, signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

async function listBusinessMembers(token: string) {
  return request("/api/business-member", bearer(token));
}

async function inviteMember(token: string, role: string) {
  return request("/api/business-member/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ role }),
  });
}

async function revokeMember(token: string, memberId: string) {
  return request(`/api/business-member/${memberId}/revoke`, {
    method: "POST",
    ...bearer(token),
  });
}

async function changeRole(token: string, memberId: string, role: string) {
  return request(`/api/business-member/${memberId}/change-role`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ role }),
  });
}

/**
 * GAP-31 test matrix. `dailyOperations` is the gate (route-def's own note:
 * the caller is `BorneByPaidBy`, a manager screen, not an owners-only one),
 * so a manager belongs in the happy path alongside the owner, not only in a
 * 403 case the way `managePartnerCapital`-gated endpoints would need.
 */
describe("GET /api/business-member (GAP-31)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — active members only, oldest-granted first, a revoked member excluded", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const owner = await mintUser(db, ctx, businessId, "owner");
    const manager = await mintUser(db, ctx, businessId, "manager");
    const revoked = await mintUser(db, ctx, businessId, "manager");
    await db
      .update(businessMember)
      // A literal timestamp, not `new Date()` (IG §4.5) — the test only
      // needs `revoked_at` non-null, never the device clock.
      .set({ revokedAt: "2026-07-15T00:00:00.000Z" })
      .where(eq(businessMember.userId, revoked.userId));

    const token = await signAccessToken(owner.asgardeoSub);
    const res = await listBusinessMembers(token);
    expect(res.status).toBe(200);
    const body: Array<{ userId: string; displayName: string | null; role: string }> =
      await res.json();

    expect(body.map((m) => m.userId)).toEqual([owner.userId, manager.userId]);
    expect(body[0]).toMatchObject({ displayName: "Test owner", role: "owner" });
    expect(body[1]).toMatchObject({ displayName: "Test manager", role: "manager" });

    await ctx.cleanup();
  });

  it("scoping — another business's members never appear", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const owner = await mintUser(db, ctx, businessId, "owner");
    await mintUser(db, ctx, otherBusinessId, "owner");

    const token = await signAccessToken(owner.asgardeoSub);
    const res = await listBusinessMembers(token);
    expect(res.status).toBe(200);
    const body: Array<{ userId: string }> = await res.json();
    expect(body.map((m) => m.userId)).toEqual([owner.userId]);

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request("/api/business-member");
    expect(res.status).toBe(401);
    const body: { code: string } = await res.json();
    expect(body).toMatchObject({ code: "MISSING_TOKEN" });
  });

  it("403 — a linked driver has no dailyOperations capability", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await listBusinessMembers(token);
    expect(res.status).toBe(403);
    const body: { code: string } = await res.json();
    expect(body).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

    await ctx.cleanup();
  });
});

/** A11/W-57/F-1.4 test matrix: happy path (code returned, hashed at rest, reissue invalidates the prior code) · 401 · 403 (manager lacks manageMembers). */
describe("POST /api/business-member/invite (A11)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — the plaintext code is returned once and only its hash is stored; reissuing invalidates the prior code", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    ctx.trackCreatedBusinessMemberInvites(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner_manager");
    const token = await signAccessToken(owner.asgardeoSub);

    const first = await inviteMember(token, "manager");
    expect(first.status).toBe(201);
    const firstBody: { code: string; role: string; expiresAt: string } = await first.json();
    expect(firstBody.role).toBe("manager");

    const rows = await db
      .select()
      .from(businessMemberInvite)
      .where(eq(businessMemberInvite.businessId, businessId));
    expect(rows).toHaveLength(1);
    // The plaintext never touches the row — only a code a database read alone can never redeem.
    const firstRowHash = await hashInviteCode(firstBody.code);
    expect(rows[0]!.codeHash).toBe(firstRowHash);
    expect(JSON.stringify(rows[0])).not.toContain(firstBody.code);

    // F-1.4's own alternate: reissuing for the same role invalidates the prior unredeemed code.
    const second = await inviteMember(token, "manager");
    expect(second.status).toBe(201);
    const secondBody: { code: string } = await second.json();
    expect(secondBody.code).not.toBe(firstBody.code);

    const stillOpen = await db
      .select()
      .from(businessMemberInvite)
      .where(
        and(
          eq(businessMemberInvite.businessId, businessId),
          isNull(businessMemberInvite.consumedAt),
        ),
      );
    // Both rows exist (append-only, neither consumed nor deleted), but
    // reissuing expired the first immediately — strictly before the second,
    // freshly-issued row's own week-out expiry — without reading the device
    // clock to prove it (IG §4.5).
    expect(stillOpen).toHaveLength(2);
    const firstRow = stillOpen.find((r) => r.codeHash === firstRowHash);
    const secondRow = stillOpen.find((r) => r.codeHash !== firstRowHash);
    expect(secondRow!.codeHash).toBe(await hashInviteCode(secondBody.code));
    expect(firstRow!.expiresAt < secondRow!.expiresAt).toBe(true);

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request("/api/business-member/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "manager" }),
    });
    expect(res.status).toBe(401);
  });

  it("403 — a manager cannot invite anyone (manageMembers is OWNERS only)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const manager = await mintUser(db, ctx, businessId, "manager");
    const token = await signAccessToken(manager.asgardeoSub);

    const res = await inviteMember(token, "manager");
    expect(res.status).toBe(403);
    const body: { code: string } = await res.json();
    expect(body).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

    await ctx.cleanup();
  });
});

/** A11/GAP-43 test matrix: happy path · 404 cross-tenant · 409 the last active owner (INV-31) · 403. */
describe("POST /api/business-member/{id}/revoke (A11)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — access ends, the row stays (revoked, not deleted)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const owner = await mintUser(db, ctx, businessId, "owner_manager");
    const manager = await mintUser(db, ctx, businessId, "manager");
    const token = await signAccessToken(owner.asgardeoSub);

    const memberRow = await db
      .select()
      .from(businessMember)
      .where(eq(businessMember.userId, manager.userId));
    const memberId = memberRow[0]!.id;

    const res = await revokeMember(token, memberId);
    expect(res.status).toBe(200);
    const body: { id: string; revokedAt: string } = await res.json();
    expect(body.id).toBe(memberId);
    expect(body.revokedAt).toBeTruthy();

    const after = await db.select().from(businessMember).where(eq(businessMember.id, memberId));
    expect(after).toHaveLength(1);
    expect(after[0]!.revokedAt).not.toBeNull();

    await ctx.cleanup();
  });

  it("404 — a member belonging to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const owner = await mintUser(db, ctx, businessId, "owner_manager");
    const otherManager = await mintUser(db, ctx, otherBusinessId, "manager");
    const token = await signAccessToken(owner.asgardeoSub);

    const otherRow = await db
      .select()
      .from(businessMember)
      .where(eq(businessMember.userId, otherManager.userId));

    const res = await revokeMember(token, otherRow[0]!.id);
    expect(res.status).toBe(404);
    const body: { code: string } = await res.json();
    expect(body).toMatchObject({ code: "NOT_FOUND" });

    await ctx.cleanup();
  });

  it("409 — revoking the business's only active owner (INV-31)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const owner = await mintUser(db, ctx, businessId, "owner_manager");
    const token = await signAccessToken(owner.asgardeoSub);

    const ownRow = await db
      .select()
      .from(businessMember)
      .where(eq(businessMember.userId, owner.userId));

    const res = await revokeMember(token, ownRow[0]!.id);
    expect(res.status).toBe(409);
    const body: { code: string } = await res.json();
    expect(body).toMatchObject({ code: "LAST_OWNER_REQUIRED" });

    const after = await db
      .select()
      .from(businessMember)
      .where(eq(businessMember.id, ownRow[0]!.id));
    expect(after[0]!.revokedAt).toBeNull();

    await ctx.cleanup();
  });

  it("403 — a manager cannot revoke anyone", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const owner = await mintUser(db, ctx, businessId, "owner_manager");
    const manager = await mintUser(db, ctx, businessId, "manager");
    const token = await signAccessToken(manager.asgardeoSub);

    const ownerRow = await db
      .select()
      .from(businessMember)
      .where(eq(businessMember.userId, owner.userId));

    const res = await revokeMember(token, ownerRow[0]!.id);
    expect(res.status).toBe(403);

    await ctx.cleanup();
  });
});

/** A11 test matrix: happy path (revoke-and-grant, two rows) · 409 demoting the last owner (INV-31) · 404. */
describe("POST /api/business-member/{id}/change-role (A11)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — the old row is revoked, a new row holds the new role", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    // change-role writes a brand-new business_member row that mintUser's own
    // per-row tracking never sees — sweep the whole business's membership at
    // cleanup instead of tracking that new row's id by hand.
    ctx.trackCreatedBusiness(businessId, "unused");
    const owner = await mintUser(db, ctx, businessId, "owner_manager");
    const manager = await mintUser(db, ctx, businessId, "manager");
    const token = await signAccessToken(owner.asgardeoSub);

    const oldRow = await db
      .select()
      .from(businessMember)
      .where(eq(businessMember.userId, manager.userId));

    const res = await changeRole(token, oldRow[0]!.id, "owner_manager");
    expect(res.status).toBe(200);
    const body: { id: string; userId: string; role: string } = await res.json();
    expect(body).toMatchObject({ userId: manager.userId, role: "owner_manager" });
    expect(body.id).not.toBe(oldRow[0]!.id);

    const oldAfter = await db
      .select()
      .from(businessMember)
      .where(eq(businessMember.id, oldRow[0]!.id));
    expect(oldAfter[0]!.revokedAt).not.toBeNull();

    const newRow = await db.select().from(businessMember).where(eq(businessMember.id, body.id));
    expect(newRow).toHaveLength(1);
    expect(newRow[0]!.revokedAt).toBeNull();

    await ctx.cleanup();
  });

  it("409 — demoting the business's only active owner to manager (INV-31)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const owner = await mintUser(db, ctx, businessId, "owner_manager");
    const token = await signAccessToken(owner.asgardeoSub);

    const ownRow = await db
      .select()
      .from(businessMember)
      .where(eq(businessMember.userId, owner.userId));

    const res = await changeRole(token, ownRow[0]!.id, "manager");
    expect(res.status).toBe(409);
    const body: { code: string } = await res.json();
    expect(body).toMatchObject({ code: "LAST_OWNER_REQUIRED" });

    const after = await db
      .select()
      .from(businessMember)
      .where(eq(businessMember.id, ownRow[0]!.id));
    expect(after[0]!.revokedAt).toBeNull();
    expect(after[0]!.role).toBe("owner_manager");

    await ctx.cleanup();
  });

  it("404 — a member belonging to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const owner = await mintUser(db, ctx, businessId, "owner_manager");
    const otherManager = await mintUser(db, ctx, otherBusinessId, "manager");
    const token = await signAccessToken(owner.asgardeoSub);

    const otherRow = await db
      .select()
      .from(businessMember)
      .where(eq(businessMember.userId, otherManager.userId));

    const res = await changeRole(token, otherRow[0]!.id, "owner_manager");
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });
});
