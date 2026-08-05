import { and, eq, isNull } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import { appUser, businessMember } from "../db/schema.js";

type ReadDb = Reader | Writer | Tx;

export interface BusinessMemberRow {
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
      userId: businessMember.userId,
      displayName: appUser.displayName,
      role: businessMember.role,
    })
    .from(businessMember)
    .innerJoin(appUser, eq(appUser.id, businessMember.userId))
    .where(and(eq(businessMember.businessId, businessId), isNull(businessMember.revokedAt)))
    .orderBy(businessMember.grantedAt);
}
