import { addDays, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { Reader } from "../db/client.js";
import { findBusinessSettings } from "../queries/business.js";
import {
  listDepositsDueForRelease,
  listExpiringDriverLicences,
  listExpiringVehicleDocuments,
} from "../queries/home.js";
import { findPartyNames } from "../queries/reports.js";

const DEFAULT_PAPERWORK_WARN_DAYS = 30;

export interface PaperworkWarning {
  subjectType: "vehicle" | "driver";
  subjectId: string;
  subjectLabel: string;
  docType: string;
  expiryDate: string;
  isExpired: boolean;
}

/**
 * F-10.1/UC-92, read live rather than through a cron (TRACKER.md P13: "on
 * the home screen" is a query the screen makes, not a job that writes
 * anything). Warns `paperworkWarnDays` ahead of the expiry (business
 * setting, default 30) and keeps warning past it — there is no separate
 * "already expired" list, since the Accept clause is "until the new date is
 * entered." Sorted soonest-expiry first, the same urgency ordering UI §3.2
 * gives this item on the home stack.
 */
export async function getPaperworkWarnings(
  reader: Reader,
  businessId: string,
  today: BusinessDate,
): Promise<PaperworkWarning[]> {
  const settings = await findBusinessSettings(reader, businessId);
  const warnDays = settings?.paperworkWarnDays ?? DEFAULT_PAPERWORK_WARN_DAYS;
  const throughDate = addDays(today, warnDays);

  const [vehicleDocs, driverLicences] = await Promise.all([
    listExpiringVehicleDocuments(reader, businessId, throughDate),
    listExpiringDriverLicences(reader, businessId, throughDate),
  ]);

  const warnings: PaperworkWarning[] = [
    ...vehicleDocs.map((d) => ({
      subjectType: "vehicle" as const,
      subjectId: d.vehicleId,
      subjectLabel: d.registration,
      docType: d.docType,
      expiryDate: d.expiryDate,
      isExpired: d.expiryDate < today,
    })),
    ...driverLicences.map((d) => ({
      subjectType: "driver" as const,
      subjectId: d.driverId,
      subjectLabel: d.name,
      docType: "licence",
      expiryDate: d.expiryDate,
      isExpired: d.expiryDate < today,
    })),
  ];

  return warnings.sort((a, b) =>
    a.expiryDate < b.expiryDate ? -1 : a.expiryDate > b.expiryDate ? 1 : 0,
  );
}

export interface DepositRelease {
  depositId: string;
  partyType: "customer" | "driver";
  partyId: string;
  partyName: string | null;
  holdReleaseDate: string;
  heldMinor: Minor;
}

/**
 * F-2.7/UC-16 step 6, W-29, read live rather than through a cron — same
 * reasoning as `getPaperworkWarnings` above. Still a liability and still not
 * income (§6.13) until a manager releases it or applies it against a charge
 * that arrived in the meantime (F-8.4); this endpoint only surfaces which
 * ones have reached their release date, it does not act on them.
 */
export async function getDepositReleases(
  reader: Reader,
  businessId: string,
  today: BusinessDate,
): Promise<DepositRelease[]> {
  const rows = await listDepositsDueForRelease(reader, businessId, today);
  const customerIds = rows.filter((r) => r.partyType === "customer").map((r) => r.partyId);
  const driverIds = rows.filter((r) => r.partyType === "driver").map((r) => r.partyId);
  const names = await findPartyNames(reader, businessId, customerIds, driverIds);

  return rows.map((r) => ({
    depositId: r.depositId,
    partyType: r.partyType,
    partyId: r.partyId,
    partyName:
      r.partyType === "customer"
        ? (names.customers.get(r.partyId) ?? null)
        : (names.drivers.get(r.partyId) ?? null),
    holdReleaseDate: r.holdReleaseDate,
    heldMinor: r.heldMinor as Minor,
  }));
}
