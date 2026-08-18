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

export type BusinessCreationRequestStatus = "pending" | "approved" | "rejected";

export interface NewBusinessCreationRequest {
  id: string;
  requestedBy: string;
  name: string;
  currencyCode: string;
  timezone: string;
}

/** No `status` column DEFAULT on the table (see migration 0030's own comment) — every request is born pending, named here rather than implicitly. */
export async function insertBusinessCreationRequest(
  db: Db,
  values: NewBusinessCreationRequest,
): Promise<void> {
  await db.insert(businessCreationRequest).values({ ...values, status: "pending" });
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
  status: BusinessCreationRequestStatus;
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
    status: r.status as BusinessCreationRequestStatus,
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
      status: BusinessCreationRequestStatus;
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
  return row ? { ...row, status: row.status as BusinessCreationRequestStatus } : undefined;
}

/**
 * Fixes a review finding on PR #73 (gitar-bot, 18 Aug 2026): the status
 * transition is the gate, not a pre-read `status !== "pending"` check —
 * `findRequestById` has no row lock, so two concurrent decide calls (or an
 * admin double-click; the route has no idempotency guard) could otherwise
 * both pass that check and both go on to create a business. Gating on this
 * conditional `UPDATE … WHERE status = 'pending'` means only one caller's
 * `.returning()` comes back non-empty — the loser gets `false` and throws
 * `RequestAlreadyDecidedError` before touching `createBusinessForUser`.
 * `business_id` is deliberately not set here: the business does not exist
 * yet at claim time (`setRequestApprovedBusiness` backfills it once
 * `createBusinessForUser` — its own top-level transaction, see setup.ts —
 * returns), so the narrow window between a won claim and that insert is a
 * request marked "approved" with no business yet, accepted the same way
 * the count-then-decide race in `requestOrCreateBusiness` above is: judged
 * cheaper than a distributed-transaction fix for a gap this narrow.
 */
export async function claimRequestForApproval(
  db: Db,
  id: string,
  decidedBy: string,
): Promise<boolean> {
  const claimed = await db
    .update(businessCreationRequest)
    .set({ status: "approved", decidedBy, decidedAt: sql`now()` })
    .where(and(eq(businessCreationRequest.id, id), eq(businessCreationRequest.status, "pending")))
    .returning({ id: businessCreationRequest.id });
  return claimed.length > 0;
}

/** The other half of `claimRequestForApproval` — runs once the business it names actually exists. */
export async function setRequestApprovedBusiness(
  db: Db,
  id: string,
  businessId: string,
): Promise<void> {
  await db
    .update(businessCreationRequest)
    .set({ businessId })
    .where(eq(businessCreationRequest.id, id));
}

/**
 * The same atomic-claim shape as `claimRequestForApproval`, for the sibling
 * function — rejection creates nothing, so there is no double-create risk,
 * but an unguarded `UPDATE` here still let a reject racing an approve (both
 * reading `status = "pending"` before either writes) leave the row saying
 * "rejected" *after* `approveRequest` had already created a business for
 * it — a real inconsistency of the same shape, fixed the same way.
 */
export async function claimRequestForRejection(
  db: Db,
  id: string,
  decidedBy: string,
  reason: string,
): Promise<boolean> {
  const claimed = await db
    .update(businessCreationRequest)
    .set({ status: "rejected", decidedBy, decidedAt: sql`now()`, rejectionReason: reason })
    .where(and(eq(businessCreationRequest.id, id), eq(businessCreationRequest.status, "pending")))
    .returning({ id: businessCreationRequest.id });
  return claimed.length > 0;
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
