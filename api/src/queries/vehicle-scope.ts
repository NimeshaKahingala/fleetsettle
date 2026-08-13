import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import { managementFeeAgreement, ownershipShare, vehicle } from "../db/schema.js";

type ReadDb = Reader | Writer | Tx;

/**
 * GAP-1/D-17: the two tables that answer "his vehicles" — never `auth/policy.ts`,
 * which is a synchronous, DB-free matrix mirrored client-side (`capabilities.ts`);
 * making it async would break that mirror. A handler resolves scope here,
 * after `requireCapability` has already confirmed the role holds the
 * capability at all — this only ever narrows which vehicles, never whether
 * the action is allowed in principle.
 */

/**
 * An owner-manager's `managePartnerCapital` scope (UC-03: "own vehicles",
 * INV-34) — every vehicle his `ownership_share` currently names. "Currently"
 * is `effective_to IS NULL`, the same present-tense read `listOwnershipShares`
 * already uses for "the currently active split" — a share is superseded by
 * closing the old row and inserting a new one, never by a date comparison
 * against today.
 */
export async function listVehicleIdsOwnedByUser(
  db: ReadDb,
  businessId: string,
  userId: string,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ vehicleId: ownershipShare.vehicleId })
    .from(ownershipShare)
    .innerJoin(vehicle, eq(vehicle.id, ownershipShare.vehicleId))
    .where(
      and(
        eq(vehicle.businessId, businessId),
        eq(ownershipShare.userId, userId),
        isNull(ownershipShare.effectiveTo),
      ),
    );
  return rows.map((r) => r.vehicleId);
}

/**
 * A manager's UC-70 (`viewReports`) scope — every vehicle whose
 * `management_fee_agreement` for this user **overlapped the reported
 * period** (W-59/D-17), never the agreement's status today or at the
 * period's end: `effective_from <= periodEnd AND (effective_to IS NULL OR
 * effective_to >= periodStart)`. A manager granted for only part of the
 * period still sees it; one granted after it ended does not.
 */
export async function listVehicleIdsManagedByUserForPeriod(
  db: ReadDb,
  businessId: string,
  userId: string,
  periodStart: string,
  periodEnd: string,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ vehicleId: managementFeeAgreement.vehicleId })
    .from(managementFeeAgreement)
    .innerJoin(vehicle, eq(vehicle.id, managementFeeAgreement.vehicleId))
    .where(
      and(
        eq(vehicle.businessId, businessId),
        eq(managementFeeAgreement.managerUserId, userId),
        lte(managementFeeAgreement.effectiveFrom, periodEnd),
        or(
          isNull(managementFeeAgreement.effectiveTo),
          gte(managementFeeAgreement.effectiveTo, periodStart),
        ),
      ),
    );
  return rows.map((r) => r.vehicleId);
}
