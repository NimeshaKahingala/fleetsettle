import { newId } from "@fleetsettle/shared";
import { and, eq } from "drizzle-orm";
import type { Writer } from "../../src/db/client.js";
import {
  accountingPeriod,
  adjustment,
  advance,
  advanceSettlement,
  appUser,
  business,
  businessMember,
  businessSettings,
  customer,
  dailyLease,
  dailyLeaseRate,
  dayRecord,
  deposit,
  depositMovement,
  driver,
  expense,
  lease,
  obligation,
  offsetAllocation,
  offsetRecord,
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
  status?: "draft" | "active" | "closing" | "closed";
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

  /** §6.7's borne-by default is keyed on the vehicle's current arrangement — `createVehicle()` alone leaves it unset (P2's own bare factory does not assume any particular test needs one). */
  async setVehicleArrangement(vehicleId: string, arrangement: "A" | "B" | "C"): Promise<void> {
    const id = newId();
    await this.#db.insert(vehicleArrangement).values({
      id,
      vehicleId,
      arrangement,
      effectiveFrom: "2026-01-01",
    });
    this.track(async () => {
      await this.#db.delete(vehicleArrangement).where(eq(vehicleArrangement.id, id));
    });
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
      status: overrides.status ?? "draft",
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

  /** A bare `obligation` row — for tests exercising adjustment/offset against a fact that didn't arrive via `confirmDay` (P3) or a later phase's own writer. */
  async createObligation(
    businessId: string,
    periodId: string,
    overrides: {
      direction?: "owed_to_us" | "owed_by_us";
      driverId?: string;
      amountMinor?: bigint;
      settledMinor?: bigint;
      waivedMinor?: bigint;
      dueOn?: string;
      status?: "pending" | "part_paid" | "paid" | "waived" | "written_off";
    } = {},
  ): Promise<string> {
    const id = newId();
    await this.#db.insert(obligation).values({
      id,
      businessId,
      direction: overrides.direction ?? "owed_to_us",
      partyType: "driver",
      partyDriverId: overrides.driverId,
      kind: "other",
      sourceType: "test_fixture",
      amountMinor: overrides.amountMinor ?? 100_000n,
      settledMinor: overrides.settledMinor ?? 0n,
      waivedMinor: overrides.waivedMinor ?? 0n,
      dueOn: overrides.dueOn ?? "2026-07-15",
      effectiveDueOn: overrides.dueOn ?? "2026-07-15",
      status: overrides.status ?? "pending",
      postedPeriodId: periodId,
    });
    this.track(async () => {
      await this.#db.delete(adjustment).where(eq(adjustment.obligationId, id));
      await this.#db.delete(offsetAllocation).where(eq(offsetAllocation.obligationId, id));
      await this.#db.delete(obligation).where(eq(obligation.id, id));
    });
    return id;
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

  /** F-3.1/F-3.2/F-3.3: `POST /api/expense` writes a single row — this is that write's teardown. */
  trackCreatedExpense(expenseId: string): void {
    this.track(async () => {
      await this.#db.delete(expense).where(eq(expense.id, expenseId));
    });
  }

  /** F-6.3/UC-53: `POST /api/advance` + `.../settle` write `advance` and its settlements (domain/advance.ts) — this is that write's teardown. */
  trackCreatedAdvance(advanceId: string): void {
    this.track(async () => {
      await this.#db.delete(advanceSettlement).where(eq(advanceSettlement.advanceId, advanceId));
      await this.#db.delete(advance).where(eq(advance.id, advanceId));
    });
  }

  /** F-6.7/UC-58: `POST /api/deposit` + `.../movement` write `deposit` and its movements (domain/deposit.ts) — this is that write's teardown. */
  trackCreatedDeposit(depositId: string): void {
    this.track(async () => {
      await this.#db.delete(depositMovement).where(eq(depositMovement.depositId, depositId));
      await this.#db.delete(deposit).where(eq(deposit.id, depositId));
    });
  }

  /** F-6.4/UC-56: `POST /api/offset` writes `offset_record` and its allocations on both sides (domain/offset.ts) — this is that write's teardown. */
  trackCreatedOffset(offsetId: string): void {
    this.track(async () => {
      await this.#db.delete(offsetAllocation).where(eq(offsetAllocation.offsetId, offsetId));
      await this.#db.delete(offsetRecord).where(eq(offsetRecord.id, offsetId));
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
