import type { BusinessMemberRole } from "@fleetsettle/shared/schemas";
import { and, count, eq, inArray, isNull } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import {
  accountingPeriod,
  appUser,
  business,
  businessMember,
  businessSettings,
  driver,
} from "../db/schema.js";

type Db = Writer | Tx;
type ReadDb = Reader | Writer | Tx;

export interface NewAppUser {
  id: string;
  asgardeoSub: string;
  email?: string;
  displayName?: string;
}

/**
 * F-0.1: an authenticated `sub` may already have an `app_user` row from an
 * earlier request. `ReadDb`, not `Db` — a plain SELECT, safe for a `reader`
 * call too (IG §7.6's `platformAdminMiddleware` is the first caller that
 * needs it outside a transaction).
 */
export async function findAppUserBySub(
  db: ReadDb,
  asgardeoSub: string,
): Promise<{ id: string } | undefined> {
  const rows = await db
    .select({ id: appUser.id })
    .from(appUser)
    .where(eq(appUser.asgardeoSub, asgardeoSub))
    .limit(1);
  return rows[0];
}

export async function insertAppUser(db: Db, values: NewAppUser): Promise<void> {
  await db.insert(appUser).values(values);
}

export interface NewBusiness {
  id: string;
  name: string;
  currencyCode: string;
  timezone: string;
}

export async function insertBusiness(db: Db, values: NewBusiness): Promise<void> {
  await db.insert(business).values(values);
}

export interface NewBusinessMember {
  id: string;
  businessId: string;
  userId: string;
  /**
   * The membership roles DM §3's CHECK constraint allows, which is exactly
   * what `businessMemberRoleSchema` already enumerates — `driver` is not one
   * of them, because a driver is reached through `driver.linked_user_id` and
   * never holds a `business_member` row.
   *
   * This was the literal `"owner"` until A0 changed the one call site to
   * `owner_manager` and left the type behind, so `npm run typecheck` has been
   * failing on `domain/setup.ts` ever since — the second time a commit has
   * shipped with a broken typecheck (TRACKER §5 records the first). Narrowing
   * a field to the single value its only caller happened to pass is what
   * turned a one-word fix into a type error.
   */
  role: BusinessMemberRole;
}

/** `business_member_active_pair` (DM §3) is the truth on "not the same business twice" — this insert is what can violate it, never a pre-check. `one_active_business_per_user`, the index this comment used to cite, was dropped in migration 0029 (W-63 to W-67, 18 Aug 2026). */
export async function insertBusinessMember(db: Db, values: NewBusinessMember): Promise<void> {
  await db.insert(businessMember).values(values);
}

/** No fields beyond `businessId` — DM §3's column defaults are F-0.1's "defaults applied" row (zero auto-waive, 08:00–20:00, 30-day paperwork warning). */
export async function insertBusinessSettings(db: Db, businessId: string): Promise<void> {
  await db.insert(businessSettings).values({ businessId });
}

/** OQ-3: a blank threshold means zero (waive nothing), never unbounded — `businessSettings.autoWaiveThresholdMinor` defaults to `0n`, never null. `paperworkWarnDays` is UC-92's own warning window (default 30); `depositHoldDays` is W-29's (default 30, DM §3); `holdExpiryDays` is ST-5/GAP-7's (default 7, migration 0020). */
export async function findBusinessSettings(
  db: ReadDb,
  businessId: string,
): Promise<
  | {
      autoWaiveThresholdMinor: bigint;
      paperworkWarnDays: number;
      depositHoldDays: number;
      holdExpiryDays: number;
    }
  | undefined
> {
  const rows = await db
    .select({
      autoWaiveThresholdMinor: businessSettings.autoWaiveThresholdMinor,
      paperworkWarnDays: businessSettings.paperworkWarnDays,
      depositHoldDays: businessSettings.depositHoldDays,
      holdExpiryDays: businessSettings.holdExpiryDays,
    })
    .from(businessSettings)
    .where(eq(businessSettings.businessId, businessId))
    .limit(1);
  return rows[0];
}

export interface NewAccountingPeriod {
  id: string;
  businessId: string;
  periodStart: string;
  periodEnd: string;
}

export async function insertAccountingPeriod(db: Db, values: NewAccountingPeriod): Promise<void> {
  await db.insert(accountingPeriod).values({ ...values, status: "open" });
}

/**
 * W-64, Phase 2: counts businesses where `userId` currently holds an active
 * `owner`/`owner_manager` membership — never businesses ever created, so
 * leaving one frees a slot rather than permanently consuming it (design
 * §7.4). `manager` doesn't count: a manager did not create the business and
 * gains no allowance headroom from it. Read-then-decide, not a constraint —
 * decision 20 accepts the resulting check-then-act race as a known,
 * low-probability gap rather than adding SERIALIZABLE isolation for it,
 * given this product's actual concurrency (one or two people). Recorded
 * here, not silently: a fix would wrap the count and the insert in one
 * SERIALIZABLE transaction, catching and retrying a 40001 on the loser.
 */
export async function countActiveOwnerMemberships(db: ReadDb, userId: string): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(businessMember)
    .where(
      and(
        eq(businessMember.userId, userId),
        inArray(businessMember.role, ["owner", "owner_manager"]),
        isNull(businessMember.revokedAt),
      ),
    );
  // COUNT(*) with no GROUP BY always returns exactly one row — this is a
  // defensive fallback for TypeScript's array-index typing, not a report
  // figure defaulting to zero (W-56 governs numbers shown to a user; this
  // is an internal threshold check).
  // eslint-disable-next-line no-restricted-syntax -- see comment above
  return rows[0]?.n ?? 0;
}

export async function findAppUserById(
  db: ReadDb,
  userId: string,
): Promise<
  | {
      id: string;
      email: string | null;
      displayName: string | null;
      businessAllowance: number;
    }
  | undefined
> {
  const rows = await db
    .select({
      id: appUser.id,
      email: appUser.email,
      displayName: appUser.displayName,
      businessAllowance: appUser.businessAllowance,
    })
    .from(appUser)
    .where(eq(appUser.id, userId))
    .limit(1);
  return rows[0];
}

/** Decision 22, Phase 2: an admin's own set-allowance write — the column DEFAULT (5) reproduces decision 4's original constant exactly, so this is the only place a non-default value is ever written. */
export async function updateBusinessAllowance(
  db: Db,
  userId: string,
  businessAllowance: number,
): Promise<void> {
  await db.update(appUser).set({ businessAllowance }).where(eq(appUser.id, userId));
}

/**
 * Decision 26: distinguishes a user revoked from their only membership
 * (`businesses: []` on `/api/session`, but a `business_member` row existed
 * once) from a first-time signup (never had one). Includes driver links
 * too — a driver unlinked from their only business is the same case one
 * level down. Both counted regardless of revoked_at, deliberately: this
 * asks "did this identity ever have access," not "does it now."
 */
export async function hadAnyMembership(db: ReadDb, userId: string): Promise<boolean> {
  const memberRows = await db
    .select({ id: businessMember.id })
    .from(businessMember)
    .where(eq(businessMember.userId, userId))
    .limit(1);
  if (memberRows.length > 0) return true;

  const driverRows = await db
    .select({ id: driver.id })
    .from(driver)
    .where(eq(driver.linkedUserId, userId))
    .limit(1);
  return driverRows.length > 0;
}
