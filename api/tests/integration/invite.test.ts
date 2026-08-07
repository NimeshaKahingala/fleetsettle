import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { appUser, businessMember, driver as driverTable } from "../../src/db/schema.js";
import { mintUser, signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

function inviteMember(token: string, role: string) {
  return request("/api/business-member/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ role }),
  });
}

function inviteDriverLink(token: string, driverId: string) {
  return request(`/api/driver/${driverId}/link-invite`, { method: "POST", ...bearer(token) });
}

function redeem(token: string, code: string) {
  return request("/api/invite/redeem", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ code }),
  });
}

/**
 * W-57 test matrix: one mechanism, two destinations — both proven happy,
 * plus the code-lifecycle edge cases neither destination can skip (already
 * consumed, never existed, this identity already belongs elsewhere). 401 is
 * proven once; `verifyTokenMiddleware`'s own matrix is exhaustively covered
 * in business.test.ts and not repeated per caller here.
 */
describe("POST /api/invite/redeem (A11/W-57)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — business_member: a fresh identity joins in the exact role the code carried, never a role it supplied", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    // Order matters (LIFO): the invite-table sweep must be tracked *after*
    // trackCreatedBusiness, so it unwinds *before* trackCreatedBusiness tries
    // to delete the business itself — business_member_invite also carries a
    // (no-cascade) FK to business.
    ctx.trackCreatedBusiness(businessId, "unused");
    ctx.trackCreatedBusinessMemberInvites(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner_manager");
    const ownerToken = await signAccessToken(owner.asgardeoSub);

    const issued = await inviteMember(ownerToken, "owner");
    expect(issued.status).toBe(201);
    const { code }: { code: string } = await issued.json();

    const freshSub = `test-sub-redeemer-${crypto.randomUUID()}`;
    const freshToken = await signAccessToken(freshSub);

    // Redeeming never lets the invitee pick their own role (F-1.4's own
    // accept clause) — the request carries only the code.
    const res = await redeem(freshToken, code);
    expect(res.status).toBe(200);
    const body: { kind: string; businessId: string; role: string } = await res.json();
    expect(body).toMatchObject({ kind: "business_member", businessId, role: "owner" });

    const userRows = await db.select().from(appUser).where(eq(appUser.asgardeoSub, freshSub));
    expect(userRows).toHaveLength(1);
    const memberRows = await db
      .select()
      .from(businessMember)
      .where(eq(businessMember.userId, userRows[0]!.id));
    expect(memberRows).toHaveLength(1);
    expect(memberRows[0]).toMatchObject({ businessId, role: "owner", revokedAt: null });

    // Redeeming the same code a second time — already consumed.
    const secondSub = `test-sub-redeemer-2-${crypto.randomUUID()}`;
    const secondToken = await signAccessToken(secondSub);
    const second = await redeem(secondToken, code);
    expect(second.status).toBe(400);
    const secondBody: { code: string } = await second.json();
    expect(secondBody).toMatchObject({ code: "INVITE_CODE_INVALID" });

    await ctx.cleanup();
  });

  it("happy path — driver_link: the driver's own account is linked, no business_member row is ever written", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const driverId = await ctx.createDriver(businessId, { name: "Sunil" });
    ctx.trackCreatedDriverLinkInvites(driverId);
    const manager = await mintUser(db, ctx, businessId, "manager");
    const managerToken = await signAccessToken(manager.asgardeoSub);

    const issued = await inviteDriverLink(managerToken, driverId);
    expect(issued.status).toBe(201);
    const { code }: { code: string } = await issued.json();

    const freshSub = `test-sub-driver-redeemer-${crypto.randomUUID()}`;
    const freshToken = await signAccessToken(freshSub);

    const res = await redeem(freshToken, code);
    expect(res.status).toBe(200);
    const body: { kind: string; driverId: string } = await res.json();
    expect(body).toMatchObject({ kind: "driver_link", driverId });

    const driverRows = await db.select().from(driverTable).where(eq(driverTable.id, driverId));
    const userRows = await db.select().from(appUser).where(eq(appUser.asgardeoSub, freshSub));
    expect(driverRows[0]!.linkedUserId).toBe(userRows[0]!.id);

    const memberRows = await db
      .select()
      .from(businessMember)
      .where(eq(businessMember.userId, userRows[0]!.id));
    expect(memberRows).toHaveLength(0);

    await ctx.cleanup();
  });

  it("400 — a code that never existed", async () => {
    const token = await signAccessToken(`test-sub-bad-code-${crypto.randomUUID()}`);
    const res = await redeem(token, "NOTREAL-CODEXX");
    expect(res.status).toBe(400);
    const body: { code: string } = await res.json();
    expect(body).toMatchObject({ code: "INVITE_CODE_INVALID" });
  });

  it("409 — this identity already belongs to a business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    ctx.trackCreatedBusinessMemberInvites(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner_manager");
    const ownerToken = await signAccessToken(owner.asgardeoSub);

    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const alreadyMember = await mintUser(db, ctx, otherBusinessId, "manager");

    const issued = await inviteMember(ownerToken, "manager");
    const { code }: { code: string } = await issued.json();

    const token = await signAccessToken(alreadyMember.asgardeoSub);
    const res = await redeem(token, code);
    expect(res.status).toBe(409);
    const body: { code: string } = await res.json();
    expect(body).toMatchObject({ code: "BUSINESS_ALREADY_EXISTS" });

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request("/api/invite/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "ANYTHING-HERE1" }),
    });
    expect(res.status).toBe(401);
    const body: { code: string } = await res.json();
    expect(body).toMatchObject({ code: "MISSING_TOKEN" });
  });
});
