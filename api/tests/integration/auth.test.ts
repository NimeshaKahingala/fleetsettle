import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { businessMember } from "../../src/db/schema.js";
import {
  addBusinessMembership,
  linkExistingUserAsDriver,
  mintUser,
  mintLinkedDriver,
  signAccessToken,
} from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

/** Same as `bearer`, plus the header IG §7.5's five-step rule selects on. */
const bearerFor = (token: string, businessId: string) => ({
  headers: { Authorization: `Bearer ${token}`, "X-Business-Id": businessId },
});

/**
 * TRACKER.md P1 "Done means": happy path · 401 missing header · 401 verifier
 * throws · 403 capability · 404 for another business, plus the linked-driver
 * class (W-49's hard boundary) — a driver token gets 404 for another
 * driver's row, same as a foreign business would.
 */
describe("auth boundary (P1)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — a verified owner resolves to their business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await request("/api/me", bearer(token));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: owner.userId, businessId, role: "owner" });

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request("/api/me");
    expect(res.status).toBe(401);
    const body: { code: string } = await res.json();
    expect(body).toMatchObject({ code: "MISSING_TOKEN" });
  });

  it("401 — the verifier rejects a token it did not sign", async () => {
    const res = await request("/api/me", bearer("not-a-real-jwt"));
    expect(res.status).toBe(401);
    const body: { code: string } = await res.json();
    expect(body).toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("401 — a correctly-signed token with the wrong audience", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub, { audience: "someone-elses-app" });

    const res = await request("/api/me", bearer(token));
    expect(res.status).toBe(401);

    await ctx.cleanup();
  });

  it("404 — a verified identity with no business_member and no linked driver row", async () => {
    const token = await signAccessToken("test-sub-nobody-knows-this-user");
    const res = await request("/api/me", bearer(token));
    expect(res.status).toBe(404);
  });

  it("403 — a manager lacks closePeriod, 200 — an owner and an owner_manager have it", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const manager = await mintUser(db, ctx, businessId, "manager");
    const owner = await mintUser(db, ctx, businessId, "owner");
    const ownerManager = await mintUser(db, ctx, businessId, "owner_manager");

    const managerRes = await request("/api/_probe/close-period", {
      method: "POST",
      ...bearer(await signAccessToken(manager.asgardeoSub)),
    });
    expect(managerRes.status).toBe(403);
    const managerBody: { code: string } = await managerRes.json();
    expect(managerBody).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

    const ownerRes = await request("/api/_probe/close-period", {
      method: "POST",
      ...bearer(await signAccessToken(owner.asgardeoSub)),
    });
    expect(ownerRes.status).toBe(200);

    const ownerManagerRes = await request("/api/_probe/close-period", {
      method: "POST",
      ...bearer(await signAccessToken(ownerManager.asgardeoSub)),
    });
    expect(ownerManagerRes.status).toBe(200);

    await ctx.cleanup();
  });

  it("404 — a vehicle belonging to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const ownVehicle = await ctx.createVehicle(businessId);
    const otherVehicle = await ctx.createVehicle(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const ownRes = await request(`/api/_probe/vehicle/${ownVehicle}`, bearer(token));
    expect(ownRes.status).toBe(200);

    const otherRes = await request(`/api/_probe/vehicle/${otherVehicle}`, bearer(token));
    expect(otherRes.status).toBe(404);

    await ctx.cleanup();
  });

  it("404 — a linked driver reading another driver's row (W-49's hard boundary)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const ownDriverId = await ctx.createDriver(businessId, { name: "Own Driver" });
    const otherDriverId = await ctx.createDriver(businessId, { name: "Other Driver" });
    const linked = await mintLinkedDriver(db, ctx, ownDriverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const ownRes = await request(`/api/_probe/driver/${ownDriverId}`, bearer(token));
    expect(ownRes.status).toBe(200);

    const otherRes = await request(`/api/_probe/driver/${otherDriverId}`, bearer(token));
    expect(otherRes.status).toBe(404);

    await ctx.cleanup();
  });

  it("a linked driver has no closePeriod capability either", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await request("/api/_probe/close-period", { method: "POST", ...bearer(token) });
    expect(res.status).toBe(403);

    await ctx.cleanup();
  });

  /**
   * Phase 1 (18 Aug 2026, W-63 to W-67): `resolveMemberships` returns every
   * active membership now, not at most one, and `authMiddleware`'s five-step
   * header rule (IG §7.5) is what picks between them. `user-flows.md` §9.3
   * A-27 to A-31.
   */
  describe("multi-business membership", () => {
    it("a header naming a business the identity does not belong to → 404, never 403 (A-27)", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await request("/api/me", bearerFor(token, otherBusinessId));
      expect(res.status).toBe(404);

      await ctx.cleanup();
    });

    it("a valid token plus a header for business A cannot read business B, even with two real memberships (A-28)", async () => {
      const ctx = new TestContext(db);
      const businessA = await ctx.createBusiness({ name: "Business A" });
      const businessB = await ctx.createBusiness({ name: "Business B" });
      const owner = await mintUser(db, ctx, businessA, "owner");
      await addBusinessMembership(db, ctx, owner.userId, businessB, "manager");
      const token = await signAccessToken(owner.asgardeoSub);

      const resA = await request("/api/me", bearerFor(token, businessA));
      expect(resA.status).toBe(200);
      expect(await resA.json()).toMatchObject({ businessId: businessA, role: "owner" });

      const resB = await request("/api/me", bearerFor(token, businessB));
      expect(resB.status).toBe(200);
      expect(await resB.json()).toMatchObject({ businessId: businessB, role: "manager" });

      // Never a third value, and never the other business's role leaking
      // into this one's response — resolveMemberships' UNION ALL keeping
      // the two shapes apart, not the old or()-joined cross-product.
      const vehicleA = await ctx.createVehicle(businessA);
      const crossRes = await request(
        `/api/_probe/vehicle/${vehicleA}`,
        bearerFor(token, businessB),
      );
      expect(crossRes.status).toBe(404);

      await ctx.cleanup();
    });

    it("a header naming a business the identity was just revoked from → 404 (A-29)", async () => {
      const ctx = new TestContext(db);
      const businessA = await ctx.createBusiness({ name: "Business A" });
      const businessB = await ctx.createBusiness({ name: "Business B" });
      const owner = await mintUser(db, ctx, businessA, "owner");
      // B needs its own owner before anything can be revoked from it —
      // ctx.createBusiness() writes only the bare business row, and
      // assert_business_has_owner() (INV-31) fires on any UPDATE to
      // business_member, not only ones touching the last owner directly.
      await mintUser(db, ctx, businessB, "owner");
      const inB = await addBusinessMembership(db, ctx, owner.userId, businessB, "manager");
      const token = await signAccessToken(owner.asgardeoSub);

      // Revoke B's membership — business_member_active_pair (business_id,
      // user_id) is why this has to be a *different* business than A's:
      // two active rows for the same pair is exactly what that constraint
      // forbids, correctly, so a revoked-and-reinstated case in the same
      // business isn't representable this way.
      await db
        .update(businessMember)
        // eslint-disable-next-line no-restricted-syntax -- a fixture's own revocation timestamp, not a business date read
        .set({ revokedAt: new Date().toISOString() })
        .where(eq(businessMember.id, inB.memberId));

      // A is untouched and still reachable.
      const resA = await request("/api/me", bearerFor(token, businessA));
      expect(resA.status).toBe(200);
      expect(await resA.json()).toMatchObject({ businessId: businessA, role: "owner" });

      // B's row is revoked — indistinguishable from never having existed
      // (INV-39), even though the identity still has an active membership
      // elsewhere (so this isn't just falling through the empty-set case).
      const resB = await request("/api/me", bearerFor(token, businessB));
      expect(resB.status).toBe(404);

      await ctx.cleanup();
    });

    it("no header, two memberships → BUSINESS_NOT_SELECTED, never a guessed default (A-30)", async () => {
      const ctx = new TestContext(db);
      const businessA = await ctx.createBusiness({ name: "Business A" });
      const businessB = await ctx.createBusiness({ name: "Business B" });
      const owner = await mintUser(db, ctx, businessA, "owner");
      await addBusinessMembership(db, ctx, owner.userId, businessB, "manager");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await request("/api/me", bearer(token));
      expect(res.status).toBe(400);
      const body: { code: string } = await res.json();
      expect(body).toMatchObject({ code: "BUSINESS_NOT_SELECTED" });

      await ctx.cleanup();
    });

    it("a linked driver in two businesses reads only the selected one's driver row (A-31)", async () => {
      const ctx = new TestContext(db);
      const businessA = await ctx.createBusiness({ name: "Business A" });
      const businessB = await ctx.createBusiness({ name: "Business B" });
      const driverA = await ctx.createDriver(businessA, { name: "Driver in A" });
      const driverB = await ctx.createDriver(businessB, { name: "Driver in B" });
      const linked = await mintLinkedDriver(db, ctx, driverA);
      await linkExistingUserAsDriver(db, ctx, linked.userId, driverB);
      const token = await signAccessToken(linked.asgardeoSub);

      const resA = await request(`/api/_probe/driver/${driverA}`, bearerFor(token, businessA));
      expect(resA.status).toBe(200);

      // His own row in B is unreachable while A is selected — exactly as if
      // B did not exist, the same boundary W-49 draws within one business,
      // redrawn between businesses (INV-39).
      const crossRes = await request(`/api/_probe/driver/${driverB}`, bearerFor(token, businessA));
      expect(crossRes.status).toBe(404);

      // Switching which business is selected reaches his own row there too
      // — the boundary moves with the header, it does not just block B.
      const resB = await request(`/api/_probe/driver/${driverB}`, bearerFor(token, businessB));
      expect(resB.status).toBe(200);

      await ctx.cleanup();
    });

    it("owner also linked as a driver of the same business resolves as owner, not BUSINESS_NOT_SELECTED (gitar-bot PR #72)", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const owner = await mintUser(db, ctx, businessId, "owner");
      const driverId = await ctx.createDriver(businessId, { name: "Owner, also driving" });
      await linkExistingUserAsDriver(db, ctx, owner.userId, driverId);
      const token = await signAccessToken(owner.asgardeoSub);

      // resolveMemberships used to return two rows sharing this businessId
      // (one from business_member, one from driver.linked_user_id), which
      // the no-header branch counted as "more than one membership" and
      // refused with BUSINESS_NOT_SELECTED — even though there is only one
      // real business here.
      const noHeader = await request("/api/me", bearer(token));
      expect(noHeader.status).toBe(200);
      expect(await noHeader.json()).toMatchObject({ businessId, role: "owner" });

      // The header path must resolve the same way — deterministically the
      // member role, not whichever of the two UNION ALL rows happened to
      // come back first.
      const withHeader = await request("/api/me", bearerFor(token, businessId));
      expect(withHeader.status).toBe(200);
      expect(await withHeader.json()).toMatchObject({ businessId, role: "owner" });

      await ctx.cleanup();
    });
  });
});
