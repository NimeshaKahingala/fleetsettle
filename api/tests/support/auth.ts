import { newId } from "@fleetsettle/shared";
import { eq, sql } from "drizzle-orm";
import { SignJWT } from "jose";
import type { Writer } from "../../src/db/client.js";
import {
  appUser,
  businessMember,
  driver as driverTable,
  platformAdmin,
} from "../../src/db/schema.js";
import { TEST_ENV } from "./env.js";
import type { TestContext } from "./factories.js";
import { TEST_ALG, TEST_KID, TEST_SIGNING_KEY } from "./jwks.js";

/** The W-49 roles a `business_member` row can hold. */
export type Role = "owner" | "owner_manager" | "manager";

/**
 * A real access token for `sub`, signed by the test keypair (support/jwks.ts)
 * and shaped like Asgardeo's: same issuer/audience `auth/verify.ts` checks,
 * same header `kid`. `auth/verify.ts` is not mocked — only the IdP is.
 */
export async function signAccessToken(
  sub: string,
  overrides: { issuer?: string; audience?: string; expiresIn?: string } = {},
): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: TEST_ALG, kid: TEST_KID })
    .setSubject(sub)
    .setIssuer(overrides.issuer ?? TEST_ENV.ASGARDEO_ISSUER)
    .setAudience(overrides.audience ?? TEST_ENV.ASGARDEO_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(overrides.expiresIn ?? "1h")
    .sign(TEST_SIGNING_KEY);
}

/**
 * Mints a real `app_user` + `business_member` row in the given role, tracked
 * on the same `TestContext` used for the rest of the fixture so `cleanup()`
 * unwinds it too.
 *
 * The `app_user` row itself is deliberately never torn down. Once this user
 * makes any real write, `withActor` (db/client.ts) attributes it to them in
 * `audit_log.changed_by` — and `audit_log` carries its own `DO INSTEAD
 * NOTHING` rules on UPDATE and DELETE (migration 0001, W-50/INV-28: the
 * trail is tamper-proof at the database level, not by convention). A `DELETE
 * FROM audit_log` silently does nothing, so `app_user` — FK-referenced from
 * a row that can never be removed — becomes permanent from that moment on.
 * This is correct, not a leak to route around: it is the same reason
 * production never deletes an `app_user` either (only `business_member` is
 * revoked). Left in the disposable test branch (IG §8.3), same as the
 * `audit_log` rows themselves.
 */
export async function mintUser(
  db: Writer,
  ctx: TestContext,
  businessId: string,
  role: Role,
): Promise<{ userId: string; asgardeoSub: string }> {
  const userId = newId();
  const asgardeoSub = `test-sub-${userId}`;
  await db.insert(appUser).values({ id: userId, asgardeoSub, displayName: `Test ${role}` });

  const memberId = newId();
  await db.insert(businessMember).values({ id: memberId, businessId, userId, role });
  ctx.track(async () => {
    await db.delete(businessMember).where(eq(businessMember.id, memberId));
  });

  return { userId, asgardeoSub };
}

/**
 * Adds a second (or further) `business_member` row to an **existing**
 * `app_user`, unlike `mintUser` which always inserts a fresh identity.
 * Phase 1 (18 Aug 2026, W-66): the fixture multi-business tests need — "a
 * user in two businesses gets 404 for a third" and its siblings — cannot be
 * built without a way to give one identity a second membership, and nothing
 * in this file did that before now.
 */
export async function addBusinessMembership(
  db: Writer,
  ctx: TestContext,
  userId: string,
  businessId: string,
  role: Role,
): Promise<{ memberId: string }> {
  const memberId = newId();
  await db.insert(businessMember).values({ id: memberId, businessId, userId, role });
  ctx.track(async () => {
    await db.delete(businessMember).where(eq(businessMember.id, memberId));
  });

  return { memberId };
}

/**
 * Tracks cleanup for a `business_member` row this test didn't create through
 * a factory helper — one written by the real endpoint under test (a live
 * invite redemption, say), where nothing else would otherwise unwind it.
 * Registered here, in the file the `no-restricted-syntax`/append-only guard
 * already exempts for teardown deletes, rather than adding a first inline
 * disable inside a test file for a case the guard's own precedent already
 * has a home for.
 */
export function trackBusinessMemberRow(db: Writer, ctx: TestContext, memberId: string): void {
  ctx.track(async () => {
    await db.delete(businessMember).where(eq(businessMember.id, memberId));
  });
}

/**
 * Links an existing driver row to a fresh `app_user` (W-13) — the read-only,
 * own-data-only boundary (INV-25/W-49) that every driver-facing endpoint's
 * test class must cover.
 */
export async function mintLinkedDriver(
  db: Writer,
  ctx: TestContext,
  driverId: string,
): Promise<{ userId: string; asgardeoSub: string }> {
  const userId = newId();
  const asgardeoSub = `test-sub-driver-${userId}`;
  // `app_user` is never torn down here either — see `mintUser`'s own comment.
  await db.insert(appUser).values({ id: userId, asgardeoSub, displayName: "Test Linked Driver" });

  await db.update(driverTable).set({ linkedUserId: userId }).where(eq(driverTable.id, driverId));
  ctx.track(async () => {
    await db.update(driverTable).set({ linkedUserId: null }).where(eq(driverTable.id, driverId));
  });

  return { userId, asgardeoSub };
}

/**
 * `mintLinkedDriver`'s counterpart for an **existing** identity — Phase 1's
 * own cross-business test ("a linked driver in two businesses reads only
 * the selected one's driver row") needs the same identity linked as a
 * driver in a *second* business, not a fresh one. `driver_linked_user_per_business`
 * (migration 0029) is what makes this legal at all.
 */
export async function linkExistingUserAsDriver(
  db: Writer,
  ctx: TestContext,
  userId: string,
  driverId: string,
): Promise<void> {
  await db.update(driverTable).set({ linkedUserId: userId }).where(eq(driverTable.id, driverId));
  ctx.track(async () => {
    await db.update(driverTable).set({ linkedUserId: null }).where(eq(driverTable.id, driverId));
  });
}

/**
 * Phase 2: mints a fresh `app_user` with active `platform_admin` status —
 * `mintUser`'s counterpart one tier up. No `business_member` row at all,
 * deliberately (design §1.1/W-65's "not a business role") — a test that
 * needs an admin who is *also* a business member composes this with
 * `addBusinessMembership` explicitly, rather than this helper assuming one.
 */
export async function mintPlatformAdmin(
  db: Writer,
  ctx: TestContext,
): Promise<{ userId: string; asgardeoSub: string }> {
  const userId = newId();
  const asgardeoSub = `test-sub-admin-${userId}`;
  await db.insert(appUser).values({ id: userId, asgardeoSub, displayName: "Test Platform Admin" });

  // platform_admin_audit (migration 0030) writes platform_audit_log.actor_id
  // NOT NULL from audit_actor(), which reads fleetsettle.actor_id — nothing
  // sets that outside a real request's withActor() wrapper, so a bare
  // INSERT here 500s on the trigger's own constraint. Same shape as the
  // live bootstrap (design §5): the very first admin grants themselves,
  // self-scoped, inside one transaction so set_config's session-local
  // value is visible to the trigger firing on the insert that follows it.
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('fleetsettle.actor_id', ${userId}, true)`);
    await tx.insert(platformAdmin).values({ userId, grantedBy: null });
  });
  ctx.track(async () => {
    await db.delete(platformAdmin).where(eq(platformAdmin.userId, userId));
  });

  return { userId, asgardeoSub };
}
