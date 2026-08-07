import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Tx, Writer } from "../db/client.js";
import { driverLinkInvite } from "../db/schema.js";

type WriteDb = Writer | Tx;

export interface NewDriverLinkInvite {
  id: string;
  driverId: string;
  codeHash: string;
  createdBy: string;
  expiresAt: string;
}

export async function insertDriverLinkInvite(
  db: WriteDb,
  values: NewDriverLinkInvite,
): Promise<void> {
  await db.insert(driverLinkInvite).values(values);
}

/** F-1.8's own alternate, the same shape F-1.4's reissue uses (W-57: one mechanism, two destinations). */
export async function expireUnredeemedDriverLinkInvites(
  db: WriteDb,
  driverId: string,
): Promise<void> {
  await db
    .update(driverLinkInvite)
    .set({ expiresAt: sql`now()` })
    .where(
      and(
        eq(driverLinkInvite.driverId, driverId),
        isNull(driverLinkInvite.consumedAt),
        gt(driverLinkInvite.expiresAt, sql`now()`),
      ),
    );
}

export interface ActiveDriverLinkInvite {
  id: string;
  driverId: string;
}

/** W-42: the redeem endpoint's second lookup, tried once `business_member_invite` has no match. */
export async function findActiveDriverLinkInviteByCodeHash(
  db: WriteDb,
  codeHash: string,
): Promise<ActiveDriverLinkInvite | undefined> {
  const rows = await db
    .select({ id: driverLinkInvite.id, driverId: driverLinkInvite.driverId })
    .from(driverLinkInvite)
    .where(
      and(
        eq(driverLinkInvite.codeHash, codeHash),
        isNull(driverLinkInvite.consumedAt),
        gt(driverLinkInvite.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  return rows[0];
}

/** Guarded on `consumed_at IS NULL`, the same race-safe shape as `consumeBusinessMemberInvite`. */
export async function consumeDriverLinkInvite(
  db: WriteDb,
  id: string,
  consumedBy: string,
): Promise<boolean> {
  const rows = await db
    .update(driverLinkInvite)
    .set({ consumedAt: sql`now()`, consumedBy })
    .where(and(eq(driverLinkInvite.id, id), isNull(driverLinkInvite.consumedAt)))
    .returning({ id: driverLinkInvite.id });
  return rows.length > 0;
}
