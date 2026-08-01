import { newId } from "@fleetsettle/shared";
import { and, eq } from "drizzle-orm";
import type { Writer } from "../../src/db/client.js";
import {
  accountingPeriod,
  appUser,
  business,
  businessMember,
  businessSettings,
  customer,
  dailyLease,
  dailyLeaseRate,
  dayRecord,
  driver,
  lease,
  obligation,
  openingBalanceBatch,
  openingBalanceEntry,
  payment,
  paymentAllocation,
  trip,
  vehicle,
  vehicleArrangement,
  vehicleDayAllocation,
  vehicleDocument,
} from "../../src/db/schema.js";

interface BusinessOverrides {
  name?: string;
  currencyCode?: string;
  timezone?: string;
}

interface OpenPeriodOverrides {
  periodStart?: string;
  periodEnd?: string;
}

interface VehicleOverrides {
  registration?: string;
  vehicleType?: string;
}

interface DriverOverrides {
  name?: string;
  dailyFeeMinor?: bigint;
}

interface CustomerOverrides {
  name?: string;
  mobile?: string;
}

interface LeaseOverrides {
  startDate?: string;
  billingDay?: number;
  rentAmountMinor?: bigint;
}

interface DailyLeaseOverrides {
  patternType?: "every_day" | "alternate" | "weekdays";
  effectiveFrom?: string;
  dailyLeaseAmountMinor?: bigint;
}

/**
 * Creates rows a test needs and tears them down again, in the reverse of the
 * order they were created — the schema has no cascading deletes (DM: records
 * are voided, never hidden, so nothing was built to cascade), and every
 * factory here creates a child only after its parent exists, so unwinding in
 * reverse is always FK-safe (IG §8.3's "cascade-safe cleanup").
 *
 * `auth.ts`'s user/role fixtures register their own cleanup on the same
 * context via `track()`, so one `ctx.cleanup()` unwinds everything a test
 * created regardless of which factory module created it.
 */
export class TestContext {
  readonly #db: Writer;
  readonly #cleanups: Array<() => Promise<void>> = [];

  constructor(db: Writer) {
    this.#db = db;
  }

  track(cleanup: () => Promise<void>): void {
    this.#cleanups.push(cleanup);
  }

