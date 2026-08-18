import type { BusinessMemberRole } from "@fleetsettle/shared/schemas";
import { eq } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import {
  accountingPeriod,
  appUser,
  business,
  businessMember,
  businessSettings,
} from "../db/schema.js";

type Db = Writer | Tx;
type ReadDb = Reader | Writer | Tx;

export interface NewAppUser {
  id: string;
  asgardeoSub: string;
  email?: string;
  displayName?: string;
}

/** F-0.1: an authenticated `sub` may already have an `app_user` row from an earlier request. */
export async function findAppUserBySub(
  db: Db,
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
