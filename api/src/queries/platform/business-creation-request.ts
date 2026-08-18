import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../../db/client.js";
import {
  appUser,
  business,
  businessCreationRequest,
  businessMember,
  platformAuditLog,
} from "../../db/schema.js";

/**
 * IG §7.6: `queries/platform/` may never import money-table schema —
 * `check-forbidden.mjs` enforces it. `business_creation_request` carries no
 * money (§14 of the design doc), so this file is safe by construction, not
 * by care.
 */

type Db = Writer | Tx;
type ReadDb = Reader | Writer | Tx;

export interface NewBusinessCreationRequest {
  id: string;
  requestedBy: string;
  name: string;
  currencyCode: string;
  timezone: string;
}

export async function insertBusinessCreationRequest(
  db: Db,
  values: NewBusinessCreationRequest,
): Promise<void> {
  await db.insert(businessCreationRequest).values(values);
}

/** INV-41's own read side — whether `userId` already has a request outstanding, for the "pending requester may not queue a second" refusal. */
export async function findPendingRequestByUser(
  db: ReadDb,
  userId: string,
): Promise<{ id: string } | undefined> {
  const rows = await db
    .select({ id: businessCreationRequest.id })
    .from(businessCreationRequest)
    .where(
      and(
        eq(businessCreationRequest.requestedBy, userId),
        eq(businessCreationRequest.status, "pending"),
      ),
    )
    .limit(1);
  return rows[0];
}

/** Decision 17/§7.1: the requester's own most recent pending or rejected request, for `/api/session`'s `pendingRequest` field. Approved requests are not returned here — once approved, the business itself is the record; the request row's job is done. */
export async function findOwnOutstandingRequest(
  db: ReadDb,
  userId: string,
): Promise<{ status: "pending" | "rejected"; rejectionReason: string | null } | undefined> {
  const rows = await db
    .select({
      status: businessCreationRequest.status,
      rejectionReason: businessCreationRequest.rejectionReason,
      createdAt: businessCreationRequest.createdAt,
    })
    .from(businessCreationRequest)
    .where(eq(businessCreationRequest.requestedBy, userId))
    .orderBy(desc(businessCreationRequest.createdAt))
    .limit(1);
  // pending OR rejected — an approved row has nothing left to report; the
  // business it created is the record from that point on.
  const row = rows[0];
  if (!row || row.status === "approved") return undefined;
  return { status: row.status as "pending" | "rejected", rejectionReason: row.rejectionReason };
}

export interface RequesterView {
  id: string;
  requestedBy: string;
  requesterName: string;
  requesterEmail: string | null;
  name: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  decidedAt: string | null;
  rejectionReason: string | null;
  /**
   * `null` for a still-pending request — self-action only has a truth once
   * a decision exists (`platform_audit_log`'s own `self_action`, written at
   * decision time by `approveRequest`/`rejectRequest`). The handler layer
   * computes a live "would this be self-approval" for pending rows by
   * comparing `requestedBy` against the viewing admin — a different
   * question this field deliberately doesn't answer, since the row itself
   * has no decision to be self or otherwise about yet.
   */
  decidedSelfAction: boolean | null;
}

/** F-11.1: the admin's queue — requester name/email, never anything from inside a business (INV-38). Every status, newest first; the admin panel filters client-side for "pending" vs the full log. */
export async function listRequests(db: ReadDb): Promise<RequesterView[]> {
  const rows = await db
    .select({
      id: businessCreationRequest.id,
      requestedBy: businessCreationRequest.requestedBy,
      requesterName: appUser.displayName,
      requesterEmail: appUser.email,
      name: businessCreationRequest.name,
      status: businessCreationRequest.status,
      createdAt: businessCreationRequest.createdAt,
      decidedAt: businessCreationRequest.decidedAt,
      rejectionReason: businessCreationRequest.rejectionReason,
      decidedSelfAction: platformAuditLog.selfAction,
    })
    .from(businessCreationRequest)
    .innerJoin(appUser, eq(appUser.id, businessCreationRequest.requestedBy))
    .leftJoin(
      platformAuditLog,
      and(
        eq(platformAuditLog.subjectId, businessCreationRequest.id),
        inArray(platformAuditLog.action, ["request_approved", "request_rejected"]),
      ),
    )
    .orderBy(desc(businessCreationRequest.createdAt));

  return rows.map((r) => ({
    ...r,
    requesterName: r.requesterName ?? "Unnamed user",
    status: r.status as "pending" | "approved" | "rejected",
    decidedSelfAction: r.decidedSelfAction ?? null,
  }));
}

export async function findRequestById(
  db: ReadDb,
  id: string,
): Promise<
  | {
      id: string;
      requestedBy: string;
      name: string;
      currencyCode: string;
      timezone: string;
      status: "pending" | "approved" | "rejected";
    }
  | undefined
> {
  const rows = await db
    .select({
      id: businessCreationRequest.id,
      requestedBy: businessCreationRequest.requestedBy,
      name: businessCreationRequest.name,
      currencyCode: businessCreationRequest.currencyCode,
      timezone: businessCreationRequest.timezone,
      status: businessCreationRequest.status,
    })
    .from(businessCreationRequest)
    .where(eq(businessCreationRequest.id, id))
    .limit(1);
  const row = rows[0];
  return row ? { ...row, status: row.status as "pending" | "approved" | "rejected" } : undefined;
}

export async function markRequestApproved(
  db: Db,
  id: string,
  decidedBy: string,
  businessId: string,
): Promise<void> {
  await db
    .update(businessCreationRequest)
    .set({ status: "approved", decidedBy, decidedAt: sql`now()`, businessId })
    .where(eq(businessCreationRequest.id, id));
}

export async function markRequestRejected(
  db: Db,
  id: string,
  decidedBy: string,
  reason: string,
): Promise<void> {
  await db
    .update(businessCreationRequest)
    .set({
      status: "rejected",
      decidedBy,
      decidedAt: sql`now()`,
      rejectionReason: reason,
    })
    .where(eq(businessCreationRequest.id, id));
}

/** F-11.1's own boundary check: every business a platform admin may list — name, created, member count. Never a balance, a report, or a query touching a money table (INV-38). */
export async function listBusinessesForAdmin(
  db: ReadDb,
): Promise<{ id: string; name: string; createdAt: string; memberCount: number }[]> {
  const rows = await db
    .select({
      id: business.id,
      name: business.name,
      createdAt: business.createdAt,
      memberId: businessMember.id,
      revokedAt: businessMember.revokedAt,
    })
    .from(business)
    .leftJoin(businessMember, eq(businessMember.businessId, business.id));

  const byBusiness = new Map<
    string,
    { id: string; name: string; createdAt: string; memberCount: number }
  >();
  for (const row of rows) {
    const existing = byBusiness.get(row.id) ?? {
      id: row.id,
      name: row.name,
      createdAt: row.createdAt,
      memberCount: 0,
    };
    if (row.memberId && !row.revokedAt) existing.memberCount += 1;
    byBusiness.set(row.id, existing);
  }
  return [...byBusiness.values()];
}
