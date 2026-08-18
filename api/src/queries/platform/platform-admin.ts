import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../../db/client.js";
import { appUser, businessMember, platformAdmin, platformAuditLog } from "../../db/schema.js";

type Db = Writer | Tx;
type ReadDb = Reader | Writer | Tx;

/** W-65: whether `userId` currently holds active platform-admin status. */
export async function findActivePlatformAdmin(
  db: ReadDb,
  userId: string,
): Promise<{ userId: string } | undefined> {
  const rows = await db
    .select({ userId: platformAdmin.userId })
    .from(platformAdmin)
    .where(and(eq(platformAdmin.userId, userId), isNull(platformAdmin.revokedAt)))
    .limit(1);
  return rows[0];
}

/** INV-40's own read side, for a pre-check the domain layer uses only to give a clean refusal — `assert_platform_has_admin()` (migration 0030) is the actual truth. */
export async function countActivePlatformAdmins(db: ReadDb): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(platformAdmin)
    .where(isNull(platformAdmin.revokedAt));
  // COUNT(*) with no GROUP BY always returns exactly one row — a defensive
  // fallback for TypeScript's typing, not a report figure defaulting to
  // zero (W-56 governs numbers shown to a user; this is an internal check).
  // eslint-disable-next-line no-restricted-syntax -- see comment above
  return rows[0]?.n ?? 0;
}

/**
 * `platform_admin`'s PK is `user_id` itself (no surrogate — DM §3.2), so a
 * re-grant after a revoke is an UPSERT, never a second row. `platform_admin_audit`
 * (migration 0030) writes the log entry; this function's own job ends at the row.
 */
export async function upsertPlatformAdmin(
  db: Db,
  userId: string,
  grantedBy: string,
): Promise<void> {
  await db
    .insert(platformAdmin)
    .values({ userId, grantedBy, revokedAt: null })
    .onConflictDoUpdate({
      target: platformAdmin.userId,
      set: { grantedBy, grantedAt: sql`now()`, revokedAt: null },
    });
}

export async function revokePlatformAdmin(db: Db, userId: string): Promise<void> {
  await db
    .update(platformAdmin)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(platformAdmin.userId, userId), isNull(platformAdmin.revokedAt)));
}

export async function listPlatformAdmins(
  db: ReadDb,
): Promise<
  { userId: string; email: string | null; displayName: string | null; grantedAt: string }[]
> {
  return db
    .select({
      userId: platformAdmin.userId,
      email: appUser.email,
      displayName: appUser.displayName,
      grantedAt: platformAdmin.grantedAt,
    })
    .from(platformAdmin)
    .innerJoin(appUser, eq(appUser.id, platformAdmin.userId))
    .where(isNull(platformAdmin.revokedAt))
    .orderBy(desc(platformAdmin.grantedAt));
}

export interface PlatformAuditRow {
  id: string;
  action: string;
  subjectId: string;
  actorId: string;
  actorName: string;
  selfAction: boolean;
  createdAt: string;
}

/** F-11.2/W-67: the platform's own log, readable by any admin. Never `audit_log` — that is tenant-scoped and not the platform's (§14). */
export async function listPlatformAuditLog(db: ReadDb): Promise<PlatformAuditRow[]> {
  const rows = await db
    .select({
      id: platformAuditLog.id,
      action: platformAuditLog.action,
      subjectId: platformAuditLog.subjectId,
      actorId: platformAuditLog.actorId,
      actorName: appUser.displayName,
      actorEmail: appUser.email,
      selfAction: platformAuditLog.selfAction,
      createdAt: platformAuditLog.createdAt,
    })
    .from(platformAuditLog)
    .innerJoin(appUser, eq(appUser.id, platformAuditLog.actorId))
    .orderBy(desc(platformAuditLog.createdAt));

  return rows.map((r) => ({
    id: r.id.toString(),
    action: r.action,
    subjectId: r.subjectId,
    actorId: r.actorId,
    actorName: r.actorName ?? r.actorEmail ?? "Unnamed user",
    selfAction: r.selfAction,
    createdAt: r.createdAt,
  }));
}

/**
 * W-67/decision 22: `allowance_changed` has no DB trigger the way
 * grant/revoke does (`app_user` isn't `platform_admin` — no natural row
 * whose own UPDATE a trigger could hang off without also firing for every
 * unrelated `app_user` write). Written explicitly, in the same transaction
 * as the allowance change itself, by the one domain function that performs
 * it — recorded here as a conscious choice, not an oversight, per this
 * repository's "record what you did not take" convention.
 */
export async function insertPlatformAuditEntry(
  db: Db,
  values: {
    action: "allowance_changed" | "request_approved" | "request_rejected";
    subjectId: string;
    actorId: string;
    selfAction: boolean;
    detailJson?: unknown;
  },
): Promise<void> {
  await db.insert(platformAuditLog).values(values);
}

export interface AdminUserRow {
  id: string;
  email: string | null;
  displayName: string | null;
  businessAllowance: number;
  activeBusinessCount: number;
  isPlatformAdmin: boolean;
}

/** F-11.2/decision 22: every identity, for the allowance screen and the admin-grant picker. Counts active owner/owner-manager memberships the same way the threshold check itself does (queries/business.ts's countActiveOwnerMemberships) — kept as a separate query here because this one aggregates across every user in one round trip rather than one user at a time. */
export async function listUsersForAdmin(db: ReadDb): Promise<AdminUserRow[]> {
  const userRows = await db
    .select({
      id: appUser.id,
      email: appUser.email,
      displayName: appUser.displayName,
      businessAllowance: appUser.businessAllowance,
    })
    .from(appUser);

  const [memberRows, adminRows] = await Promise.all([
    db
      .select({ userId: businessMember.userId, role: businessMember.role })
      .from(businessMember)
      .where(isNull(businessMember.revokedAt)),
    db
      .select({ userId: platformAdmin.userId })
      .from(platformAdmin)
      .where(isNull(platformAdmin.revokedAt)),
  ]);

  const activeCountByUser = new Map<string, number>();
  for (const row of memberRows) {
    if (row.role !== "owner" && row.role !== "owner_manager") continue;
    // A real count, not a missing-data fallback (W-56 governs the latter) —
    // Map.get() returning undefined here means "zero rows seen so far",
    // which is exactly zero, not an absence being papered over.
    // eslint-disable-next-line no-restricted-syntax -- see comment above
    activeCountByUser.set(row.userId, (activeCountByUser.get(row.userId) ?? 0) + 1);
  }
  const adminUserIds = new Set(adminRows.map((r) => r.userId));

  return userRows.map((u) => ({
    ...u,
    // eslint-disable-next-line no-restricted-syntax -- a genuine zero count, not missing data (see above)
    activeBusinessCount: activeCountByUser.get(u.id) ?? 0,
    isPlatformAdmin: adminUserIds.has(u.id),
  }));
}
