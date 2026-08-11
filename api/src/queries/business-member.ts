import { and, eq, isNull, sql } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import { appUser, businessMember } from "../db/schema.js";

type ReadDb = Reader | Writer | Tx;
type WriteDb = Writer | Tx;

export interface BusinessMemberRow {
  id: string;
  userId: string;
  displayName: string | null;
  role: string;
}

/** GAP-31: active members only — a revoked `business_member` is not someone paid-by can still name (F-1.4's own "revoke" is the model this borrows: the record stays, the picker does not offer it). */
export async function listBusinessMembersForBusiness(
  db: ReadDb,
  businessId: string,
): Promise<BusinessMemberRow[]> {
  return db
    .select({
      id: businessMember.id,
      userId: businessMember.userId,
      displayName: appUser.displayName,
      role: businessMember.role,
    })
    .from(businessMember)
    .innerJoin(appUser, eq(appUser.id, businessMember.userId))
    .where(and(eq(businessMember.businessId, businessId), isNull(businessMember.revokedAt)))
    .orderBy(businessMember.grantedAt);
}

export interface ActiveBusinessMemberRow {
  id: string;
  userId: string;
  role: string;
}

/** A11: scoped by `businessId` — the same cross-tenant shape every lookup-by-id gets (CLAUDE.md → Tenancy). Active only: a revoked row is not a target for revoke or role-change, it is history. */
export async function findActiveBusinessMemberForBusiness(
  db: ReadDb,
  businessId: string,
  memberId: string,
): Promise<ActiveBusinessMemberRow | undefined> {
  const rows = await db
    .select({ id: businessMember.id, userId: businessMember.userId, role: businessMember.role })
    .from(businessMember)
    .where(
      and(
        eq(businessMember.id, memberId),
        eq(businessMember.businessId, businessId),
        isNull(businessMember.revokedAt),
      ),
    )
    .limit(1);
  return rows[0];
}

/**
 * A11/GAP-43: guarded on `revoked_at IS NULL` in the `WHERE` clause itself,
 * never a read-then-write — two concurrent revokes of the same row leave the
 * loser's `UPDATE` affecting 0 rows rather than double-writing `revoked_at`.
 * `assert_business_has_owner()` (migration 0010, INV-31) is what actually
 * refuses to leave a business without an owner; this query does not
 * pre-check that, for the same reason `assert_period_open()` is never
 * pre-checked (CLAUDE.md → Writes).
 */
export async function revokeBusinessMember(
  db: WriteDb,
  memberId: string,
): Promise<{ revokedAt: string } | undefined> {
  const rows = await db
    .update(businessMember)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(businessMember.id, memberId), isNull(businessMember.revokedAt)))
    .returning({ revokedAt: businessMember.revokedAt });
  return rows[0] as { revokedAt: string } | undefined;
}
