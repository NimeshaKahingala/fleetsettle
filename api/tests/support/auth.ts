import { newId } from "@fleetsettle/shared";
import { SignJWT } from "jose";
import type { Writer } from "../../src/db/client.js";
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
  await db.query(`INSERT INTO app_user (id, asgardeo_sub, display_name) VALUES ($1, $2, $3)`, [
    userId,
    asgardeoSub,
    `Test ${role}`,
  ]);
  ctx.track(async () => {
    await db.query(`DELETE FROM app_user WHERE id = $1`, [userId]);
  });

  const memberId = newId();
  await db.query(
    `INSERT INTO business_member (id, business_id, user_id, role) VALUES ($1, $2, $3, $4)`,
    [memberId, businessId, userId, role],
  );
  ctx.track(async () => {
    await db.query(`DELETE FROM business_member WHERE id = $1`, [memberId]);
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
  await db.query(`INSERT INTO app_user (id, asgardeo_sub, display_name) VALUES ($1, $2, $3)`, [
    userId,
    asgardeoSub,
    "Test Linked Driver",
  ]);
  ctx.track(async () => {
    await db.query(`DELETE FROM app_user WHERE id = $1`, [userId]);
  });

  await db.query(`UPDATE driver SET linked_user_id = $1 WHERE id = $2`, [userId, driverId]);
  ctx.track(async () => {
    await db.query(`UPDATE driver SET linked_user_id = NULL WHERE id = $1`, [driverId]);
  });

  return { userId, asgardeoSub };
}
