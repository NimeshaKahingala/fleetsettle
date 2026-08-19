import { newId } from "@fleetsettle/shared";
import type { BusinessMemberRole } from "@fleetsettle/shared/schemas";
import type { Writer } from "../db/client.js";
import { isBusinessHasNoOwnerViolation, isUniqueViolation } from "../db/pg-error.js";
import {
  AlreadyAMemberError,
  InviteCodeInvalidError,
  LastOwnerRequiredError,
} from "../errors/app-error.js";
import { findAppUserBySub, insertAppUser, insertBusinessMember } from "../queries/business.js";
import {
  consumeBusinessMemberInvite,
  expireUnredeemedBusinessMemberInvites,
  findActiveBusinessMemberInviteByCodeHash,
  insertBusinessMemberInvite,
} from "../queries/business-member-invite.js";
import {
  findActiveBusinessMemberForBusiness,
  revokeBusinessMember as revokeBusinessMemberRow,
} from "../queries/business-member.js";
import {
  consumeDriverLinkInvite,
  expireUnredeemedDriverLinkInvites,
  findActiveDriverLinkInviteByCodeHash,
  insertDriverLinkInvite,
} from "../queries/driver-link-invite.js";
import { linkDriverToUser } from "../queries/driver.js";
import { generateInviteCode, hashInviteCode, INVITE_CODE_TTL_MS } from "./invite-code.js";

export interface InviteBusinessMemberInput {
  businessId: string;
  role: BusinessMemberRole;
  createdBy: string;
}

export interface IssuedInvite {
  code: string;
  role: BusinessMemberRole;
  expiresAt: string;
}

/**
 * F-1.4/W-57. Reissuing invalidates the prior unredeemed code for the same
 * (business, role) before writing the new one — the invitee's stated
 * alternate, and the reason `expireUnredeemedBusinessMemberInvites` runs
 * inside the same transaction rather than as a separate call the handler
 * could forget.
 */
export async function inviteBusinessMember(
  writer: Writer,
  input: InviteBusinessMemberInput,
): Promise<IssuedInvite> {
  const code = generateInviteCode();
  const codeHash = await hashInviteCode(code);
  const expiresAt = new Date(Date.now() + INVITE_CODE_TTL_MS).toISOString();

  await writer.transaction(async (tx) => {
    await expireUnredeemedBusinessMemberInvites(tx, input.businessId, input.role);
    await insertBusinessMemberInvite(tx, {
      id: newId(),
      businessId: input.businessId,
      role: input.role,
      codeHash,
      createdBy: input.createdBy,
      expiresAt,
    });
  });

  return { code, role: input.role, expiresAt };
}

export type RevokeBusinessMemberResult = { found: true; revokedAt: string } | { found: false };

/** A11/GAP-43: 404 if `memberId` belongs to another business or is already revoked — cross-tenant is 404, never 403 (CLAUDE.md → Tenancy), and a revoked row is not a valid target either way. */
export async function revokeBusinessMember(
  writer: Writer,
  businessId: string,
  memberId: string,
): Promise<RevokeBusinessMemberResult> {
  const member = await findActiveBusinessMemberForBusiness(writer, businessId, memberId);
  if (!member) return { found: false };

  try {
    return await writer.transaction(async (tx) => {
      const revoked = await revokeBusinessMemberRow(tx, memberId);
      // Guarded on revoked_at IS NULL in the query itself — a concurrent
      // racer already won between the read above and this write.
      if (!revoked) return { found: false };
      return { found: true, revokedAt: revoked.revokedAt };
    });
  } catch (err) {
    if (isBusinessHasNoOwnerViolation(err)) throw new LastOwnerRequiredError();
    throw err;
  }
}

/**
 * A11: revoke-and-grant, two rows, never an in-place `UPDATE` — Plan.md's
 * own "void and replace" reasoning (W-50) applied to access, and it keeps
 * the audit trail (GAP-53) readable as two facts with times on them rather
 * than one row whose history is only in `audit_log`'s `before_json`.
 */
export type ChangeBusinessMemberRoleResult =
  { found: true; id: string; userId: string; role: BusinessMemberRole } | { found: false };

export async function changeBusinessMemberRole(
  writer: Writer,
  businessId: string,
  memberId: string,
  newRole: BusinessMemberRole,
): Promise<ChangeBusinessMemberRoleResult> {
  const member = await findActiveBusinessMemberForBusiness(writer, businessId, memberId);
  if (!member) return { found: false };

  const newMemberId = newId();
  try {
    return await writer.transaction(async (tx) => {
      const revoked = await revokeBusinessMemberRow(tx, memberId);
      // Guarded on revoked_at IS NULL in the query itself — a concurrent
      // racer (a revoke, or another role change) already won.
      if (!revoked) return { found: false };

      await insertBusinessMember(tx, {
        id: newMemberId,
        businessId,
        userId: member.userId,
        role: newRole,
      });
      return { found: true, id: newMemberId, userId: member.userId, role: newRole };
    });
  } catch (err) {
    if (isBusinessHasNoOwnerViolation(err)) throw new LastOwnerRequiredError();
    throw err;
  }
}

