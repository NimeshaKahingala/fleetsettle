import { withActor, type Writer } from "../db/client.js";
import { isPlatformHasNoAdminViolation } from "../db/pg-error.js";
import { LastPlatformAdminRequiredError, NotFoundError } from "../errors/app-error.js";
import { findAppUserById, updateBusinessAllowance } from "../queries/business.js";
import {
  insertPlatformAuditEntry,
  revokePlatformAdmin,
  upsertPlatformAdmin,
} from "../queries/platform/platform-admin.js";

/**
 * F-11.2/W-65: grant or revoke, re-grantable since `platform_admin`'s PK is
 * `user_id` itself (DM §3.2). `platform_admin_audit` (migration 0030)
 * writes the log entry from inside the trigger — these two functions only
 * need to set `fleetsettle.actor_id` on the write, the same mechanism
 * `withActor` already wraps every transactional write with elsewhere
 * (db/client.ts), so the trigger's `audit_actor()` read has something to
 * find.
 */
export async function grantPlatformAdmin(
  writer: Writer,
  targetUserId: string,
  actorId: string,
): Promise<void> {
  const target = await findAppUserById(writer, targetUserId);
  if (!target) throw new NotFoundError();

  const scoped = withActor(writer, () => actorId);
  await scoped.transaction(async (tx) => {
    await upsertPlatformAdmin(tx, targetUserId, actorId);
  });
}

/** INV-40: `assert_platform_has_admin()` (migration 0030) is the truth — refusing the last admin is caught here, not pre-checked, the same convention every other DB-enforced invariant in this codebase already follows. */
export async function revokePlatformAdminGrant(
  writer: Writer,
  targetUserId: string,
  actorId: string,
): Promise<void> {
  const scoped = withActor(writer, () => actorId);
  try {
    await scoped.transaction(async (tx) => {
      await revokePlatformAdmin(tx, targetUserId);
    });
  } catch (err) {
    if (isPlatformHasNoAdminViolation(err)) throw new LastPlatformAdminRequiredError();
    throw err;
  }
}

/**
 * Decision 22: `app_user.business_allowance`, an admin's own write. No DB
 * trigger writes `allowance_changed` the way grant/revoke's trigger does —
 * `app_user` isn't `platform_admin`, so there is no natural row whose own
 * UPDATE a trigger could hang off without firing for every unrelated
 * `app_user` write (email changes, display-name changes, none of them
 * platform actions). Written explicitly, in the same transaction, by this
 * one function — a conscious choice, recorded per this repository's "record
 * what you did not take" convention, not an oversight matching
 * grant/revoke's own shape by accident.
 */
export async function setBusinessAllowance(
  writer: Writer,
  targetUserId: string,
  actorId: string,
  businessAllowance: number,
): Promise<void> {
  const target = await findAppUserById(writer, targetUserId);
  if (!target) throw new NotFoundError();

  await writer.transaction(async (tx) => {
    await updateBusinessAllowance(tx, targetUserId, businessAllowance);
    await insertPlatformAuditEntry(tx, {
      action: "allowance_changed",
      subjectId: targetUserId,
      actorId,
      selfAction: actorId === targetUserId,
      detailJson: { from: target.businessAllowance, to: businessAllowance },
    });
  });
}
