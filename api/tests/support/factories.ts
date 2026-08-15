import { newId } from "@fleetsettle/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Writer } from "../../src/db/client.js";
import {
  accountingPeriod,
  adjustment,
  advance,
  advanceSettlement,
  appUser,
  attachment,
  bankingEvent,
  billingPeriod,
  business,
  businessMember,
  businessMemberInvite,
  businessSettings,
  capitalContribution,
  customer,
  dailyLease,
  dailyLeaseRate,
  dayRecord,
  deposit,
  depositMovement,
  driver,
  driverLinkInvite,
  expense,
  incident,
  incidentRecovery,
  insuranceClaim,
  lease,
  leaseExtension,
  managementFeeAgreement,
  mileageAssessment,
  mileageAssessmentSplit,
  mileagePackage,
  obligation,
  odometerReading,
  offsetAllocation,
  offsetRecord,
  openingBalanceBatch,
  openingBalanceEntry,
  openingBalancePosting,
  ownershipShare,
  partnerPayout,
  payment,
  paymentAllocation,
  paymentCorrection,
  trip,
  vehicle,
  vehicleArrangement,
  vehicleDayAllocation,
  vehicleDocument,
  writeOff,
  writeOffRecovery,
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

interface VehicleArrangementOverrides {
  effectiveFrom?: string;
  effectiveTo?: string;
}

interface DriverOverrides {
  name?: string;
  dailyFeeMinor?: bigint;
  licenceExpiry?: string;
}

interface CustomerOverrides {
  name?: string;
  mobile?: string;
}

interface LeaseOverrides {
  startDate?: string;
  endDate?: string;
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

interface MileageAssessmentOverrides {
  drivenKm?: number;
  combinedAllowanceKm?: number;
  excessKm?: number;
  excessAmountMinor?: bigint;
}

interface DailyLeaseOverrides {
  patternType?: "every_day" | "alternate" | "weekdays";
  patternWeekdays?: number[];
  effectiveFrom?: string;
  effectiveTo?: string;
  dailyLeaseAmountMinor?: bigint;
}

interface ManagementFeeAgreementOverrides {
  effectiveFrom?: string;
  effectiveTo?: string;
  monthlyAmountMinor?: bigint;
}

interface DayRecordOverrides {
  state?:
    "open" | "ran_paid_full" | "ran_paid_short" | "ran_unpaid" | "did_not_run" | "paused_for_trip";
  earnedMinor?: bigint;
  expectedMinor?: bigint;
  // `day_record_check2`: a `did_not_run` row requires one (§1.2 A: 'on_charter' deliberately absent).
  lostReason?:
    "breakdown" | "driver_day_off" | "driver_ill" | "public_holiday" | "no_passengers" | "other";
  // GAP-118, migration 0022: no live write path voids a day_record yet (that's
  // Wave 2's own build) — this is the only way a test can set up "a stale
  // future card was voided off a superseded lease" ahead of it.
  voided?: boolean;
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
      // A7/GAP-16: attachment.business_id REFERENCES business(id), no
      // cascade. Swept by businessId, not tracked per-row, the same
      // reason trackCreatedBusinessMemberInvites sweeps rather than tracks
      // — tests that upload through the real endpoint have no factory
      // call of their own to hang a per-row track() off.
      await this.#db.delete(attachment).where(eq(attachment.businessId, id));
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

  /** UC-92: same reasoning as `setAutoWaiveThreshold` above, for a test that needs a paperwork-warning window narrower than the 30-day default. */
  async setPaperworkWarnDays(businessId: string, days: number): Promise<void> {
    await this.#db.insert(businessSettings).values({ businessId, paperworkWarnDays: days });
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

  /**
   * §6.7's borne-by default is keyed on the vehicle's arrangement —
   * `createVehicle()` alone leaves it unset (P2's own bare factory does not
   * assume any particular test needs one). Overridable `effectiveFrom`/`effectiveTo`
   * (GAP-56 tests) so a second call can set up a historical arrangement
   * change — the table's own `EXCLUDE USING gist` constraint (migration
   * `0001`) requires non-overlapping ranges, so a second open-ended row
   * needs the first one closed first.
   */
  async setVehicleArrangement(
    vehicleId: string,
    arrangement: "A" | "B" | "C",
    overrides: VehicleArrangementOverrides = {},
  ): Promise<void> {
    const id = newId();
    await this.#db.insert(vehicleArrangement).values({
      id,
      vehicleId,
      arrangement,
      effectiveFrom: overrides.effectiveFrom ?? "2026-01-01",
      effectiveTo: overrides.effectiveTo,
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
      licenceExpiry: overrides.licenceExpiry,
    });
    this.track(async () => {
      await this.#db.delete(driver).where(eq(driver.id, id));
    });
    return id;
  }

  /** UC-92: one row per `(vehicle_id, doc_type)`, mirroring `upsertVehicleDocument`'s own unique target — for paperwork-warning tests that need a document row without going through the vehicle-setup endpoint. */
  async createVehicleDocument(
    vehicleId: string,
    overrides: { docType?: string; expiryDate?: string } = {},
  ): Promise<string> {
    const id = newId();
    await this.#db.insert(vehicleDocument).values({
      id,
      vehicleId,
      docType: overrides.docType ?? "insurance",
      expiryDate: overrides.expiryDate ?? "2026-08-01",
    });
    this.track(async () => {
      await this.#db.delete(vehicleDocument).where(eq(vehicleDocument.id, id));
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
      endDate: overrides.endDate,
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

  /** A bare `mileage_assessment` — for tests exercising a lease's dues (Web-P6a's `GET /{id}/obligation`) without the full odometer-reading + rate-computation flow. `toReadingId` must be a real `odometer_reading` row (its own FK) — `createOdometerReading` above is the usual source. */
  async createMileageAssessment(
    businessId: string,
    leaseId: string,
    periodId: string,
    toReadingId: string,
    overrides: MileageAssessmentOverrides = {},
  ): Promise<string> {
    const id = newId();
    await this.#db.insert(mileageAssessment).values({
      id,
      leaseId,
      businessId,
      toReadingId,
      drivenKm: overrides.drivenKm ?? 1000,
      combinedAllowanceKm: overrides.combinedAllowanceKm ?? 900,
      excessKm: overrides.excessKm ?? 100,
      excessAmountMinor: overrides.excessAmountMinor ?? 5_000_00n,
      postedPeriodId: periodId,
    });
    this.track(async () => {
      await this.#db.delete(mileageAssessment).where(eq(mileageAssessment.id, id));
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
      patternWeekdays: overrides.patternWeekdays,
      effectiveFrom: overrides.effectiveFrom ?? "2026-07-01",
      effectiveTo: overrides.effectiveTo,
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

  /** Bare `management_fee_agreement` — for tests that need one in place without going through `POST /api/management-fee-agreement`. */
  async createManagementFeeAgreement(
    vehicleId: string,
    managerUserId: string,
    overrides: ManagementFeeAgreementOverrides = {},
  ): Promise<string> {
    const id = newId();
    await this.#db.insert(managementFeeAgreement).values({
      id,
      vehicleId,
      managerUserId,
      monthlyAmountMinor: overrides.monthlyAmountMinor ?? 15_000_00n,
      effectiveFrom: overrides.effectiveFrom ?? "2026-07-01",
      effectiveTo: overrides.effectiveTo,
    });
    this.track(async () => {
      await this.#db.delete(managementFeeAgreement).where(eq(managementFeeAgreement.id, id));
    });
    return id;
  }

  /**
   * A bare `day_record` in `open` state — the shape a card-generation cron
   * (P13) would leave behind. Nothing in this phase's endpoints ever produces
   * a plain `open` row (`confirmDay` always writes an already-confirmed
   * state), so this is the only way a test can set up "a trip booked inside
   * the horizon has existing day records to pause" (F-5.1) without P13.
   */
  async createDayRecord(
    businessId: string,
    periodId: string,
    dailyLeaseId: string,
    vehicleId: string,
    driverId: string,
    businessDate: string,
    overrides: DayRecordOverrides = {},
  ): Promise<string> {
    const id = newId();
    // day_record_void_check (migration 0022) requires all three or none —
    // a throwaway app_user, same reasoning mintUser's own doc comment gives
    // for never tearing one down (audit_log FK-references it permanently
    // anyway, in the disposable test branch).
    let voidedBy: string | undefined;
    if (overrides.voided) {
      voidedBy = newId();
      await this.#db
        .insert(appUser)
        .values({ id: voidedBy, asgardeoSub: `test-sub-${voidedBy}`, displayName: "Test voider" });
    }
    await this.#db.insert(dayRecord).values({
      id,
      businessId,
      dailyLeaseId,
      vehicleId,
      driverId,
      businessDate,
      state: overrides.state ?? "open",
      earnedMinor: overrides.earnedMinor,
      expectedMinor: overrides.expectedMinor ?? 5_000_00n,
      lostReason: overrides.lostReason,
      postedPeriodId: periodId,
      ...(overrides.voided
        ? {
            voidedAt: sql`now()`,
            voidedReason: "GAP-118 test fixture — a stale card off a superseded lease",
            voidedBy,
          }
        : {}),
    });
    this.track(async () => {
      await this.#db.delete(dayRecord).where(eq(dayRecord.id, id));
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
      vehicleId?: string;
      kind?:
        | "rent"
        | "mileage_excess"
        | "daily_amount"
        | "driver_fee"
        | "post_closure_charge"
        | "customer_contribution"
        | "management_fee"
        | "other";
      amountMinor?: bigint;
      settledMinor?: bigint;
      waivedMinor?: bigint;
      dueOn?: string;
      status?: "pending" | "part_paid" | "paid" | "waived" | "written_off";
      sourceType?: string;
      sourceId?: string;
    } = {},
  ): Promise<string> {
    const id = newId();
    const partyType = overrides.partyType ?? "driver";
    await this.#db.insert(obligation).values({
      id,
      businessId,
      vehicleId: overrides.vehicleId,
      direction: overrides.direction ?? "owed_to_us",
      partyType,
      partyDriverId: partyType === "driver" ? overrides.driverId : undefined,
      partyCustomerId: partyType === "customer" ? overrides.customerId : undefined,
      kind: overrides.kind ?? "other",
      sourceType: overrides.sourceType ?? "test_fixture",
      sourceId: overrides.sourceId,
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

  /** A bare `adjustment` row — for report tests (P11/UC-77) that need a waiver/goodwill figure without going through `POST /api/adjustment`. */
  async createAdjustment(
    businessId: string,
    periodId: string,
    obligationId: string,
    overrides: {
      adjustmentType?:
        | "waiver"
        | "auto_waiver"
        | "goodwill"
        | "rounding"
        | "agreed_discount"
        | "late_fee"
        | "extra_charge";
      amountMinor?: bigint;
      sign?: 1 | -1;
      /** GAP-72's own boundary tests — the column defaults to `now()`, which cannot land on the edge of a report window on demand. */
      createdAt?: string;
      /** GAP-73, migration 0017. Defaults to `createdAt`'s own date when given, since these boundary tests already use `createdAt` as "when this happened". */
      occurredOn?: string;
    } = {},
  ): Promise<string> {
    const id = newId();
    await this.#db.insert(adjustment).values({
      id,
      businessId,
      obligationId,
      adjustmentType: overrides.adjustmentType ?? "waiver",
      amountMinor: overrides.amountMinor ?? 1_000n,
      sign: overrides.sign ?? -1,
      occurredOn: overrides.occurredOn ?? overrides.createdAt?.slice(0, 10) ?? "2026-07-05",
      postedPeriodId: periodId,
      ...(overrides.createdAt !== undefined ? { createdAt: overrides.createdAt } : {}),
    });
    this.track(async () => {
      await this.#db.delete(adjustment).where(eq(adjustment.id, id));
    });
    return id;
  }

  /** A bare, already-closed `trip` row — for report tests (P11/UC-71) that need a closed trip's own figures without a real book/close round trip. */
  async createTrip(
    businessId: string,
    vehicleId: string,
    periodId: string,
    overrides: {
      driverId?: string;
      agreedAmountMinor?: bigint;
      driverFeeMinor?: bigint;
      startDate?: string;
      endDate?: string;
      closingDate?: string;
      openingOdometerId?: string;
      closingOdometerId?: string;
    } = {},
  ): Promise<string> {
    const id = newId();
    await this.#db.insert(trip).values({
      id,
      businessId,
      vehicleId,
      driverId: overrides.driverId,
      status: "closed",
      startDate: overrides.startDate ?? "2026-07-01",
      endDate: overrides.endDate ?? "2026-07-03",
      closingDate: overrides.closingDate ?? overrides.endDate ?? "2026-07-03",
      agreedAmountMinor: overrides.agreedAmountMinor ?? 60_000n,
      driverFeeMinor: overrides.driverFeeMinor ?? 9_000n,
      openingOdometerId: overrides.openingOdometerId,
      closingOdometerId: overrides.closingOdometerId,
      postedPeriodId: periodId,
    });
    this.track(async () => {
      await this.#db.delete(trip).where(eq(trip.id, id));
    });
    return id;
  }

  /** A bare `advance` row — for driver-view tests (P12/F-6.8) needing a road-expense advance without a real book/close round trip. */
  async createAdvance(
    businessId: string,
    periodId: string,
    driverId: string,
    overrides: {
      amountMinor?: bigint;
      issuedOn?: string;
      status?: "open" | "part_settled" | "settled";
    } = {},
  ): Promise<string> {
    const id = newId();
    await this.#db.insert(advance).values({
      id,
      businessId,
      driverId,
      amountMinor: overrides.amountMinor ?? 5_000n,
      issuedOn: overrides.issuedOn ?? "2026-07-05",
      status: overrides.status ?? "open",
      postedPeriodId: periodId,
    });
    this.track(async () => {
      await this.#db.delete(advanceSettlement).where(eq(advanceSettlement.advanceId, id));
      await this.#db.delete(advance).where(eq(advance.id, id));
    });
    return id;
  }

  /** A bare `offset_record` row — for driver-view tests (P12/F-6.8) needing an offset without going through `POST /api/offset`. */
  async createOffsetRecord(
    businessId: string,
    periodId: string,
    driverId: string,
    createdByUserId: string,
    overrides: { amountMinor?: bigint; occurredOn?: string } = {},
  ): Promise<string> {
    const id = newId();
    await this.#db.insert(offsetRecord).values({
      id,
      businessId,
      driverId,
      amountMinor: overrides.amountMinor ?? 1_000n,
      occurredOn: overrides.occurredOn ?? "2026-07-05",
      postedPeriodId: periodId,
      createdBy: createdByUserId,
    });
    this.track(async () => {
      await this.#db.delete(offsetAllocation).where(eq(offsetAllocation.offsetId, id));
      await this.#db.delete(offsetRecord).where(eq(offsetRecord.id, id));
    });
    return id;
  }

  /** A bare `deposit` row, held by default — for report tests (P11/UC-75) needing a deposits-held liability figure, F-2.7/P13 tests needing one already in `hold_window` with a release date, and Web-P6d tests needing one attached to a lease (`findDepositForLease`'s own lookup column). */
  async createDeposit(
    businessId: string,
    overrides: {
      partyType?: "customer" | "driver";
      customerId?: string;
      driverId?: string;
      leaseId?: string;
      status?: "held" | "hold_window" | "released" | "applied" | "retained";
      holdReleaseDate?: string;
    } = {},
  ): Promise<string> {
    const id = newId();
    const partyType = overrides.partyType ?? "customer";
    await this.#db.insert(deposit).values({
      id,
      businessId,
      partyType,
      partyCustomerId: partyType === "customer" ? overrides.customerId : undefined,
      partyDriverId: partyType === "driver" ? overrides.driverId : undefined,
      leaseId: overrides.leaseId,
      status: overrides.status ?? "held",
      holdReleaseDate: overrides.holdReleaseDate,
    });
    this.track(async () => {
      await this.#db.delete(depositMovement).where(eq(depositMovement.depositId, id));
      await this.#db.delete(deposit).where(eq(deposit.id, id));
    });
    return id;
  }

  /** A movement against an existing `createDeposit()` row — `sumDepositMovements`'s own `taken`/`topped_up` add, everything else subtracts. */
  async createDepositMovement(
    businessId: string,
    periodId: string,
    depositId: string,
    overrides: { movementType?: string; amountMinor?: bigint; occurredOn?: string } = {},
  ): Promise<string> {
    const id = newId();
    await this.#db.insert(depositMovement).values({
      id,
      businessId,
      depositId,
      movementType: overrides.movementType ?? "taken",
      amountMinor: overrides.amountMinor ?? 5_000n,
      occurredOn: overrides.occurredOn ?? "2026-07-05",
      postedPeriodId: periodId,
    });
    // Cleanup rides on the parent `createDeposit()`'s own tracked teardown.
    return id;
  }

  /** A bare `vehicle_day_allocation` row — for report tests (P11/UC-79) needing lease/trip occupancy without a real lease or trip. `sourceId` carries no FK (DM §2: polymorphic), so an arbitrary id satisfies the `source_type` CHECK without a real source row. */
  async createVehicleDayAllocation(
    businessId: string,
    vehicleId: string,
    businessDate: string,
    arrangement: "A" | "B" | "C",
    sourceId?: string,
  ): Promise<string> {
    const id = newId();
    const sourceType = arrangement === "A" ? "lease" : arrangement === "B" ? "daily_lease" : "trip";
    await this.#db.insert(vehicleDayAllocation).values({
      id,
      businessId,
      vehicleId,
      businessDate,
      arrangement,
      sourceType,
      sourceId: sourceId ?? newId(),
    });
    this.track(async () => {
      await this.#db.delete(vehicleDayAllocation).where(eq(vehicleDayAllocation.id, id));
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
   *
   * `app_user` itself is never deleted here — see `mintUser`'s own comment
   * in `support/auth.ts`: once this user's writes are attributed in
   * `audit_log.changed_by`, that row is permanent (the table's own `DO
   * INSTEAD NOTHING` delete rule, W-50/INV-28), so the referencing
   * `app_user` row is too. `userId` is accepted for the caller's own
   * bookkeeping symmetry with `mintUser`, but unused here.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- userId kept for call-site symmetry with mintUser; see the comment above for why it's no longer torn down
  trackCreatedBusiness(businessId: string, userId: string): void {
    this.track(async () => {
      // A7/GAP-16: attachment.business_id REFERENCES business(id), no cascade —
      // a test that uploads through the real endpoint (rather than a factory
      // method with its own track()) leaves rows here that must clear before
      // the business itself can go.
      await this.#db.delete(attachment).where(eq(attachment.businessId, businessId));
      await this.#db.delete(accountingPeriod).where(eq(accountingPeriod.businessId, businessId));
      await this.#db.delete(businessSettings).where(eq(businessSettings.businessId, businessId));
      await this.#db.delete(businessMember).where(eq(businessMember.businessId, businessId));
      await this.#db.delete(business).where(eq(business.id, businessId));
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

  /**
   * A11/W-57: `POST /api/business-member/invite` writes a single
   * `business_member_invite` row per call, and `POST /api/invite/redeem`
   * writes no row of its own on this table (it only ever updates one) — so
   * this sweeps by `businessId` rather than tracking a single row id, since
   * the invite response returns no id to track by. Must be tracked *after*
   * `createBusiness()`/the business is otherwise known to the context, so it
   * unwinds before the business's own teardown (FK: `business_member_invite
   * .business_id REFERENCES business(id)`, no cascade).
   */
  trackCreatedBusinessMemberInvites(businessId: string): void {
    this.track(async () => {
      await this.#db
        .delete(businessMemberInvite)
        .where(eq(businessMemberInvite.businessId, businessId));
    });
  }

  /** A11/W-57/F-1.8: the `driver_link_invite` counterpart to `trackCreatedBusinessMemberInvites` above — same reasoning, swept by `driverId`, tracked after the driver is known to the context so it unwinds first (FK: `driver_link_invite.driver_id REFERENCES driver(id)`). */
  trackCreatedDriverLinkInvites(driverId: string): void {
    this.track(async () => {
      await this.#db.delete(driverLinkInvite).where(eq(driverLinkInvite.driverId, driverId));
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

      // F-2.1/F-2.6: a deposit taken at handover (`deposit.lease_id`) — not
      // every lease takes one, but `deposit_lease_id_fkey` blocks deleting
      // the lease first when one exists.
      const deposits = await this.#db
        .select({ id: deposit.id })
        .from(deposit)
        .where(eq(deposit.leaseId, leaseId));
      const depositIds = deposits.map((d) => d.id);
      if (depositIds.length > 0) {
        await this.#db
          .delete(depositMovement)
          .where(inArray(depositMovement.depositId, depositIds));
        await this.#db.delete(deposit).where(inArray(deposit.id, depositIds));
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

  /** F-8.2/UC-93: `POST /api/payment/{id}/correct` writes a single row against an already-existing payment — this is that write's own teardown, registered after (so it unwinds before) the payment's own `trackCreatedPayment`. */
  trackCreatedPaymentCorrection(correctionId: string): void {
    this.track(async () => {
      await this.#db.delete(paymentCorrection).where(eq(paymentCorrection.id, correctionId));
    });
  }

  /** F-9.1/UC-98: `POST /api/accounting-period/close` opens a successor period that a test's own `ctx.createOpenPeriod()` never created — this is that row's own teardown. */
  trackCreatedPeriod(periodId: string): void {
    this.track(async () => {
      await this.#db.delete(accountingPeriod).where(eq(accountingPeriod.id, periodId));
    });
  }

  /** F-1.7: `POST /api/daily-lease` writes `daily_lease`, its first `daily_lease_rate`, and — since D-9/GAP-88 — the synchronous `vehicle_day_allocation`/`day_record` horizon (domain/dailyLease.ts) — this is that write's teardown, children before the `daily_lease` row `day_record`'s own FK requires. */
  trackCreatedDailyLease(dailyLeaseId: string): void {
    this.track(async () => {
      await this.#db.delete(dayRecord).where(eq(dayRecord.dailyLeaseId, dailyLeaseId));
      await this.#db
        .delete(vehicleDayAllocation)
        .where(eq(vehicleDayAllocation.sourceId, dailyLeaseId));
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

  /** P13/`generate-day-cards`: the cron's own bulk writes for one daily lease — pre-generated `day_record` rows (still `open`, no obligation to unwind yet) plus their `vehicle_day_allocation` counterparts. */
  trackGeneratedDailyLeaseCards(dailyLeaseId: string): void {
    this.track(async () => {
      await this.#db.delete(dayRecord).where(eq(dayRecord.dailyLeaseId, dailyLeaseId));
      await this.#db
        .delete(vehicleDayAllocation)
        .where(eq(vehicleDayAllocation.sourceId, dailyLeaseId));
    });
  }

  /** P13/`generate-day-cards`: the cron's own bulk `vehicle_day_allocation` writes for one lease — arrangement A has no `day_record` to unwind alongside it. */
  trackGeneratedLeaseCalendar(leaseId: string): void {
    this.track(async () => {
      await this.#db.delete(vehicleDayAllocation).where(eq(vehicleDayAllocation.sourceId, leaseId));
    });
  }

  /** A10a/`generate-management-fee`: the generator's own obligation write for one agreement — `source_id` is the agreement id, one row per period it has run against. */
  trackGeneratedManagementFeeObligations(agreementId: string): void {
    this.track(async () => {
      await this.#db
        .delete(obligation)
        .where(
          and(
            eq(obligation.sourceType, "management_fee_agreement"),
            eq(obligation.sourceId, agreementId),
          ),
        );
    });
  }

  /**
   * F-5.1/F-5.4/F-5.5: `POST /api/trip` writes `trip` and its full-range
   * `vehicle_day_allocation`; `.../close` adds the driver-fee `obligation`
   * and a closing `odometer_reading` (domain/trip.ts); `.../cancel` settles
   * any open advance instead (owned by whichever call issued the advance —
   * see `trackCreatedAdvance`) and never touches `posted_period_id`. This is
   * the one teardown for all of it — the `trip` row itself must go before
   * the `odometer_reading` rows it references via `opening/closing_odometer_id`.
   */
  trackCreatedTrip(tripId: string): void {
    this.track(async () => {
      const sourcedObligations = await this.#db
        .select({ id: obligation.id })
        .from(obligation)
        .where(and(eq(obligation.sourceType, "trip"), eq(obligation.sourceId, tripId)));
      const obligationIds = sourcedObligations.map((o) => o.id);
      if (obligationIds.length > 0) {
        await this.#db.delete(adjustment).where(inArray(adjustment.obligationId, obligationIds));
        await this.#db
          .delete(paymentAllocation)
          .where(inArray(paymentAllocation.obligationId, obligationIds));
        await this.#db.delete(obligation).where(inArray(obligation.id, obligationIds));
      }

      await this.#db.delete(vehicleDayAllocation).where(eq(vehicleDayAllocation.sourceId, tripId));
      await this.#db.delete(trip).where(eq(trip.id, tripId));
      await this.#db.delete(odometerReading).where(eq(odometerReading.tripId, tripId));
    });
  }

  /**
   * F-0.2: `PUT /api/opening-balance` writes `opening_balance_batch` and its
   * entries (domain/opening-balance.ts); a commit additionally materialises
   * into `obligation`/`deposit`+`deposit_movement`/`advance`/`payment`
   * (GAP-103), traced by `opening_balance_posting`. Swept by batch id
   * through that table rather than tracked per-row, since a post-commit
   * correction can leave more than one generation of postings behind (a
   * reversed one is kept, by design, for the reason `voidObligationById`
   * and its siblings keep every other void). `deposit_movement` is swept
   * by `depositId`, not by each posting's own `targetId` — a correction's
   * offsetting "refunded" entry shares the same `deposit`, but is never
   * itself a tracked posting, only the movement it corrects is.
   */
  trackCreatedOpeningBalance(batchId: string): void {
    this.track(async () => {
      const postings = await this.#db
        .select({
          targetTable: openingBalancePosting.targetTable,
          targetId: openingBalancePosting.targetId,
          depositId: openingBalancePosting.depositId,
        })
        .from(openingBalancePosting)
        .where(eq(openingBalancePosting.batchId, batchId));

      const idsFor = (table: string) =>
        postings.filter((p) => p.targetTable === table).map((p) => p.targetId);
      const obligationIds = idsFor("obligation");
      const advanceIds = idsFor("advance");
      const paymentIds = idsFor("payment");
      const depositIds = [
        ...new Set(postings.filter((p) => p.depositId !== null).map((p) => p.depositId as string)),
      ];

      if (obligationIds.length > 0) {
        await this.#db
          .delete(paymentAllocation)
          .where(inArray(paymentAllocation.obligationId, obligationIds));
        await this.#db.delete(obligation).where(inArray(obligation.id, obligationIds));
      }
      if (advanceIds.length > 0) {
        await this.#db
          .delete(advanceSettlement)
          .where(inArray(advanceSettlement.advanceId, advanceIds));
        await this.#db.delete(advance).where(inArray(advance.id, advanceIds));
      }
      if (paymentIds.length > 0)
        await this.#db.delete(payment).where(inArray(payment.id, paymentIds));
      if (depositIds.length > 0) {
        await this.#db
          .delete(depositMovement)
          .where(inArray(depositMovement.depositId, depositIds));
        await this.#db.delete(deposit).where(inArray(deposit.id, depositIds));
      }

      await this.#db
        .delete(openingBalancePosting)
        .where(eq(openingBalancePosting.batchId, batchId));
      await this.#db.delete(openingBalanceEntry).where(eq(openingBalanceEntry.batchId, batchId));
      await this.#db.delete(openingBalanceBatch).where(eq(openingBalanceBatch.id, batchId));
    });
  }

  /**
   * F-3.1/F-3.2/F-3.3: `POST /api/expense` writes the expense row, plus
   * (GAP-30) an `odometer_reading` row when a fuel fill's own reading was
   * given — pass the create response's `odometerReadingId` so both clear
   * before a tracked vehicle's own teardown runs (LIFO order).
   */
  trackCreatedExpense(expenseId: string, odometerReadingId?: string | null): void {
    this.track(async () => {
      await this.#db.delete(expense).where(eq(expense.id, expenseId));
      if (odometerReadingId) {
        await this.#db.delete(odometerReading).where(eq(odometerReading.id, odometerReadingId));
      }
    });
  }

  /** F-1.9/UC-18: `POST /api/mileage-package` writes a single row — no lease ever references it by id (its own copy lives on `lease` itself), so this is a leaf-table teardown, nothing to cascade. */
  trackCreatedMileagePackage(id: string): void {
    this.track(async () => {
      await this.#db.delete(mileagePackage).where(eq(mileagePackage.id, id));
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

  /** F-1.3/UC-02: `POST /api/ownership-share` writes one row per owner (domain/partner.ts) — this is that write's teardown, for every share a test created in one call. */
  trackCreatedOwnershipShares(shareIds: string[]): void {
    this.track(async () => {
      if (shareIds.length === 0) return;
      await this.#db.delete(ownershipShare).where(inArray(ownershipShare.id, shareIds));
    });
  }

  /** F-1.3/UC-02: `POST /api/capital-contribution` writes a single row — this is that write's teardown. */
  trackCreatedCapitalContribution(contributionId: string): void {
    this.track(async () => {
      await this.#db.delete(capitalContribution).where(eq(capitalContribution.id, contributionId));
    });
  }

  /** F-1.4/UC-03: `POST /api/management-fee-agreement` (+ `.../revoke`) writes a single row, revoked in place — this is that write's teardown. */
  trackCreatedManagementFeeAgreement(agreementId: string): void {
    this.track(async () => {
      await this.#db
        .delete(managementFeeAgreement)
        .where(eq(managementFeeAgreement.id, agreementId));
    });
  }

  /** F-7.4/UC-65: `POST /api/banking-event` writes a single row — this is that write's teardown. */
  trackCreatedBankingEvent(bankingEventId: string): void {
    this.track(async () => {
      await this.#db.delete(bankingEvent).where(eq(bankingEvent.id, bankingEventId));
    });
  }

  /** F-7.2/UC-63: `POST /api/partner-payout` writes a single row — this is that write's teardown. */
  trackCreatedPartnerPayout(payoutId: string): void {
    this.track(async () => {
      await this.#db.delete(partnerPayout).where(eq(partnerPayout.id, payoutId));
    });
  }

  /**
   * F-8.3/UC-90: `POST /api/write-off` writes a single row; `.../recovery`
   * adds a `write_off_recovery` row and the `payment` it was recorded
   * through (domain/write-off.ts, deliberately never allocated against any
   * obligation). This one teardown re-queries by `writeOffId` at cleanup
   * time, catching whatever recoveries the test added along the way — the
   * same convention `trackCreatedIncident` already uses.
   */
  trackCreatedWriteOff(writeOffId: string): void {
    this.track(async () => {
      const recoveries = await this.#db
        .select({ paymentId: writeOffRecovery.paymentId })
        .from(writeOffRecovery)
        .where(eq(writeOffRecovery.writeOffId, writeOffId));
      await this.#db.delete(writeOffRecovery).where(eq(writeOffRecovery.writeOffId, writeOffId));
      for (const { paymentId } of recoveries) {
        await this.#db.delete(payment).where(eq(payment.id, paymentId));
      }
      await this.#db.delete(writeOff).where(eq(writeOff.id, writeOffId));
    });
  }

  /** F-8.4/UC-91: `POST /api/post-closure-charge` writes a single `obligation` row (`kind='post_closure_charge'`) — this is that write's teardown. */
  trackCreatedPostClosureCharge(obligationId: string): void {
    this.track(async () => {
      await this.#db.delete(obligation).where(eq(obligation.id, obligationId));
    });
  }

  /**
   * F-3.4/UC-12: `POST /api/incident` opens the container; every later edit
   * (off-road/extend, a customer contribution, an insurance claim) adds a
   * `lease_extension`, `incident_recovery` or `insurance_claim` row against
   * the same `incidentId`, days or weeks apart. This one teardown re-queries
   * by `incidentId` at cleanup time rather than capturing a fixed set of
   * child ids up front, so it catches whatever the test added along the way,
   * child rows before the incident itself (all three carry a `NOT NULL
   * REFERENCES incident(id)`; `expense.incident_id` does not, so an
   * incident-tagged expense is still that test's own `trackCreatedExpense`
   * to clean up). Since D-9/GAP-10, a customer-sourced recovery also carries
   * an `obligation_id` (migration `0012`'s real FK), and `recordRecoveryReceived`
   * may have paid it — so the `payment`/`payment_allocation` pair and the
   * `obligation` itself are unwound first, grandchildren before children.
   */
  trackCreatedIncident(incidentId: string): void {
    this.track(async () => {
      const recoveries = await this.#db
        .select({ obligationId: incidentRecovery.obligationId })
        .from(incidentRecovery)
        .where(eq(incidentRecovery.incidentId, incidentId));
      const obligationIds = recoveries
        .map((r) => r.obligationId)
        .filter((id): id is string => id !== null);

      let paymentIds: string[] = [];
      if (obligationIds.length > 0) {
        const allocations = await this.#db
          .select({ paymentId: paymentAllocation.paymentId })
          .from(paymentAllocation)
          .where(inArray(paymentAllocation.obligationId, obligationIds));
        paymentIds = allocations.map((a) => a.paymentId);
        await this.#db
          .delete(paymentAllocation)
          .where(inArray(paymentAllocation.obligationId, obligationIds));
      }

      // incident_recovery.obligation_id (migration 0012) must clear before
      // the obligation row it points to can go.
      await this.#db.delete(incidentRecovery).where(eq(incidentRecovery.incidentId, incidentId));
      await this.#db.delete(insuranceClaim).where(eq(insuranceClaim.incidentId, incidentId));
      await this.#db.delete(leaseExtension).where(eq(leaseExtension.incidentId, incidentId));

      for (const paymentId of paymentIds) {
        await this.#db.delete(payment).where(eq(payment.id, paymentId));
      }
      if (obligationIds.length > 0) {
        await this.#db.delete(obligation).where(inArray(obligation.id, obligationIds));
      }
      await this.#db.delete(incident).where(eq(incident.id, incidentId));
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
