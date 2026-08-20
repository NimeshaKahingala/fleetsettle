import { newId, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { OdometerSource } from "@fleetsettle/shared/schemas";
import type { Writer } from "../db/client.js";
import { generateNextBillingPeriodTx, type GeneratedBillingPeriod } from "./billing-period.js";
import { takeCustomerDepositTx } from "./deposit.js";
import {
  logUnrestorableDailyLeaseDates,
  restoreDailyLeaseOccupancy,
  type RestoreDailyLeaseOccupancyResult,
} from "./trip.js";
import { insertLease, updateLeaseTerms, type LeaseRow } from "../queries/lease.js";
import { insertOdometerReading } from "../queries/odometer-reading.js";
import { releaseExpiredHolds } from "../queries/trip.js";

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
  depositAmountMinor?: Minor;
  userId: string;
  /** Injected — `businessToday()` (IG §4.5). GAP-7: drives which of this vehicle's own holds count as expired before arrangement A starts occupying its dates. */
  today: BusinessDate;
}

export interface StartedLease {
  lease: LeaseRow;
  firstBillingPeriod: GeneratedBillingPeriod;
  depositId: string | null;
}

/**
 * F-2.1/UC-10, one transaction: the `lease` itself, the handover
 * `odometer_reading` (INV-19, when a mileage limit is set), the first
 * `billing_period` it generates — "a billing period on its own owes nobody
 * anything," so the first rent due is raised here rather than left for a
 * cron that has not run yet (CLAUDE.md → Writes: no cron is a prerequisite
 * for a user action) — and, when a deposit is taken at handover, the
 * `deposit` row F-2.6's own closure flow will later settle (`takeCustomerDepositTx`,
 * composed into this same transaction rather than opened as its own). Every
 * period after the first is P13's cron calling `generateNextBillingPeriod`
 * on a schedule, or the same endpoint tapped manually — the identical
 * idempotent function, not a second implementation.
 */
export async function startLease(writer: Writer, input: StartLeaseInput): Promise<StartedLease> {
  let restoreResult: RestoreDailyLeaseOccupancyResult | undefined;
  const started = await writer.transaction(async (tx) => {
    // GAP-7: released synchronously, ahead of this vehicle's own future
    // occupancy — the same relationship `bookTrip`/`startDailyLease` give
    // their own start, even though arrangement A's own allocation rows are
    // written by the cron rather than here (P13).
    const releasedHolds = await releaseExpiredHolds(tx, input.today, input.vehicleId, input.userId);
    // GAP-7/GAP-146: undo any calendar hole the just-released hold(s) left
    // in a still-active daily lease on this vehicle, backfilling from
    // wherever each hold actually started — the same GAP-119 restore
    // `cancelTrip`/`bookTrip` already do.
    restoreResult = await restoreDailyLeaseOccupancy(tx, releasedHolds.affected, input.today);

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

    let depositId: string | null = null;
    if (input.depositAmountMinor !== undefined) {
      const taken = await takeCustomerDepositTx(tx, {
        businessId: input.businessId,
        leaseId,
        customerId: input.customerId,
        amountMinor: input.depositAmountMinor,
        occurredOn: input.startDate,
        userId: input.userId,
      });
      depositId = taken.depositId;
    }

    return {
      lease: {
        id: leaseId,
        vehicleId: input.vehicleId,
        customerId: input.customerId,
        status: "active" as const,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        billingDay: input.billingDay,
        rentAmountMinor: input.rentAmountMinor,
        mileageDailyLimitKm: input.mileageDailyLimitKm ?? null,
        mileageExcessRateMinor: input.mileageExcessRateMinor ?? null,
        reminderDaysBefore: input.reminderDaysBefore ?? 3,
      },
      firstBillingPeriod,
      depositId,
    };
  });
  if (restoreResult) {
    logUnrestorableDailyLeaseDates(restoreResult, {
      businessId: input.businessId,
      reason: "hold_expired_on_lease_start",
    });
  }
  return started;
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
