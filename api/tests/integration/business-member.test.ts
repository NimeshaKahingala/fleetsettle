import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { businessMember } from "../../src/db/schema.js";
import { writer } from "../../src/db/client.js";
import { mintLinkedDriver, mintUser, signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

async function listBusinessMembers(token: string) {
  return request("/api/business-member", bearer(token));
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
