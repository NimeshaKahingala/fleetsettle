import { newId } from "@fleetsettle/shared";
import { and, eq, inArray } from "drizzle-orm";
import type { Writer } from "../../src/db/client.js";
import {
  accountingPeriod,
  adjustment,
  advance,
  advanceSettlement,
  appUser,
  billingPeriod,
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
  mileageAssessment,
  mileageAssessmentSplit,
  obligation,
  odometerReading,
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
  mileageDailyLimitKm?: number;
  mileageExcessRateMinor?: bigint;
}

interface BillingPeriodOverrides {
  seq?: number;
  periodStart?: string;
  periodEnd?: string;
  rentAmountMinor?: bigint;
  allowanceKm?: number;
}

interface OdometerReadingOverrides {
  leaseId?: string;
  source?: "photo" | "in_person" | "reported" | "at_return";
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

  /** OQ-3/W-43: the bare `createBusiness()` factory writes no `business_settings` row, so `findBusinessSettings` sees `undefined` and every threshold defaults to zero (waive nothing) — this is for tests that need a specific auto-waive threshold instead. */
  async setAutoWaiveThreshold(businessId: string, amountMinor: bigint): Promise<void> {
    await this.#db
      .insert(businessSettings)
      .values({ businessId, autoWaiveThresholdMinor: amountMinor });
    this.track(async () => {
      await this.#db.delete(businessSettings).where(eq(businessSettings.businessId, businessId));
    });
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
      mileageDailyLimitKm: overrides.mileageDailyLimitKm,
      mileageExcessRateMinor: overrides.mileageExcessRateMinor,
    });
    this.track(async () => {
      await this.#db.delete(lease).where(eq(lease.id, id));
    });
    return id;
  }

  /** A bare `billing_period` row — for tests that want a period's numbers under their own control rather than derived from `generateNextBillingPeriod`'s calendar arithmetic. */
  async createBillingPeriod(
    leaseId: string,
    overrides: BillingPeriodOverrides = {},
  ): Promise<string> {
    const id = newId();
    await this.#db.insert(billingPeriod).values({
      id,
      leaseId,
      seq: overrides.seq ?? 1,
      periodStart: overrides.periodStart ?? "2026-07-01",
      periodEnd: overrides.periodEnd ?? "2026-07-31",
      rentAmountMinor: overrides.rentAmountMinor ?? 50_000_00n,
      allowanceKm: overrides.allowanceKm,
    });
    this.track(async () => {
      await this.#db.delete(billingPeriod).where(eq(billingPeriod.id, id));
    });
    return id;
  }

  /** A bare `odometer_reading` — for tests setting up the "previous reading" a mileage assessment starts from, without going through lease creation's own handover write. */
  async createOdometerReading(
    businessId: string,
    vehicleId: string,
    readingKm: number,
    readOn: string,
    overrides: OdometerReadingOverrides = {},
  ): Promise<string> {
    const id = newId();
    await this.#db.insert(odometerReading).values({
      id,
      businessId,
      vehicleId,
      readingKm,
      readOn,
      source: overrides.source ?? "in_person",
      leaseId: overrides.leaseId,
    });
    this.track(async () => {
      await this.#db.delete(odometerReading).where(eq(odometerReading.id, id));
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

  /** A bare `obligation` row — for tests exercising adjustment/offset/payment against a fact that didn't arrive via `confirmDay` (P3), `generateNextBillingPeriod` (P5) or a later phase's own writer. */
  async createObligation(
    businessId: string,
    periodId: string,
    overrides: {
      direction?: "owed_to_us" | "owed_by_us";
      partyType?: "customer" | "driver";
      driverId?: string;
      customerId?: string;
      amountMinor?: bigint;
      settledMinor?: bigint;
      waivedMinor?: bigint;
      dueOn?: string;
      status?: "pending" | "part_paid" | "paid" | "waived" | "written_off";
    } = {},
  ): Promise<string> {
    const id = newId();
    const partyType = overrides.partyType ?? "driver";
    await this.#db.insert(obligation).values({
      id,
      businessId,
      direction: overrides.direction ?? "owed_to_us",
      partyType,
      partyDriverId: partyType === "driver" ? overrides.driverId : undefined,
      partyCustomerId: partyType === "customer" ? overrides.customerId : undefined,
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

  /**
   * F-2.1/F-2.3/UC-10/UC-14: `POST /api/lease` writes the lease, its handover
   * `odometer_reading` and its first `billing_period` (plus the rent
   * obligation that raises) in one transaction (domain/lease.ts); later
   * calls to `POST /api/lease/{id}/billing-period` and
   * `POST /api/mileage-assessment` add more of each, plus mileage
   * assessments, their splits, and an `auto_waiver` adjustment when one
   * applied. This is the one teardown for all of it, child-before-parent —
   * for tests that go through the endpoints rather than `createLease()`.
   */
  trackCreatedLease(leaseId: string): void {
    this.track(async () => {
      const assessments = await this.#db
        .select({ id: mileageAssessment.id })
        .from(mileageAssessment)
        .where(eq(mileageAssessment.leaseId, leaseId));
      const assessmentIds = assessments.map((a) => a.id);

      const periods = await this.#db
        .select({ id: billingPeriod.id })
        .from(billingPeriod)
        .where(eq(billingPeriod.leaseId, leaseId));
      const periodIds = periods.map((p) => p.id);

      if (assessmentIds.length > 0) {
        await this.#db
          .delete(mileageAssessmentSplit)
          .where(inArray(mileageAssessmentSplit.assessmentId, assessmentIds));
      }

      const sourcedObligationIds: string[] = [];
      if (assessmentIds.length > 0) {
        const rows = await this.#db
          .select({ id: obligation.id })
          .from(obligation)
          .where(
            and(
              eq(obligation.sourceType, "mileage_assessment"),
              inArray(obligation.sourceId, assessmentIds),
            ),
          );
        sourcedObligationIds.push(...rows.map((r) => r.id));
      }
      if (periodIds.length > 0) {
        const rows = await this.#db
          .select({ id: obligation.id })
          .from(obligation)
          .where(
            and(
              eq(obligation.sourceType, "billing_period"),
              inArray(obligation.sourceId, periodIds),
            ),
          );
        sourcedObligationIds.push(...rows.map((r) => r.id));
      }

      if (sourcedObligationIds.length > 0) {
        await this.#db
          .delete(adjustment)
          .where(inArray(adjustment.obligationId, sourcedObligationIds));
        await this.#db
          .delete(paymentAllocation)
          .where(inArray(paymentAllocation.obligationId, sourcedObligationIds));
        await this.#db.delete(obligation).where(inArray(obligation.id, sourcedObligationIds));
      }

      if (assessmentIds.length > 0) {
        await this.#db
          .delete(mileageAssessment)
          .where(inArray(mileageAssessment.id, assessmentIds));
      }
      await this.#db.delete(odometerReading).where(eq(odometerReading.leaseId, leaseId));
      if (periodIds.length > 0) {
        await this.#db.delete(billingPeriod).where(inArray(billingPeriod.id, periodIds));
      }
      await this.#db.delete(lease).where(eq(lease.id, leaseId));
    });
  }

  /** F-2.2/UC-11: `POST /api/payment` writes `payment` and its allocations (domain/payment.ts) — this is that write's teardown. It does not touch the obligations it settled; a caller that created those with `createObligation()` (or its own lease/day-record teardown) still owns tearing them down. */
  trackCreatedPayment(paymentId: string): void {
    this.track(async () => {
      await this.#db.delete(paymentAllocation).where(eq(paymentAllocation.paymentId, paymentId));
      await this.#db.delete(payment).where(eq(payment.id, paymentId));
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
