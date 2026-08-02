import { newId, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { OdometerSource } from "@fleetsettle/shared/schemas";
import type { Writer } from "../db/client.js";
import { generateNextBillingPeriodTx, type GeneratedBillingPeriod } from "./billing-period.js";
import { insertLease, updateLeaseTerms, type LeaseRow } from "../queries/lease.js";
import { insertOdometerReading } from "../queries/odometer-reading.js";

export interface StartLeaseInput {
  businessId: string;
  vehicleId: string;
  customerId: string;
  startDate: BusinessDate;
  endDate?: BusinessDate;
  billingDay: number;
  rentAmountMinor: Minor;
  mileageDailyLimitKm?: number;
  mileageExcessRateMinor?: Minor;
  reminderDaysBefore?: number;
  odometerReadingKm?: number;
  odometerSource?: OdometerSource;
}

export interface StartedLease {
  lease: LeaseRow;
  firstBillingPeriod: GeneratedBillingPeriod;
}

/**
 * F-2.1/UC-10, one transaction: the `lease` itself, the handover
 * `odometer_reading` (INV-19, when a mileage limit is set), and the first
 * `billing_period` it generates — "a billing period on its own owes nobody
 * anything," so the first rent due is raised here rather than left for a
 * cron that has not run yet (CLAUDE.md → Writes: no cron is a prerequisite
 * for a user action). Every period after this one is P13's cron calling
 * `generateNextBillingPeriod` on a schedule, or the same endpoint tapped
 * manually — the identical idempotent function, not a second implementation.
 */
export async function startLease(writer: Writer, input: StartLeaseInput): Promise<StartedLease> {
  return writer.transaction(async (tx) => {
    const leaseId = newId();
    await insertLease(tx, {
      id: leaseId,
      businessId: input.businessId,
      vehicleId: input.vehicleId,
      customerId: input.customerId,
      status: "active",
      startDate: input.startDate,
      ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
      billingDay: input.billingDay,
      rentAmountMinor: input.rentAmountMinor,
      ...(input.mileageDailyLimitKm !== undefined
        ? { mileageDailyLimitKm: input.mileageDailyLimitKm }
        : {}),
      ...(input.mileageExcessRateMinor !== undefined
        ? { mileageExcessRateMinor: input.mileageExcessRateMinor }
        : {}),
      ...(input.reminderDaysBefore !== undefined
        ? { reminderDaysBefore: input.reminderDaysBefore }
        : {}),
    });

    if (input.odometerReadingKm !== undefined && input.odometerSource !== undefined) {
      await insertOdometerReading(tx, {
        id: newId(),
        businessId: input.businessId,
        vehicleId: input.vehicleId,
        readingKm: input.odometerReadingKm,
        readOn: input.startDate,
        source: input.odometerSource,
        leaseId,
      });
    }

    const firstBillingPeriod = await generateNextBillingPeriodTx(tx, {
      businessId: input.businessId,
      leaseId,
    });

    return {
      lease: {
        id: leaseId,
        vehicleId: input.vehicleId,
        customerId: input.customerId,
        status: "active",
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        billingDay: input.billingDay,
        rentAmountMinor: input.rentAmountMinor,
        mileageDailyLimitKm: input.mileageDailyLimitKm ?? null,
        mileageExcessRateMinor: input.mileageExcessRateMinor ?? null,
        reminderDaysBefore: input.reminderDaysBefore ?? 3,
      },
      firstBillingPeriod,
    };
  });
}

export interface RenewLeaseInput {
  businessId: string;
  leaseId: string;
  rentAmountMinor: Minor;
  mileageDailyLimitKm?: number;
  mileageExcessRateMinor?: Minor;
}

/**
 * F-2.5/UC-17: same customer, new agreed amount from a date. Old periods
 * keep their old figure — already frozen onto `billing_period` at
 * generation time (W-25) — so this is a plain field update; only the next
 * period `generateNextBillingPeriod` produces will pick up the new rent.
 */
export async function renewLease(writer: Writer, input: RenewLeaseInput): Promise<void> {
  await updateLeaseTerms(writer, input.leaseId, {
    rentAmountMinor: input.rentAmountMinor,
    ...(input.mileageDailyLimitKm !== undefined
      ? { mileageDailyLimitKm: input.mileageDailyLimitKm }
      : {}),
    ...(input.mileageExcessRateMinor !== undefined
      ? { mileageExcessRateMinor: input.mileageExcessRateMinor }
      : {}),
  });
}