  async createBusiness(overrides: BusinessOverrides = {}): Promise<string> {
    const id = newId();
    await this.#db.insert(business).values({
      id,
      name: overrides.name ?? "Test Fleet",
      currencyCode: overrides.currencyCode ?? "LKR",
      timezone: overrides.timezone ?? "Asia/Colombo",
    });
    this.track(async () => {
      await this.#db.delete(business).where(eq(business.id, id));
    });
    return id;
  }

  async createOpenPeriod(businessId: string, overrides: OpenPeriodOverrides = {}): Promise<string> {
    const id = newId();
    await this.#db.insert(accountingPeriod).values({
      id,
      businessId,
      periodStart: overrides.periodStart ?? "2026-07-01",
      periodEnd: overrides.periodEnd ?? "2026-07-31",
      status: "open",
    });
    this.track(async () => {
      await this.#db.delete(accountingPeriod).where(eq(accountingPeriod.id, id));
    });
    return id;
  }

  async createVehicle(businessId: string, overrides: VehicleOverrides = {}): Promise<string> {
    const id = newId();
    await this.#db.insert(vehicle).values({
      id,
      businessId,
      registration: overrides.registration ?? `TEST-${id.slice(0, 8)}`,
      vehicleType: overrides.vehicleType ?? "car",
    });
    this.track(async () => {
      await this.#db.delete(vehicle).where(eq(vehicle.id, id));
    });
    return id;
  }

  async createDriver(businessId: string, overrides: DriverOverrides = {}): Promise<string> {
    const id = newId();
    await this.#db.insert(driver).values({
      id,
      businessId,
      name: overrides.name ?? "Test Driver",
      driverDayFeeMinor: overrides.dailyFeeMinor ?? 100_00n,
    });
    this.track(async () => {
      await this.#db.delete(driver).where(eq(driver.id, id));
    });
    return id;
  }

  async createCustomer(businessId: string, overrides: CustomerOverrides = {}): Promise<string> {
    const id = newId();
    await this.#db.insert(customer).values({
      id,
      businessId,
      customerType: "person",
      name: overrides.name ?? "Test Customer",
      mobile: overrides.mobile ?? "0770000000",
    });
    this.track(async () => {
      await this.#db.delete(customer).where(eq(customer.id, id));
    });
    return id;
  }

  async createLease(
    businessId: string,
    vehicleId: string,
    customerId: string,
    overrides: LeaseOverrides = {},
  ): Promise<string> {
    const id = newId();
    await this.#db.insert(lease).values({
      id,
      businessId,
      vehicleId,
      customerId,
      startDate: overrides.startDate ?? "2026-07-01",
      billingDay: overrides.billingDay ?? 1,
      rentAmountMinor: overrides.rentAmountMinor ?? 50_000_00n,
    });
    this.track(async () => {
      await this.#db.delete(lease).where(eq(lease.id, id));
    });
    return id;
  }

  /** Bare `daily_lease` + its first `daily_lease_rate` — for tests that need arrangement B in place without going through `POST /api/daily-lease`. */
  async createDailyLease(
    businessId: string,
    vehicleId: string,
    driverId: string,
    overrides: DailyLeaseOverrides = {},
  ): Promise<string> {
    const id = newId();
    await this.#db.insert(dailyLease).values({
      id,
      businessId,
      vehicleId,
      driverId,
      patternType: overrides.patternType ?? "every_day",
      effectiveFrom: overrides.effectiveFrom ?? "2026-07-01",
    });
    this.track(async () => {
      await this.#db.delete(dailyLease).where(eq(dailyLease.id, id));
    });

    await this.#db.insert(dailyLeaseRate).values({
      id: newId(),
      dailyLeaseId: id,
      dailyLeaseAmountMinor: overrides.dailyLeaseAmountMinor ?? 5_000_00n,
      effectiveFrom: overrides.effectiveFrom ?? "2026-07-01",
    });
    this.track(async () => {
      await this.#db.delete(dailyLeaseRate).where(eq(dailyLeaseRate.dailyLeaseId, id));
    });

    return id;
  }

  /** Flips a period straight to `closed` — there is no close endpoint yet (P9); this is only how a test reaches the trigger's rejection path. */
  async closePeriod(periodId: string): Promise<void> {
    await this.#db
      .update(accountingPeriod)
      .set({ status: "closed" })
      .where(eq(accountingPeriod.id, periodId));
  }

  /**
   * F-0.1: `POST /api/business` writes `app_user`, `business`,
   * `business_member`, `business_settings` and `accounting_period` in one
   * transaction (domain/setup.ts) — this is that write's teardown, one
   * `track()`ed function so it stays FK-safe (children before parents)
   * without depending on where it falls relative to a test's other
   * `track()` calls.
   */
  trackCreatedBusiness(businessId: string, userId: string): void {
    this.track(async () => {
      await this.#db.delete(accountingPeriod).where(eq(accountingPeriod.businessId, businessId));
      await this.#db.delete(businessSettings).where(eq(businessSettings.businessId, businessId));
      await this.#db.delete(businessMember).where(eq(businessMember.businessId, businessId));
      await this.#db.delete(business).where(eq(business.id, businessId));
      await this.#db.delete(appUser).where(eq(appUser.id, userId));
    });
  }

  /**
   * F-1.1: `POST /api/vehicle` writes `vehicle`, `vehicle_arrangement` and
   * (optionally) `vehicle_document` rows (domain/vehicles.ts) — this is that
   * write's teardown, for tests that go through the endpoint rather than
   * `createVehicle()` above (which makes a bare `vehicle` row only, with no
   * arrangement, for tests that don't care which arrangement it's in).
   */
  trackCreatedVehicle(vehicleId: string): void {
    this.track(async () => {
      await this.#db.delete(vehicleDocument).where(eq(vehicleDocument.vehicleId, vehicleId));
      await this.#db.delete(vehicleArrangement).where(eq(vehicleArrangement.vehicleId, vehicleId));
      await this.#db.delete(vehicle).where(eq(vehicle.id, vehicleId));
    });
  }

  /** F-1.6: `POST /api/driver` writes a single row — this is that write's teardown, for tests that go through the endpoint rather than `createDriver()` above. */
  trackCreatedDriver(driverId: string): void {
    this.track(async () => {
      await this.#db.delete(driver).where(eq(driver.id, driverId));
    });
  }

  /** F-2.1: `POST /api/customer` writes a single row — this is that write's teardown, for tests that go through the endpoint rather than `createCustomer()` above. */
  trackCreatedCustomer(customerId: string): void {
    this.track(async () => {
      await this.#db.delete(customer).where(eq(customer.id, customerId));
    });
  }

  /** F-2.1: `POST /api/lease` writes a single row — this is that write's teardown, for tests that go through the endpoint rather than `createLease()` above. */
  trackCreatedLease(leaseId: string): void {
    this.track(async () => {
      await this.#db.delete(lease).where(eq(lease.id, leaseId));
    });
  }

  /** F-1.7: `POST /api/daily-lease` writes `daily_lease` and its first `daily_lease_rate` (domain/dailyLease.ts) — this is that write's teardown. */
  trackCreatedDailyLease(dailyLeaseId: string): void {
    this.track(async () => {
      await this.#db.delete(dailyLeaseRate).where(eq(dailyLeaseRate.dailyLeaseId, dailyLeaseId));
      await this.#db.delete(dailyLease).where(eq(dailyLease.id, dailyLeaseId));
    });
  }

  /**
   * F-4.2/F-4.4: `POST /api/day-record/confirm` writes `day_record`, its
   * `obligation`, and — when anything was received — a `payment` and its
   * `payment_allocation` (domain/confirmDay.ts). A `did_not_run` day has no
   * obligation at all, so this looks each child up rather than assuming a
   * fixed shape, then unwinds child-before-parent.
   */
  trackCreatedDayRecord(dayRecordId: string): void {
    this.track(async () => {
      const obligationRows = await this.#db
        .select({ id: obligation.id })
        .from(obligation)
        .where(and(eq(obligation.sourceType, "day_record"), eq(obligation.sourceId, dayRecordId)));

      for (const { id: obligationId } of obligationRows) {
        const allocationRows = await this.#db
          .select({ paymentId: paymentAllocation.paymentId })
          .from(paymentAllocation)
          .where(eq(paymentAllocation.obligationId, obligationId));

        await this.#db
          .delete(paymentAllocation)
          .where(eq(paymentAllocation.obligationId, obligationId));
        for (const { paymentId } of allocationRows) {
          await this.#db.delete(payment).where(eq(payment.id, paymentId));
        }
        await this.#db.delete(obligation).where(eq(obligation.id, obligationId));
      }

      await this.#db.delete(dayRecord).where(eq(dayRecord.id, dayRecordId));
    });
  }

  /** F-5.1: `POST /api/trip` writes `trip` and its full-range `vehicle_day_allocation` (domain/trip.ts) — this is that write's teardown. */
  trackCreatedTrip(tripId: string): void {
    this.track(async () => {
      await this.#db.delete(vehicleDayAllocation).where(eq(vehicleDayAllocation.sourceId, tripId));
      await this.#db.delete(trip).where(eq(trip.id, tripId));
    });
  }

  /** F-0.2: `PUT /api/opening-balance` writes `opening_balance_batch` and its entries (domain/opening-balance.ts) — this is that write's teardown. */
  trackCreatedOpeningBalance(batchId: string): void {
    this.track(async () => {
      await this.#db.delete(openingBalanceEntry).where(eq(openingBalanceEntry.batchId, batchId));
      await this.#db.delete(openingBalanceBatch).where(eq(openingBalanceBatch.id, batchId));
    });
  }

  /** Unwinds every tracked row, most-recently-created first. */
  async cleanup(): Promise<void> {
    for (const fn of this.#cleanups.reverse()) {
      await fn();
    }
    this.#cleanups.length = 0;
  }
}