export interface DriverLinkInviteInput {
  businessId: string;
  driverId: string;
  createdBy: string;
}

/** F-1.8/W-42, GAP-43's other half. `driverId` is confirmed to belong to `businessId` by the handler's own read (`findDriverForBusiness`) before this is called — the same cross-tenant shape every other driver-scoped write already uses. */
export async function inviteDriverLink(
  writer: Writer,
  input: DriverLinkInviteInput,
): Promise<{ code: string; expiresAt: string }> {
  const code = generateInviteCode();
  const codeHash = await hashInviteCode(code);
  const expiresAt = new Date(Date.now() + INVITE_CODE_TTL_MS).toISOString();

  await writer.transaction(async (tx) => {
    await expireUnredeemedDriverLinkInvites(tx, input.driverId);
    await insertDriverLinkInvite(tx, {
      id: newId(),
      driverId: input.driverId,
      codeHash,
      createdBy: input.createdBy,
      expiresAt,
    });
  });

  return { code, expiresAt };
}

export interface RedeemInviteInput {
  code: string;
  sub: string;
  email?: string;
  displayName?: string;
}

export type RedeemInviteResult =
  | { kind: "business_member"; businessId: string; role: BusinessMemberRole }
  | { kind: "driver_link"; driverId: string };

/**
 * W-57: one mechanism, two destinations — the code alone decides which.
 * Tries `business_member_invite` first, then `driver_link_invite`; neither
 * matching is `InviteCodeInvalidError`, one message regardless of whether
 * the code never existed, expired, or was already redeemed (never let an
 * attacker enumerate which).
 *
 * `app_user` is created just-in-time, exactly as `createBusiness` (F-0.1)
 * already does — redeeming a code may be this identity's first authenticated
 * write. The role/driver never comes from `input`, only from whichever
 * invite the hash matched (F-1.4's own accept clause).
 */
export async function redeemInvite(
  writer: Writer,
  input: RedeemInviteInput,
): Promise<RedeemInviteResult> {
  const codeHash = await hashInviteCode(input.code);

  try {
    return await writer.transaction(async (tx) => {
      const memberInvite = await findActiveBusinessMemberInviteByCodeHash(tx, codeHash);
      if (memberInvite) {
        const existing = await findAppUserBySub(tx, input.sub);
        const userId = existing?.id ?? newId();
        if (!existing) {
          await insertAppUser(tx, {
            id: userId,
            asgardeoSub: input.sub,
            ...(input.email !== undefined ? { email: input.email } : {}),
            ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
          });
        }

        const consumed = await consumeBusinessMemberInvite(tx, memberInvite.id, userId);
        if (!consumed) throw new InviteCodeInvalidError();

        await insertBusinessMember(tx, {
          id: newId(),
          businessId: memberInvite.businessId,
          userId,
          role: memberInvite.role as BusinessMemberRole,
        });

        return {
          kind: "business_member" as const,
          businessId: memberInvite.businessId,
          role: memberInvite.role as BusinessMemberRole,
        };
      }

      const driverInvite = await findActiveDriverLinkInviteByCodeHash(tx, codeHash);
      if (driverInvite) {
        const existing = await findAppUserBySub(tx, input.sub);
        const userId = existing?.id ?? newId();
        if (!existing) {
          await insertAppUser(tx, {
            id: userId,
            asgardeoSub: input.sub,
            ...(input.email !== undefined ? { email: input.email } : {}),
            ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
          });
        }

        const consumed = await consumeDriverLinkInvite(tx, driverInvite.id, userId);
        if (!consumed) throw new InviteCodeInvalidError();

        const linked = await linkDriverToUser(tx, driverInvite.driverId, userId);
        if (!linked) throw new InviteCodeInvalidError();

        return { kind: "driver_link" as const, driverId: driverInvite.driverId };
      }

      throw new InviteCodeInvalidError();
    });
  } catch (err) {
    // Phase 1 (18 Aug 2026, decision 19): one_active_business_per_user is
    // gone. business_member_active_pair, which survives it, is a narrower
    // rule — "not the same business twice" — and it is what this branch
    // now maps: redeeming a business_member_invite for a business this
    // identity already actively belongs to (owner/owner-manager/manager,
    // not revoked). A different business is no longer a conflict at all
    // (W-63/W-66) — only the identical one is.
    if (isUniqueViolation(err, "business_member_active_pair")) {
      throw new AlreadyAMemberError();
    }
    // W-66, added 18 Aug 2026: driver.linked_user_id is now business-scoped
    // (driver_linked_user_per_business, migration 0029) rather than a
    // global UNIQUE. A second driver-link redemption for the same identity
    // in a *different* business is legal and lands here without error; this
    // branch only catches the same shape one level down — linking the same
    // identity to two driver records inside the one business the invite
    // names, confirmed by an independent sweep of this function rather than
    // assumed (implementation plan §2, Phase 1).
    if (isUniqueViolation(err, "driver_linked_user_per_business")) {
      throw new AlreadyAMemberError("This account is already linked to a driver in this business");
    }
    throw err;
  }
}
