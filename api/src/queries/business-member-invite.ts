import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Tx, Writer } from "../db/client.js";
import { businessMemberInvite } from "../db/schema.js";

type WriteDb = Writer | Tx;

export interface NewBusinessMemberInvite {
  id: string;
  businessId: string;
  role: string;
  codeHash: string;
  createdBy: string;
  expiresAt: string;
}

export async function insertBusinessMemberInvite(
  db: WriteDb,
  values: NewBusinessMemberInvite,
): Promise<void> {
  await db.insert(businessMemberInvite).values(values);
}

/** F-1.4's own alternate: "a code not yet redeemed can be reissued, which invalidates the old one." Expiring rather than deleting keeps the row as history, the same append-only shape money records use (W-50), even though this is not one. */
export async function expireUnredeemedBusinessMemberInvites(
  db: WriteDb,
  businessId: string,
  role: string,
): Promise<void> {
  await db
    .update(businessMemberInvite)
    .set({ expiresAt: sql`now()` })
    .where(
      and(
        eq(businessMemberInvite.businessId, businessId),
        eq(businessMemberInvite.role, role),
        isNull(businessMemberInvite.consumedAt),
        gt(businessMemberInvite.expiresAt, sql`now()`),
      ),
    );
}

export interface ActiveBusinessMemberInvite {
  id: string;
  businessId: string;
  role: string;
}

/** W-57: the redeem endpoint's first lookup — code_hash alone, since the caller is not authenticated into any business yet. */
export async function findActiveBusinessMemberInviteByCodeHash(
  db: WriteDb,
  codeHash: string,
): Promise<ActiveBusinessMemberInvite | undefined> {
  const rows = await db
    .select({
      id: businessMemberInvite.id,
      businessId: businessMemberInvite.businessId,
      role: businessMemberInvite.role,
    })
    .from(businessMemberInvite)
    .where(
      and(
        eq(businessMemberInvite.codeHash, codeHash),
        isNull(businessMemberInvite.consumedAt),
        gt(businessMemberInvite.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  return rows[0];
}

/**
 * Guarded on `consumed_at IS NULL` in the `WHERE` clause, not a read-then-
 * write — the same shape `confirmOpenDayRecord` uses for a placeholder row
 * (TRACKER §5): two racing redemptions of the same code leave the loser's
 * `UPDATE` affecting 0 rows, read back here as "already consumed" rather
 * than a thrown constraint violation.
 */
export async function consumeBusinessMemberInvite(
  db: WriteDb,
  id: string,
  consumedBy: string,
): Promise<boolean> {
  const rows = await db
    .update(businessMemberInvite)
    .set({ consumedAt: sql`now()`, consumedBy })
    .where(and(eq(businessMemberInvite.id, id), isNull(businessMemberInvite.consumedAt)))
    .returning({ id: businessMemberInvite.id });
  return rows.length > 0;
}
