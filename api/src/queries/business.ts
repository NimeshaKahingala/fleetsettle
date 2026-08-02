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
  role: "owner";
}

/** DM §3's `one_active_business_per_user` index is the truth on the "exactly one owner" rule (F-0.1) — this insert is what can violate it, never a pre-check. */
export async function insertBusinessMember(db: Db, values: NewBusinessMember): Promise<void> {
  await db.insert(businessMember).values(values);
}

/** No fields beyond `businessId` — DM §3's column defaults are F-0.1's "defaults applied" row (zero auto-waive, 08:00–20:00, 30-day paperwork warning). */
export async function insertBusinessSettings(db: Db, businessId: string): Promise<void> {
  await db.insert(businessSettings).values({ businessId });
}

/** OQ-3: a blank threshold means zero (waive nothing), never unbounded — `businessSettings.autoWaiveThresholdMinor` defaults to `0n`, never null. `paperworkWarnDays` is UC-92's own warning window (default 30, DM §3). */
export async function findBusinessSettings(
  db: ReadDb,
  businessId: string,
): Promise<{ autoWaiveThresholdMinor: bigint; paperworkWarnDays: number } | undefined> {
  const rows = await db
    .select({
      autoWaiveThresholdMinor: businessSettings.autoWaiveThresholdMinor,
      paperworkWarnDays: businessSettings.paperworkWarnDays,
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
