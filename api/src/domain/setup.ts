import { monthEnd, monthStart, newId, type BusinessDate } from "@fleetsettle/shared";
import type { Writer } from "../db/client.js";
import {
  findAppUserBySub,
  insertAccountingPeriod,
  insertAppUser,
  insertBusiness,
  insertBusinessMember,
  insertBusinessSettings,
} from "../queries/business.js";

export interface CreateBusinessInput {
  /** The verified JWT subject — the only link to the identity provider (DM §3). */
  sub: string;
  email?: string;
  displayName?: string;
  name: string;
  currencyCode: string;
  timezone: string;
  /** Injected, not read here — `businessToday()` is the one sanctioned clock read, and it belongs to the handler (IG §4.5). */
  today: BusinessDate;
}

export interface CreatedBusiness {
  businessId: string;
  accountingPeriodId: string;
}

/**
 * F-0.1 / UC-08, one transaction: the `app_user` row (created just-in-time if
 * this is the caller's first authenticated write — Asgardeo sign-up and
 * `app_user` provisioning are two different moments), the business, its one
 * owner, its settings row, and the first open accounting period, covering
 * the month the business is created in — never a user-supplied go-live date,
 * which is UC-09's job, later, and can backdate independently of when the
 * business row itself was created.
 *
 * Phase 1 (18 Aug 2026, decision 19): the pre-check-avoidance argument this
 * comment used to make for `one_active_business_per_user` doesn't carry over
 * to `business_member_active_pair`, the constraint that survives it —
 * `businessId` above is always a fresh `newId()`, so the `(business_id,
 * user_id)` pair this insert writes can never collide with an existing row,
 * no matter how many businesses this identity already holds. There is
 * nothing left for a catch here to map; a second business is legal (W-63),
 * gated by the allowance/threshold when Phase 2 adds it, not by this
 * constraint. No try/catch — a genuine, unexpected DB error surfaces as a
 * real 500 rather than a second implementation of a rule that no longer
 * applies to this function.
 */
export async function createBusiness(
  writer: Writer,
  input: CreateBusinessInput,
): Promise<CreatedBusiness> {
  return await writer.transaction(async (tx) => {
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

    const businessId = newId();
    await insertBusiness(tx, {
      id: businessId,
      name: input.name,
      currencyCode: input.currencyCode,
      timezone: input.timezone,
    });

    // `owner_manager`, not `owner` — the creator is the partner who will
    // *operate* the business, and F-0.1 step 3 says so outright: they land
    // "on an empty home screen with one action: Add a vehicle", which is
    // the Operate shell. F-0.2, the very next flow, has Owner-manager as
    // its actor over the business this one just created. UI §1.1 maps
    // `owner` to the Review shell (the passive partner who reads reports,
    // 95% of whose use is monthly) — so assigning it here dropped every
    // new signup into a read-only shell they could do nothing from.
    // "A new business has exactly one owner" (F-0.1's own accept clause)
    // still holds: OWNERS is ["owner", "owner_manager"] in auth/policy.ts,
    // and an owner-manager is an owner.
    await insertBusinessMember(tx, { id: newId(), businessId, userId, role: "owner_manager" });
    await insertBusinessSettings(tx, businessId);

    const accountingPeriodId = newId();
    await insertAccountingPeriod(tx, {
      id: accountingPeriodId,
      businessId,
      periodStart: monthStart(input.today),
      periodEnd: monthEnd(input.today),
    });

    return { businessId, accountingPeriodId };
  });
}
