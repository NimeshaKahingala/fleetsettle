import { monthEnd, monthStart, newId, type BusinessDate } from "@fleetsettle/shared";
import type { Writer } from "../db/client.js";
import { isUniqueViolation } from "../db/pg-error.js";
import { BusinessAlreadyExistsError } from "../errors/app-error.js";
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
 * No pre-check for "does this identity already have a business" — DM §3's
 * `one_active_business_per_user` index is the truth, the same argument
 * CLAUDE.md makes for `assert_period_open()`: a pre-check here would be a
 * second implementation of that rule, and the two would eventually diverge.
 * A double-submit or a retry hits the index and comes back as one 409.
 */
export async function createBusiness(
  writer: Writer,
  input: CreateBusinessInput,
): Promise<CreatedBusiness> {
  try {
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

      await insertBusinessMember(tx, { id: newId(), businessId, userId, role: "owner" });
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
  } catch (err) {
    if (isUniqueViolation(err, "one_active_business_per_user")) {
      throw new BusinessAlreadyExistsError();
    }
    throw err;
  }
}
