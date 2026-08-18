import { businessToday, newId } from "@fleetsettle/shared";
import type { Writer } from "../db/client.js";
import { isUniqueViolation } from "../db/pg-error.js";
import {
  NotFoundError,
  RequestAlreadyDecidedError,
  RequestAlreadyPendingError,
} from "../errors/app-error.js";
import {
  countActiveOwnerMemberships,
  findAppUserById,
  findAppUserBySub,
  insertAppUser,
} from "../queries/business.js";
import {
  findRequestById,
  insertBusinessCreationRequest,
  markRequestApproved,
  markRequestRejected,
} from "../queries/platform/business-creation-request.js";
import { insertPlatformAuditEntry } from "../queries/platform/platform-admin.js";
import {
  createBusiness,
  createBusinessForUser,
  type CreateBusinessInput,
  type CreatedBusiness,
} from "./setup.js";

export type BusinessCreationResult =
  ({ kind: "created" } & CreatedBusiness) | { kind: "pending"; requestId: string };

/**
 * F-0.3/UC-102, decisions 4/22 (W-63/W-64): below the requester's own
 * allowance, this runs `createBusiness` exactly as F-0.1 always has —
 * unqueued. At or above it, nothing is created yet; a `pending` request is
 * held instead (F-11.1 decides it later).
 *
 * **The count-then-decide race is accepted, not fixed — decision 20.**
 * Two concurrent calls from a user at their 4th active ownership (allowance
 * 5) can both read `activeCount = 4`, both conclude "under threshold", and
 * both create a business, landing the identity at 6 active businesses with
 * no queued request. Every other invariant in this codebase is a DB
 * constraint or trigger the application catches a violation from
 * (`db/pg-error.ts`'s own header comment); this one, as designed, is an
 * application-level check with no equivalent constraint — Postgres has no
 * native "at most N rows matching a predicate" the way a partial unique
 * index gives "at most 1". Given this product's actual concurrency (one or
 * two people, occasionally two browser tabs), accepting the race explicitly
 * is judged cheaper than `SERIALIZABLE` isolation and a retry loop for a
 * gap this narrow. Revisit if a business ever grows to a scale where the
 * threshold is load-bearing rather than a light nudge toward review.
 */
export async function requestOrCreateBusiness(
  writer: Writer,
  input: CreateBusinessInput,
): Promise<BusinessCreationResult> {
  const existing = await findAppUserBySub(writer, input.sub);
  const userId = existing?.id ?? newId();
  if (!existing) {
    await insertAppUser(writer, {
      id: userId,
      asgardeoSub: input.sub,
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
    });
  }

  const [activeCount, user] = await Promise.all([
    countActiveOwnerMemberships(writer, userId),
    findAppUserById(writer, userId),
  ]);
  const allowance = user?.businessAllowance ?? 5;

  if (activeCount < allowance) {
    // Re-resolves app_user by sub — finds the row just inserted above (or
    // already existing) and skips the insert, the same idempotent shape
    // createBusiness's own `existing?.id ?? newId()` already has.
    const created = await createBusiness(writer, input);
    return { kind: "created", ...created };
  }

  const requestId = newId();
  try {
    await insertBusinessCreationRequest(writer, {
      id: requestId,
      requestedBy: userId,
      name: input.name,
      currencyCode: input.currencyCode,
      timezone: input.timezone,
    });
  } catch (err) {
    // INV-41: business_creation_request_one_pending. A genuinely different
    // race from the one accepted above — this one has a real constraint,
    // so it is caught the ordinary way (db/pg-error.ts's own convention),
    // not accepted.
    if (isUniqueViolation(err, "business_creation_request_one_pending")) {
      throw new RequestAlreadyPendingError();
    }
    throw err;
  }

  return { kind: "pending", requestId };
}

/**
 * F-11.1: approve a queued request — runs the identical business-creation
 * writes `createBusiness` performs unqueued (`createBusinessForUser`), for
 * the identity that requested it, using exactly the name/currency/timezone
 * it asked for. `actorId` is the deciding admin, for the audit entry and
 * `self_action` (W-67).
 */
export async function approveRequest(
  writer: Writer,
  requestId: string,
  actorId: string,
): Promise<CreatedBusiness> {
  const request = await findRequestById(writer, requestId);
  if (!request) throw new NotFoundError();
  if (request.status !== "pending") throw new RequestAlreadyDecidedError();

  const created = await createBusinessForUser(writer, {
    userId: request.requestedBy,
    name: request.name,
    currencyCode: request.currencyCode,
    timezone: request.timezone,
    today: businessToday(request.timezone),
  });

  await markRequestApproved(writer, requestId, actorId, created.businessId);
  await insertPlatformAuditEntry(writer, {
    action: "request_approved",
    subjectId: requestId,
    actorId,
    selfAction: actorId === request.requestedBy,
  });

  return created;
}

/** F-11.1: reject a queued request, with a reason the requester will see (decision 12) — creates nothing. */
export async function rejectRequest(
  writer: Writer,
  requestId: string,
  actorId: string,
  reason: string,
): Promise<void> {
  const request = await findRequestById(writer, requestId);
  if (!request) throw new NotFoundError();
  if (request.status !== "pending") throw new RequestAlreadyDecidedError();

  await markRequestRejected(writer, requestId, actorId, reason);
  await insertPlatformAuditEntry(writer, {
    action: "request_rejected",
    subjectId: requestId,
    actorId,
    selfAction: actorId === request.requestedBy,
  });
}
