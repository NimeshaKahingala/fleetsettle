import { newId } from "@fleetsettle/shared";
import { eq } from "drizzle-orm";
import { SignJWT } from "jose";
import type { Writer } from "../../src/db/client.js";
import { appUser, businessMember, driver as driverTable } from "../../src/db/schema.js";
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
  ctx.track(async () => {
    await db.delete(appUser).where(eq(appUser.id, userId));
  });

  const memberId = newId();
  await db.insert(businessMember).values({ id: memberId, businessId, userId, role });
  ctx.track(async () => {
    await db.delete(businessMember).where(eq(businessMember.id, memberId));
  });

  return { userId, asgardeoSub };
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
  await db.insert(appUser).values({ id: userId, asgardeoSub, displayName: "Test Linked Driver" });
  ctx.track(async () => {
    await db.delete(appUser).where(eq(appUser.id, userId));
  });

  await db.update(driverTable).set({ linkedUserId: userId }).where(eq(driverTable.id, driverId));
  ctx.track(async () => {
    await db.update(driverTable).set({ linkedUserId: null }).where(eq(driverTable.id, driverId));
  });

  return { userId, asgardeoSub };
}
