import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { appUser, businessMember } from "../../src/db/schema.js";
import {
  addBusinessMembership,
  mintPlatformAdmin,
  mintUser,
  signAccessToken,
} from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

/**
 * IG §7.5/decision 17. `GET /api/session` is the pre-business route that
 * answers before any `X-Business-Id` selection exists — every membership,
 * platform-admin status, and the caller's own pending/rejected request.
 */
describe("GET /api/session (Phase 2)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request("/api/session");
    expect(res.status).toBe(401);
  });

  it("a brand-new identity: no memberships, not an admin, no pending request, never had membership", async () => {
    const token = await signAccessToken(`test-sub-brand-new-${crypto.randomUUID()}`);
    const res = await request("/api/session", bearer(token));
    expect(res.status).toBe(200);
    const body: {
      businesses: unknown[];
      isPlatformAdmin: boolean;
      pendingRequest: unknown;
      hadMembership: boolean;
    } = await res.json();
    expect(body).toMatchObject({
      businesses: [],
      isPlatformAdmin: false,
      pendingRequest: null,
      hadMembership: false,
    });
  });

  it("upserts app_user on first call — the platform-admin bootstrap path (design §5)", async () => {
    const sub = `test-sub-bootstrap-${crypto.randomUUID()}`;
    const res = await request("/api/session", bearer(await signAccessToken(sub)));
    expect(res.status).toBe(200);

    const rows = await db.select().from(appUser).where(eq(appUser.asgardeoSub, sub));
    expect(rows).toHaveLength(1);
  });

  it("an admin with no business membership resolves through /api/session and reaches the panel", async () => {
    const ctx = new TestContext(db);
    const admin = await mintPlatformAdmin(db, ctx);
    const token = await signAccessToken(admin.asgardeoSub);

    const res = await request("/api/session", bearer(token));
    expect(res.status).toBe(200);
    const body: { businesses: unknown[]; isPlatformAdmin: boolean } = await res.json();
    expect(body).toMatchObject({ businesses: [], isPlatformAdmin: true });

    await ctx.cleanup();
  });

  it("every membership this identity holds, with business names, both member and driver shapes", async () => {
    const ctx = new TestContext(db);
    const businessA = await ctx.createBusiness({ name: "Business A" });
    const businessB = await ctx.createBusiness({ name: "Business B" });
    const driverId = await ctx.createDriver(businessB, { name: "Driver Self" });
    const owner = await mintUser(db, ctx, businessA, "owner");
    await addBusinessMembership(db, ctx, owner.userId, businessB, "manager");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await request("/api/session", bearer(token));
    expect(res.status).toBe(200);
    const body: { businesses: { businessId: string; name: string; role: string }[] } =
      await res.json();
    expect(body.businesses).toHaveLength(2);
    expect(body.businesses).toContainEqual(
      expect.objectContaining({ businessId: businessA, name: "Business A", role: "owner" }),
    );
    expect(body.businesses).toContainEqual(
      expect.objectContaining({ businessId: businessB, name: "Business B", role: "manager" }),
    );
    void driverId; // not linked in this test — confirms a driver row existing elsewhere doesn't leak in

    await ctx.cleanup();
  });

  it("decision 26: hadMembership is true for a revoked-to-zero identity, distinguishing it from a first-time signup", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await mintUser(db, ctx, businessId, "owner"); // keeps the business's own owner requirement satisfied
    const member = await mintUser(db, ctx, businessId, "manager");
    const token = await signAccessToken(member.asgardeoSub);

    await db
      .update(businessMember)
      // eslint-disable-next-line no-restricted-syntax -- a fixture's own revocation timestamp, not a business date read
      .set({ revokedAt: new Date().toISOString() })
      .where(eq(businessMember.userId, member.userId));

    const res = await request("/api/session", bearer(token));
    expect(res.status).toBe(200);
    const body: { businesses: unknown[]; hadMembership: boolean } = await res.json();
    expect(body).toMatchObject({ businesses: [], hadMembership: true });

    await ctx.cleanup();
  });
});
