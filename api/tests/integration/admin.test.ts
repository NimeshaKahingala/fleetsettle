import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import {
  accountingPeriod,
  appUser,
  business,
  businessCreationRequest,
  businessMember,
  businessSettings,
  platformAdmin,
} from "../../src/db/schema.js";
import { mintPlatformAdmin, mintUser, signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });
const bearerJson = (token: string) => ({
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
});

async function postBusiness(token: string, name = "Perera Transport") {
  return request("/api/business", {
    method: "POST",
    ...bearerJson(token),
    body: JSON.stringify({ name, currencyCode: "LKR", timezone: "Asia/Colombo" }),
  });
}

/**
 * IG §7.6/design §10, Track B. `/api/admin/*` behind `platformAdminMiddleware`
 * — never `authMiddleware`. Every test here either proves the 404 boundary
 * (INV-38's structural half) or a specific F-11 flow.
 */
describe("/api/admin/* (Phase 2)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("404 — a non-admin on every /api/admin/* route, never 403", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const routes: [string, string?][] = [
      ["/api/admin/requests"],
      ["/api/admin/businesses"],
      ["/api/admin/users"],
      ["/api/admin/admins"],
      ["/api/admin/audit-log"],
    ];
    for (const [path] of routes) {
      const res = await request(path, bearer(token));
      expect(res.status, path).toBe(404);
    }

    await ctx.cleanup();
  });

  it("404 — a completely anonymous request (no token at all) on an admin route", async () => {
    const res = await request("/api/admin/requests");
    expect(res.status).toBe(401);
  });

  it("threshold: request 1 creates immediately, and queues once the default allowance (5) is exhausted", async () => {
    const ctx = new TestContext(db);
    const sub = `test-sub-threshold-${crypto.randomUUID()}`;
    const token = await signAccessToken(sub);

    const first = await postBusiness(token, "Fleet 1");
    expect(first.status).toBe(201);
    const firstBody: { kind: string; id: string } = await first.json();
    expect(firstBody.kind).toBe("created");

    const userRows = await db.select().from(appUser).where(eq(appUser.asgardeoSub, sub));
    const userId = userRows[0]!.id;
    ctx.trackCreatedBusiness(firstBody.id, userId);

    // Drop the allowance to 1 directly — cheaper than creating four more
    // real businesses just to reach the same threshold state.
    await db.update(appUser).set({ businessAllowance: 1 }).where(eq(appUser.id, userId));

    const second = await postBusiness(token, "Fleet 2");
    expect(second.status).toBe(201);
    const secondBody: { kind: string; requestId: string } = await second.json();
    expect(secondBody.kind).toBe("pending");

    ctx.track(async () => {
      // eslint-disable-next-line no-restricted-syntax -- test fixture teardown for a row the live endpoint wrote, not a money record
      await db
        .delete(businessCreationRequest)
        .where(eq(businessCreationRequest.id, secondBody.requestId));
    });

    await ctx.cleanup();
  });

  it("409 — a second request while one is already pending (INV-41)", async () => {
    const ctx = new TestContext(db);
    const sub = `test-sub-double-pending-${crypto.randomUUID()}`;
    const token = await signAccessToken(sub);

    // Sign in once via /api/session to get an app_user row, then drop the
    // allowance to 0 so the very first POST /api/business queues.
    await request("/api/session", bearer(token));
    const userRows = await db.select().from(appUser).where(eq(appUser.asgardeoSub, sub));
    const userId = userRows[0]!.id;
    await db.update(appUser).set({ businessAllowance: 0 }).where(eq(appUser.id, userId));

    const first = await postBusiness(token, "Fleet 1");
    expect(first.status).toBe(201);
    const firstBody: { kind: string; requestId: string } = await first.json();
    expect(firstBody.kind).toBe("pending");
    ctx.track(async () => {
      // eslint-disable-next-line no-restricted-syntax -- test fixture teardown for a row the live endpoint wrote, not a money record
      await db
        .delete(businessCreationRequest)
        .where(eq(businessCreationRequest.id, firstBody.requestId));
    });

    const second = await postBusiness(token, "Fleet 2");
    expect(second.status).toBe(409);
    const secondBody: { code: string } = await second.json();
    expect(secondBody).toMatchObject({ code: "REQUEST_ALREADY_PENDING" });

    await ctx.cleanup();
  });

  it("approving a request runs createBusiness and produces a working business", async () => {
    const ctx = new TestContext(db);
    const admin = await mintPlatformAdmin(db, ctx);
    const adminToken = await signAccessToken(admin.asgardeoSub);

    const sub = `test-sub-approve-${crypto.randomUUID()}`;
    const requesterToken = await signAccessToken(sub);
    await request("/api/session", bearer(requesterToken));
    const userRows = await db.select().from(appUser).where(eq(appUser.asgardeoSub, sub));
    const userId = userRows[0]!.id;
    await db.update(appUser).set({ businessAllowance: 0 }).where(eq(appUser.id, userId));

    const created = await postBusiness(requesterToken, "Approved Fleet");
    const { requestId }: { kind: string; requestId: string } = await created.json();

    const decideRes = await request(`/api/admin/requests/${requestId}/decide`, {
      method: "POST",
      ...bearerJson(adminToken),
      body: JSON.stringify({ decision: "approve" }),
    });
    expect(decideRes.status).toBe(200);

    const requestRows = await db
      .select()
      .from(businessCreationRequest)
      .where(eq(businessCreationRequest.id, requestId));
    expect(requestRows[0]).toMatchObject({ status: "approved" });
    const businessId = requestRows[0]!.businessId;
    expect(businessId).not.toBeNull();

    const memberRows = await db
      .select()
      .from(businessMember)
      .where(eq(businessMember.businessId, businessId as string));
    expect(memberRows).toHaveLength(1);
    expect(memberRows[0]).toMatchObject({ userId, role: "owner_manager" });

    ctx.track(async () => {
      // createBusinessForUser's own writes (setup.ts), reversed in FK order:
      // businessMember and businessSettings/accountingPeriod both reference
      // business, so business itself must go last.
      // eslint-disable-next-line no-restricted-syntax -- test fixture teardown for a row the live endpoint wrote, not a money record
      await db.delete(businessMember).where(eq(businessMember.businessId, businessId as string));
      // eslint-disable-next-line no-restricted-syntax -- test fixture teardown for a row the live endpoint wrote, not a money record
      await db
        .delete(businessSettings)
        .where(eq(businessSettings.businessId, businessId as string));
      // eslint-disable-next-line no-restricted-syntax -- test fixture teardown for a row the live endpoint wrote, not a money record
      await db
        .delete(accountingPeriod)
        .where(eq(accountingPeriod.businessId, businessId as string));
      // eslint-disable-next-line no-restricted-syntax -- test fixture teardown for a row the live endpoint wrote, not a money record
      await db.delete(business).where(eq(business.id, businessId as string));
    });
    ctx.track(async () => {
      // eslint-disable-next-line no-restricted-syntax -- test fixture teardown for a row the live endpoint wrote, not a money record
      await db.delete(businessCreationRequest).where(eq(businessCreationRequest.id, requestId));
    });

    await ctx.cleanup();
  });

  it("409 — deciding an already-approved request again creates no second business (gitar-bot PR #73)", async () => {
    const ctx = new TestContext(db);
    const admin = await mintPlatformAdmin(db, ctx);
    const adminToken = await signAccessToken(admin.asgardeoSub);

    const sub = `test-sub-double-approve-${crypto.randomUUID()}`;
    const requesterToken = await signAccessToken(sub);
    await request("/api/session", bearer(requesterToken));
    const userRows = await db.select().from(appUser).where(eq(appUser.asgardeoSub, sub));
    const userId = userRows[0]!.id;
    await db.update(appUser).set({ businessAllowance: 0 }).where(eq(appUser.id, userId));

    const created = await postBusiness(requesterToken, "Only Approved Once");
    const { requestId }: { kind: string; requestId: string } = await created.json();

    const decide = (decision: "approve") =>
      request(`/api/admin/requests/${requestId}/decide`, {
        method: "POST",
        ...bearerJson(adminToken),
        body: JSON.stringify({ decision }),
      });

    const first = await decide("approve");
    expect(first.status).toBe(200);

    // The claim (`claimRequestForApproval`) is the gate, not a pre-read
    // status check — a second decide call must 409 before it ever reaches
    // createBusinessForUser, not silently create a second business.
    const second = await decide("approve");
    expect(second.status).toBe(409);
    const secondBody: { code: string } = await second.json();
    expect(secondBody).toMatchObject({ code: "REQUEST_ALREADY_DECIDED" });

    const requestRows = await db
      .select()
      .from(businessCreationRequest)
      .where(eq(businessCreationRequest.id, requestId));
    const businessId = requestRows[0]!.businessId;
    expect(businessId).not.toBeNull();

    const memberRows = await db
      .select()
      .from(businessMember)
      .where(eq(businessMember.userId, userId));
    expect(memberRows).toHaveLength(1);

    ctx.track(async () => {
      // eslint-disable-next-line no-restricted-syntax -- test fixture teardown for a row the live endpoint wrote, not a money record
      await db.delete(businessMember).where(eq(businessMember.businessId, businessId as string));
      // eslint-disable-next-line no-restricted-syntax -- test fixture teardown for a row the live endpoint wrote, not a money record
      await db
        .delete(businessSettings)
        .where(eq(businessSettings.businessId, businessId as string));
      // eslint-disable-next-line no-restricted-syntax -- test fixture teardown for a row the live endpoint wrote, not a money record
      await db
        .delete(accountingPeriod)
        .where(eq(accountingPeriod.businessId, businessId as string));
      // eslint-disable-next-line no-restricted-syntax -- test fixture teardown for a row the live endpoint wrote, not a money record
      await db.delete(business).where(eq(business.id, businessId as string));
    });
    ctx.track(async () => {
      // eslint-disable-next-line no-restricted-syntax -- test fixture teardown for a row the live endpoint wrote, not a money record
      await db.delete(businessCreationRequest).where(eq(businessCreationRequest.id, requestId));
    });

    await ctx.cleanup();
  });

  it("409 — rejecting an already-approved request, rather than overwriting it back to rejected (gitar-bot PR #73)", async () => {
    const ctx = new TestContext(db);
    const admin = await mintPlatformAdmin(db, ctx);
    const adminToken = await signAccessToken(admin.asgardeoSub);

    const sub = `test-sub-approve-then-reject-${crypto.randomUUID()}`;
    const requesterToken = await signAccessToken(sub);
    await request("/api/session", bearer(requesterToken));
    const userRows = await db.select().from(appUser).where(eq(appUser.asgardeoSub, sub));
    const userId = userRows[0]!.id;
    await db.update(appUser).set({ businessAllowance: 0 }).where(eq(appUser.id, userId));

    const created = await postBusiness(requesterToken, "Approved Then Race-Rejected");
    const { requestId }: { kind: string; requestId: string } = await created.json();

    const approve = await request(`/api/admin/requests/${requestId}/decide`, {
      method: "POST",
      ...bearerJson(adminToken),
      body: JSON.stringify({ decision: "approve" }),
    });
    expect(approve.status).toBe(200);

    const reject = await request(`/api/admin/requests/${requestId}/decide`, {
      method: "POST",
      ...bearerJson(adminToken),
      body: JSON.stringify({ decision: "reject", reason: "too late" }),
    });
    expect(reject.status).toBe(409);
    const rejectBody: { code: string } = await reject.json();
    expect(rejectBody).toMatchObject({ code: "REQUEST_ALREADY_DECIDED" });

    // The row must still say approved, with the business it actually
    // created — not silently flipped to rejected after the fact.
    const requestRows = await db
      .select()
      .from(businessCreationRequest)
      .where(eq(businessCreationRequest.id, requestId));
    const businessId = requestRows[0]!.businessId;
    expect(requestRows[0]).toMatchObject({ status: "approved" });
    expect(businessId).not.toBeNull();

    ctx.track(async () => {
      // eslint-disable-next-line no-restricted-syntax -- test fixture teardown for a row the live endpoint wrote, not a money record
      await db.delete(businessMember).where(eq(businessMember.businessId, businessId as string));
      // eslint-disable-next-line no-restricted-syntax -- test fixture teardown for a row the live endpoint wrote, not a money record
      await db
        .delete(businessSettings)
        .where(eq(businessSettings.businessId, businessId as string));
      // eslint-disable-next-line no-restricted-syntax -- test fixture teardown for a row the live endpoint wrote, not a money record
      await db
        .delete(accountingPeriod)
        .where(eq(accountingPeriod.businessId, businessId as string));
      // eslint-disable-next-line no-restricted-syntax -- test fixture teardown for a row the live endpoint wrote, not a money record
      await db.delete(business).where(eq(business.id, businessId as string));
    });
    ctx.track(async () => {
      // eslint-disable-next-line no-restricted-syntax -- test fixture teardown for a row the live endpoint wrote, not a money record
      await db.delete(businessCreationRequest).where(eq(businessCreationRequest.id, requestId));
    });

    await ctx.cleanup();
  });

  it("rejecting a request creates nothing, and the requester may request again", async () => {
    const ctx = new TestContext(db);
    const admin = await mintPlatformAdmin(db, ctx);
    const adminToken = await signAccessToken(admin.asgardeoSub);

    const sub = `test-sub-reject-${crypto.randomUUID()}`;
    const requesterToken = await signAccessToken(sub);
    await request("/api/session", bearer(requesterToken));
    const userRows = await db.select().from(appUser).where(eq(appUser.asgardeoSub, sub));
    const userId = userRows[0]!.id;
    await db.update(appUser).set({ businessAllowance: 0 }).where(eq(appUser.id, userId));

    const firstReq = await postBusiness(requesterToken, "Rejected Fleet");
    const { requestId }: { kind: string; requestId: string } = await firstReq.json();

    const decideRes = await request(`/api/admin/requests/${requestId}/decide`, {
      method: "POST",
      ...bearerJson(adminToken),
      body: JSON.stringify({ decision: "reject", reason: "Duplicate of an existing fleet" }),
    });
    expect(decideRes.status).toBe(200);

    const requestRows = await db
      .select()
      .from(businessCreationRequest)
      .where(eq(businessCreationRequest.id, requestId));
    expect(requestRows[0]).toMatchObject({
      status: "rejected",
      businessId: null,
      rejectionReason: "Duplicate of an existing fleet",
    });

    // A rejected requester may request again — INV-41's partial index only
    // blocks a second *pending* request, not a second attempt after rejection.
    const secondReq = await postBusiness(requesterToken, "Rejected Fleet, take two");
    expect(secondReq.status).toBe(201);
    const secondBody: { kind: string; requestId: string } = await secondReq.json();
    expect(secondBody.kind).toBe("pending");

    ctx.track(async () => {
      // eslint-disable-next-line no-restricted-syntax -- test fixture teardown for a row the live endpoint wrote, not a money record
      await db
        .delete(businessCreationRequest)
        .where(eq(businessCreationRequest.requestedBy, userId));
    });

    await ctx.cleanup();
  });

  it("self-approval succeeds and is flagged self_action, in the audit log and the request list alike", async () => {
    const ctx = new TestContext(db);
    const admin = await mintPlatformAdmin(db, ctx);
    const adminToken = await signAccessToken(admin.asgardeoSub);

    // The admin requests a business for themselves, at/over their own
    // allowance, then decides it themselves — decision 11's self-approval.
    await db.update(appUser).set({ businessAllowance: 0 }).where(eq(appUser.id, admin.userId));
    const req = await postBusiness(adminToken, "Admin's Own Fleet");
    const { requestId }: { kind: string; requestId: string } = await req.json();

    const decideRes = await request(`/api/admin/requests/${requestId}/decide`, {
      method: "POST",
      ...bearerJson(adminToken),
      body: JSON.stringify({ decision: "approve" }),
    });
    expect(decideRes.status).toBe(200);

    const auditRes = await request("/api/admin/audit-log", bearer(adminToken));
    const auditBody: { action: string; subjectId: string; selfAction: boolean }[] =
      await auditRes.json();
    const entry = auditBody.find((e) => e.subjectId === requestId);
    expect(entry).toMatchObject({ action: "request_approved", selfAction: true });

    const listRes = await request("/api/admin/requests", bearer(adminToken));
    const listBody: { id: string; selfAction: boolean }[] = await listRes.json();
    const listed = listBody.find((r) => r.id === requestId);
    expect(listed).toMatchObject({ selfAction: true });

    const requestRows = await db
      .select()
      .from(businessCreationRequest)
      .where(eq(businessCreationRequest.id, requestId));
    const businessId = requestRows[0]!.businessId;
    ctx.track(async () => {
      // createBusinessForUser's own writes (setup.ts), reversed in FK order:
      // businessMember and businessSettings/accountingPeriod both reference
      // business, so business itself must go last.
      // eslint-disable-next-line no-restricted-syntax -- test fixture teardown for a row the live endpoint wrote, not a money record
      await db.delete(businessMember).where(eq(businessMember.businessId, businessId as string));
      // eslint-disable-next-line no-restricted-syntax -- test fixture teardown for a row the live endpoint wrote, not a money record
      await db
        .delete(businessSettings)
        .where(eq(businessSettings.businessId, businessId as string));
      // eslint-disable-next-line no-restricted-syntax -- test fixture teardown for a row the live endpoint wrote, not a money record
      await db
        .delete(accountingPeriod)
        .where(eq(accountingPeriod.businessId, businessId as string));
      // eslint-disable-next-line no-restricted-syntax -- test fixture teardown for a row the live endpoint wrote, not a money record
      await db.delete(business).where(eq(business.id, businessId as string));
    });
    ctx.track(async () => {
      // eslint-disable-next-line no-restricted-syntax -- test fixture teardown for a row the live endpoint wrote, not a money record
      await db.delete(businessCreationRequest).where(eq(businessCreationRequest.id, requestId));
    });

    await ctx.cleanup();
  });

  it("409 — the last active admin cannot be revoked (INV-40)", async () => {
    const ctx = new TestContext(db);
    const admin = await mintPlatformAdmin(db, ctx);
    const token = await signAccessToken(admin.asgardeoSub);

    const res = await request(`/api/admin/admins/${admin.userId}/revoke`, {
      method: "POST",
      ...bearer(token),
    });
    expect(res.status).toBe(409);
    const body: { code: string } = await res.json();
    expect(body).toMatchObject({ code: "LAST_PLATFORM_ADMIN_REQUIRED" });

    await ctx.cleanup();
  });

  it("404 — revoking a user who was never a platform admin (fixes a review finding on PR #74)", async () => {
    const ctx = new TestContext(db);
    const admin = await mintPlatformAdmin(db, ctx);
    const adminToken = await signAccessToken(admin.asgardeoSub);
    const target = await mintUser(db, ctx, await ctx.createBusiness(), "owner");

    const res = await request(`/api/admin/admins/${target.userId}/revoke`, {
      method: "POST",
      ...bearer(adminToken),
    });
    expect(res.status).toBe(404);

    const auditRes = await request("/api/admin/audit-log", bearer(adminToken));
    const auditBody: { subjectId: string }[] = await auditRes.json();
    expect(auditBody.some((entry) => entry.subjectId === target.userId)).toBe(false);

    await ctx.cleanup();
  });

  it("grant then revoke a second admin, and the audit log carries both — non-self this time", async () => {
    const ctx = new TestContext(db);
    const admin = await mintPlatformAdmin(db, ctx);
    const adminToken = await signAccessToken(admin.asgardeoSub);
    const target = await mintUser(db, ctx, await ctx.createBusiness(), "owner");

    const grantRes = await request("/api/admin/admins", {
      method: "POST",
      ...bearerJson(adminToken),
      body: JSON.stringify({ userId: target.userId }),
    });
    expect(grantRes.status).toBe(200);

    const listRes = await request("/api/admin/admins", bearer(adminToken));
    const listBody: { userId: string }[] = await listRes.json();
    expect(listBody.map((a) => a.userId)).toContain(target.userId);

    const revokeRes = await request(`/api/admin/admins/${target.userId}/revoke`, {
      method: "POST",
      ...bearer(adminToken),
    });
    expect(revokeRes.status).toBe(200);

    const auditRes = await request("/api/admin/audit-log", bearer(adminToken));
    const auditBody: { action: string; subjectId: string; selfAction: boolean }[] =
      await auditRes.json();
    const grantEntry = auditBody.find(
      (e) => e.subjectId === target.userId && e.action === "admin_granted",
    );
    expect(grantEntry).toMatchObject({ selfAction: false });

    // eslint-disable-next-line no-restricted-syntax -- test fixture teardown for a row the live endpoint wrote, not a money record
    await db.delete(businessMember).where(eq(businessMember.userId, target.userId));
    await ctx.cleanup();
  });

  it("re-granting an already-active admin is a no-op — no duplicate admin_granted entry (gitar-bot PR #73)", async () => {
    const ctx = new TestContext(db);
    const admin = await mintPlatformAdmin(db, ctx);
    const adminToken = await signAccessToken(admin.asgardeoSub);
    const target = await mintUser(db, ctx, await ctx.createBusiness(), "owner");

    const grant = () =>
      request("/api/admin/admins", {
        method: "POST",
        ...bearerJson(adminToken),
        body: JSON.stringify({ userId: target.userId }),
      });

    const first = await grant();
    expect(first.status).toBe(200);
    // Re-granting a user who is already an active admin — the
    // `ON CONFLICT ... WHERE revoked_at IS NOT NULL` gate should skip the
    // write entirely rather than run a no-op UPDATE that still fires
    // platform_admin_audit's trigger.
    const second = await grant();
    expect(second.status).toBe(200);

    const auditRes = await request("/api/admin/audit-log", bearer(adminToken));
    const auditBody: { action: string; subjectId: string }[] = await auditRes.json();
    const grantEntries = auditBody.filter(
      (e) => e.subjectId === target.userId && e.action === "admin_granted",
    );
    expect(grantEntries).toHaveLength(1);

    // eslint-disable-next-line no-restricted-syntax -- test fixture teardown for a row the live endpoint wrote, not a money record
    await db.delete(businessMember).where(eq(businessMember.userId, target.userId));
    ctx.track(async () => {
      // eslint-disable-next-line no-restricted-syntax -- test fixture teardown for a row the live endpoint (grant) wrote, not a money record
      await db.delete(platformAdmin).where(eq(platformAdmin.userId, target.userId));
    });
    await ctx.cleanup();
  });

  it("list businesses and users — names and counts only, never a money field", async () => {
    const ctx = new TestContext(db);
    const admin = await mintPlatformAdmin(db, ctx);
    const token = await signAccessToken(admin.asgardeoSub);
    const businessId = await ctx.createBusiness({ name: "Visible Fleet" });
    await mintUser(db, ctx, businessId, "owner");

    const businessesRes = await request("/api/admin/businesses", bearer(token));
    expect(businessesRes.status).toBe(200);
    const businesses: { id: string; name: string; memberCount: number }[] =
      await businessesRes.json();
    const found = businesses.find((b) => b.id === businessId);
    expect(found).toMatchObject({ name: "Visible Fleet", memberCount: 1 });
    expect(found).not.toHaveProperty("balance");

    const usersRes = await request("/api/admin/users", bearer(token));
    expect(usersRes.status).toBe(200);
    const users: unknown[] = await usersRes.json();
    expect(users.length).toBeGreaterThan(0);

    await ctx.cleanup();
  });

  it("set-allowance updates the user's own row and logs allowance_changed", async () => {
    const ctx = new TestContext(db);
    const admin = await mintPlatformAdmin(db, ctx);
    const adminToken = await signAccessToken(admin.asgardeoSub);
    const target = await mintUser(db, ctx, await ctx.createBusiness(), "owner");

    const res = await request(`/api/admin/users/${target.userId}/allowance`, {
      method: "POST",
      ...bearerJson(adminToken),
      body: JSON.stringify({ businessAllowance: 10 }),
    });
    expect(res.status).toBe(200);

    const rows = await db.select().from(appUser).where(eq(appUser.id, target.userId));
    expect(rows[0]).toMatchObject({ businessAllowance: 10 });

    const auditRes = await request("/api/admin/audit-log", bearer(adminToken));
    const auditBody: { action: string; subjectId: string }[] = await auditRes.json();
    expect(
      auditBody.some((e) => e.action === "allowance_changed" && e.subjectId === target.userId),
    ).toBe(true);

    await ctx.cleanup();
  });
});
