import { asBusinessDate, newId } from "@fleetsettle/shared";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import {
  dayRecord,
  leaseDayException,
  obligation,
  trip,
  vehicleDayAllocation,
} from "../../src/db/schema.js";
import { rollDueBillingPeriods } from "../../src/domain/billing-period.js";
import { generateDayCards } from "../../src/domain/day-card-generation.js";
import {
  generateManagementFeeObligationsForAllOpenPeriods,
  generateManagementFeeObligationsTx,
} from "../../src/domain/management-fee.js";
import { releaseAllExpiredHolds } from "../../src/domain/trip.js";
import { mintUser } from "../support/auth.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

/**
 * P13: `generate-day-cards` and `generate-billing-periods` (TS §4), called
 * directly rather than through HTTP — these are scheduled jobs, not
 * endpoints, and `domain/` functions already take `(db, …)` with no request
 * in sight (IG §3.1), so this is the same testing approach every other
 * domain function already gets.
 *
 * Both functions are deliberately unscoped by `business_id` (queries/scheduled.ts's
 * own doc comment explains why) — which means every assertion here reads back
 * rows scoped to **this test's own** vehicle/lease/daily-lease id, never the
 * function's returned aggregate counts. Those counts are correct, but they
 * also include whatever else happens to be active elsewhere in this shared
 * Neon test branch at the moment the test runs (IG §9.2: a fresh per-run
 * branch is what CI gives this job in production; this interactive session
 * has one long-lived branch instead), so an exact aggregate total is not a
 * safe thing to assert against.
 */
describe("scheduled jobs (P13)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  describe("generate-day-cards", () => {
    it("every_day: allocation across the full horizon, day_record clipped to the open period", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId, {
        periodStart: "2026-09-01",
        periodEnd: "2026-09-05",
      });
      const vehicleId = await ctx.createVehicle(businessId);
      const driverId = await ctx.createDriver(businessId);
      const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId, {
        patternType: "every_day",
        effectiveFrom: "2026-09-01",
        dailyLeaseAmountMinor: 6_000_00n,
      });
      ctx.trackGeneratedDailyLeaseCards(dailyLeaseId);

      const today = asBusinessDate("2026-09-01");
      await generateDayCards(db, today, 10); // 10 dates: 2026-09-01 .. 2026-09-10

      const allocations = await db
        .select({ businessDate: vehicleDayAllocation.businessDate })
        .from(vehicleDayAllocation)
        .where(eq(vehicleDayAllocation.sourceId, dailyLeaseId));
      expect(allocations).toHaveLength(10);

      const records = await db
        .select({
          businessDate: dayRecord.businessDate,
          expectedMinor: dayRecord.expectedMinor,
          state: dayRecord.state,
        })
        .from(dayRecord)
        .where(eq(dayRecord.dailyLeaseId, dailyLeaseId));
      expect(records).toHaveLength(5); // only 09-01..09-05 fall inside the open period
      expect(records.every((r) => r.state === "open" && r.expectedMinor === 6_000_00n)).toBe(true);
      expect(records.map((r) => r.businessDate).sort()).toEqual([
        "2026-09-01",
        "2026-09-02",
        "2026-09-03",
        "2026-09-04",
        "2026-09-05",
      ]);

      // Idempotent — a second run creates nothing further for this same daily lease.
      await generateDayCards(db, today, 10);
      const allocationsAfterSecondRun = await db
        .select({ businessDate: vehicleDayAllocation.businessDate })
        .from(vehicleDayAllocation)
        .where(eq(vehicleDayAllocation.sourceId, dailyLeaseId));
      expect(allocationsAfterSecondRun).toHaveLength(10);
      const recordsAfterSecondRun = await db
        .select({ businessDate: dayRecord.businessDate })
        .from(dayRecord)
        .where(eq(dayRecord.dailyLeaseId, dailyLeaseId));
      expect(recordsAfterSecondRun).toHaveLength(5);

      await ctx.cleanup();
    });

    it("GAP-20: a live lease_day_exception is skipped exactly like an off-pattern day — no allocation, no day_record", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId, {
        periodStart: "2026-09-01",
        periodEnd: "2026-09-05",
      });
      const vehicleId = await ctx.createVehicle(businessId);
      const driverId = await ctx.createDriver(businessId);
      const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId, {
        patternType: "every_day",
        effectiveFrom: "2026-09-01",
        dailyLeaseAmountMinor: 6_000_00n,
      });
      ctx.trackGeneratedDailyLeaseCards(dailyLeaseId);

      const exceptionId = newId();
      await db.insert(leaseDayException).values({
        id: exceptionId,
        businessId,
        dailyLeaseId,
        exceptionDate: "2026-09-03",
        reason: "Driver on leave",
      });
      ctx.trackCreatedLeaseDayException(exceptionId);

      const today = asBusinessDate("2026-09-01");
      await generateDayCards(db, today, 5); // 2026-09-01 .. 2026-09-05

      const allocations = await db
        .select({ businessDate: vehicleDayAllocation.businessDate })
        .from(vehicleDayAllocation)
        .where(eq(vehicleDayAllocation.sourceId, dailyLeaseId));
      expect(allocations.map((r) => r.businessDate).sort()).toEqual([
        "2026-09-01",
        "2026-09-02",
        "2026-09-04",
        "2026-09-05",
      ]);

      const records = await db
        .select({ businessDate: dayRecord.businessDate })
        .from(dayRecord)
        .where(eq(dayRecord.dailyLeaseId, dailyLeaseId));
      expect(records.map((r) => r.businessDate).sort()).toEqual([
        "2026-09-01",
        "2026-09-02",
        "2026-09-04",
        "2026-09-05",
      ]);

      await ctx.cleanup();
    });

    it("weekdays pattern: only the chosen weekdays get a card", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId, {
        periodStart: "2026-09-01",
        periodEnd: "2026-09-30",
      });
      const vehicleId = await ctx.createVehicle(businessId);
      const driverId = await ctx.createDriver(businessId);
      const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId, {
        patternType: "weekdays",
        patternWeekdays: [1, 3, 5], // Mon, Wed, Fri
        effectiveFrom: "2026-09-01",
      });
      ctx.trackGeneratedDailyLeaseCards(dailyLeaseId);

      // 2026-09-01 is a Tuesday; Mon/Wed/Fri in 09-01..09-10 are 09-02, 09-04, 09-07, 09-09.
      await generateDayCards(db, asBusinessDate("2026-09-01"), 10);

      const records = await db
        .select({ businessDate: dayRecord.businessDate })
        .from(dayRecord)
        .where(eq(dayRecord.dailyLeaseId, dailyLeaseId));
      expect(records.map((r) => r.businessDate).sort()).toEqual([
        "2026-09-02",
        "2026-09-04",
        "2026-09-07",
        "2026-09-09",
      ]);

      await ctx.cleanup();
    });

    it("alternate pattern: every other day starting from effective_from", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId, {
        periodStart: "2026-09-01",
        periodEnd: "2026-09-30",
      });
      const vehicleId = await ctx.createVehicle(businessId);
      const driverId = await ctx.createDriver(businessId);
      const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId, {
        patternType: "alternate",
        effectiveFrom: "2026-09-01",
      });
      ctx.trackGeneratedDailyLeaseCards(dailyLeaseId);

      await generateDayCards(db, asBusinessDate("2026-09-01"), 10);

      const records = await db
        .select({ businessDate: dayRecord.businessDate })
        .from(dayRecord)
        .where(eq(dayRecord.dailyLeaseId, dailyLeaseId));
      expect(records.map((r) => r.businessDate).sort()).toEqual([
        "2026-09-01",
        "2026-09-03",
        "2026-09-05",
        "2026-09-07",
        "2026-09-09",
      ]);

      await ctx.cleanup();
    });

    it("arrangement A: an open-ended lease extends its own calendar, with no day_record (arrangement A has none)", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId, {
        periodStart: "2026-09-01",
        periodEnd: "2026-09-30",
      });
      const vehicleId = await ctx.createVehicle(businessId);
      const customerId = await ctx.createCustomer(businessId);
      const leaseId = await ctx.createLease(businessId, vehicleId, customerId, {
        startDate: "2026-09-01",
        status: "active",
      });
      ctx.trackGeneratedLeaseCalendar(leaseId);

      await generateDayCards(db, asBusinessDate("2026-09-01"), 7);

      const allocations = await db
        .select({
          businessDate: vehicleDayAllocation.businessDate,
          arrangement: vehicleDayAllocation.arrangement,
        })
        .from(vehicleDayAllocation)
        .where(eq(vehicleDayAllocation.sourceId, leaseId));
      expect(allocations).toHaveLength(7);
      expect(allocations.every((a) => a.arrangement === "A")).toBe(true);

      await ctx.cleanup();
    });

    it("respects an existing allocation — a trip's own day is never overwritten", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId, {
        periodStart: "2026-09-01",
        periodEnd: "2026-09-30",
      });
      const vehicleId = await ctx.createVehicle(businessId);
      const driverId = await ctx.createDriver(businessId);
      const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId, {
        patternType: "every_day",
        effectiveFrom: "2026-09-01",
      });
      const tripAllocationId = await ctx.createVehicleDayAllocation(
        businessId,
        vehicleId,
        "2026-09-03",
        "C",
      );

      await generateDayCards(db, asBusinessDate("2026-09-01"), 5);

      const claimed = await db
        .select({ arrangement: vehicleDayAllocation.arrangement })
        .from(vehicleDayAllocation)
        .where(eq(vehicleDayAllocation.id, tripAllocationId));
      expect(claimed[0]?.arrangement).toBe("C");

      const allocationsForThisLease = await db
        .select({ businessDate: vehicleDayAllocation.businessDate })
        .from(vehicleDayAllocation)
        .where(eq(vehicleDayAllocation.sourceId, dailyLeaseId));
      expect(allocationsForThisLease.map((a) => a.businessDate).sort()).toEqual([
        "2026-09-01",
        "2026-09-02",
        "2026-09-04",
        "2026-09-05",
      ]); // every date in the 5-day window except 09-03, already claimed by the trip

      const dayRecordsOnThatDate = await db
        .select({ id: dayRecord.id })
        .from(dayRecord)
        .where(
          and(eq(dayRecord.dailyLeaseId, dailyLeaseId), eq(dayRecord.businessDate, "2026-09-03")),
        );
      expect(dayRecordsOnThatDate).toHaveLength(0);

      ctx.trackGeneratedDailyLeaseCards(dailyLeaseId);
      await ctx.cleanup();
    });
  });

  describe("generate-billing-periods", () => {
    it("catches up a lease several periods behind, one billing period and rent obligation per period", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId, {
        periodStart: "2026-06-01",
        periodEnd: "2026-09-30",
      });
      const vehicleId = await ctx.createVehicle(businessId);
      const customerId = await ctx.createCustomer(businessId);
      const leaseId = await ctx.createLease(businessId, vehicleId, customerId, {
        startDate: "2026-06-01",
        status: "active",
        rentAmountMinor: 50_000_00n,
      });
      await ctx.createBillingPeriod(leaseId, {
        seq: 1,
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
        rentAmountMinor: 50_000_00n,
      });

      const result = await rollDueBillingPeriods(db, "2026-09-01");
      const ownRolled = result.rolled.filter((r) => r.leaseId === leaseId);
      expect(ownRolled.map((r) => r.seq)).toEqual([2, 3, 4]);
      expect(result.errors.some((e) => e.leaseId === leaseId)).toBe(false);

      const newObligations = await db
        .select({ amountMinor: obligation.amountMinor })
        .from(obligation)
        .where(
          and(eq(obligation.sourceType, "billing_period"), eq(obligation.vehicleId, vehicleId)),
        );
      expect(newObligations).toHaveLength(3);
      expect(newObligations.every((o) => o.amountMinor === 50_000_00n)).toBe(true);

      // Idempotent — caught up, so a second call at the same "today" rolls nothing further for this lease.
      const second = await rollDueBillingPeriods(db, "2026-09-01");
      expect(second.rolled.some((r) => r.leaseId === leaseId)).toBe(false);

      ctx.trackCreatedLease(leaseId);
      await ctx.cleanup();
    }, 60_000); // this shared Neon test branch has accumulated other active leases over many phases' worth of runs; a genuinely global, unscoped catch-up loop over all of them is slower than one lease alone
  });

  /**
   * A10a/GAP-39/W-53: `sumVehicleCostsForPeriod` (queries/reports.ts) has
   * read `obligation.kind = 'management_fee'` since P7 with nothing ever
   * writing the row — this is that write's own test coverage.
   */
  describe("generate-management-fee", () => {
    it("one obligation per agreement effective on the period's own start date", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId, {
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
      });
      const vehicleA = await ctx.createVehicle(businessId, { registration: "A-1111" });
      const vehicleB = await ctx.createVehicle(businessId, { registration: "B-2222" });
      const manager1 = await mintUser(db, ctx, businessId, "manager");
      const manager2 = await mintUser(db, ctx, businessId, "manager");
      const agreement1 = await ctx.createManagementFeeAgreement(vehicleA, manager1.userId, {
        monthlyAmountMinor: 15_000_00n,
        effectiveFrom: "2026-01-01",
      });
      ctx.trackGeneratedManagementFeeObligations(agreement1);
      const agreement2 = await ctx.createManagementFeeAgreement(vehicleB, manager2.userId, {
        monthlyAmountMinor: 20_000_00n,
        effectiveFrom: "2026-01-01",
      });
      ctx.trackGeneratedManagementFeeObligations(agreement2);

      const result = await db.transaction((tx) =>
        generateManagementFeeObligationsTx(tx, {
          businessId,
          periodId,
          periodStart: asBusinessDate("2026-07-01"),
        }),
      );
      expect(result.created).toBe(2);

      const rows = await db
        .select({
          sourceId: obligation.sourceId,
          direction: obligation.direction,
          partyType: obligation.partyType,
          partyUserId: obligation.partyUserId,
          kind: obligation.kind,
          amountMinor: obligation.amountMinor,
          dueOn: obligation.dueOn,
          postedPeriodId: obligation.postedPeriodId,
        })
        .from(obligation)
        .where(eq(obligation.sourceType, "management_fee_agreement"));
      const own = rows.filter((r) => r.sourceId === agreement1 || r.sourceId === agreement2);
      expect(own).toHaveLength(2);
      const row1 = own.find((r) => r.sourceId === agreement1);
      expect(row1).toMatchObject({
        direction: "owed_by_us",
        partyType: "partner",
        partyUserId: manager1.userId,
        kind: "management_fee",
        amountMinor: 15_000_00n,
        dueOn: "2026-07-01",
        postedPeriodId: periodId,
      });
      const row2 = own.find((r) => r.sourceId === agreement2);
      expect(row2).toMatchObject({ partyUserId: manager2.userId, amountMinor: 20_000_00n });

      // Idempotent — a second run for the same period creates nothing further.
      const second = await db.transaction((tx) =>
        generateManagementFeeObligationsTx(tx, {
          businessId,
          periodId,
          periodStart: asBusinessDate("2026-07-01"),
        }),
      );
      expect(second.created).toBe(0);
      const rowsAfterSecondRun = await db
        .select({ sourceId: obligation.sourceId })
        .from(obligation)
        .where(eq(obligation.sourceType, "management_fee_agreement"));
      expect(
        rowsAfterSecondRun.filter((r) => r.sourceId === agreement1 || r.sourceId === agreement2),
      ).toHaveLength(2);

      await ctx.cleanup();
    });

    it("an agreement not yet effective, or already ended, raises nothing", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId, {
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
      });
      const vehicleId = await ctx.createVehicle(businessId);
      const manager = await mintUser(db, ctx, businessId, "manager");
      const notYetEffective = await ctx.createManagementFeeAgreement(vehicleId, manager.userId, {
        effectiveFrom: "2026-08-01",
      });
      ctx.trackGeneratedManagementFeeObligations(notYetEffective);
      const alreadyEnded = await ctx.createManagementFeeAgreement(vehicleId, manager.userId, {
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-06-30",
      });
      ctx.trackGeneratedManagementFeeObligations(alreadyEnded);

      const result = await db.transaction((tx) =>
        generateManagementFeeObligationsTx(tx, {
          businessId,
          periodId,
          periodStart: asBusinessDate("2026-07-01"),
        }),
      );
      expect(result.created).toBe(0);

      await ctx.cleanup();
    });

    it("generateManagementFeeObligationsForAllOpenPeriods catches up this business's own open period", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId, {
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
      });
      const vehicleId = await ctx.createVehicle(businessId);
      const manager = await mintUser(db, ctx, businessId, "manager");
      const agreementId = await ctx.createManagementFeeAgreement(vehicleId, manager.userId, {
        monthlyAmountMinor: 12_000_00n,
        effectiveFrom: "2026-01-01",
      });
      ctx.trackGeneratedManagementFeeObligations(agreementId);

      // Unscoped by business_id, like every other cron read (queries/scheduled.ts's
      // own doc comment) — so only the returned count reads this business's own
      // agreement; the aggregate `created` total also reflects whatever else is
      // open on this shared branch, the same caveat generate-billing-periods'
      // own test above already carries.
      await generateManagementFeeObligationsForAllOpenPeriods(db);

      const rows = await db
        .select({ amountMinor: obligation.amountMinor })
        .from(obligation)
        .where(
          and(
            eq(obligation.sourceType, "management_fee_agreement"),
            eq(obligation.sourceId, agreementId),
          ),
        );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.amountMinor).toBe(12_000_00n);

      await ctx.cleanup();
    }, 60_000); // unscoped across every business's own open period on this shared branch — see the identical note on generate-billing-periods above
  });

  /**
   * GAP-7/ST-5: the optimisation, not the mechanism — `bookTrip`/
   * `startDailyLease`/`startLease` already release a vehicle's own expired
   * holds synchronously. This is only "tidies up what nobody happened to
   * book around," unscoped by `business_id` like every other unit above.
   */
  describe("release-expired-holds", () => {
    it("cancels an expired hold and voids its own allocation, and leaves an unexpired hold untouched", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const vehicleId = await ctx.createVehicle(businessId);
      const stillGoodVehicleId = await ctx.createVehicle(businessId, { registration: "H-9999" });

      const expiredHoldId = newId();
      await db.insert(trip).values({
        id: expiredHoldId,
        businessId,
        vehicleId,
        status: "hold",
        startDate: "2026-09-01",
        endDate: "2026-09-02",
        holdExpiresOn: "2020-01-01",
      });
      ctx.trackCreatedTrip(expiredHoldId);
      const expiredAllocationId = newId();
      await db.insert(vehicleDayAllocation).values({
        id: expiredAllocationId,
        businessId,
        vehicleId,
        businessDate: "2026-09-01",
        arrangement: "C",
        sourceType: "trip",
        sourceId: expiredHoldId,
        isHold: true,
      });

      const stillGoodHoldId = newId();
      await db.insert(trip).values({
        id: stillGoodHoldId,
        businessId,
        vehicleId: stillGoodVehicleId,
        status: "hold",
        startDate: "2026-09-01",
        endDate: "2026-09-02",
        holdExpiresOn: "2099-01-01",
      });
      ctx.trackCreatedTrip(stillGoodHoldId);

      await releaseAllExpiredHolds(db, asBusinessDate("2026-08-01"));

      const [expiredRow] = await db
        .select({
          status: trip.status,
          cancelReason: trip.cancelReason,
          holdExpiresOn: trip.holdExpiresOn,
        })
        .from(trip)
        .where(eq(trip.id, expiredHoldId));
      expect(expiredRow).toMatchObject({
        status: "cancelled",
        cancelReason: "Hold expired",
        holdExpiresOn: null,
      });

      const [expiredAllocation] = await db
        .select({ voidedAt: vehicleDayAllocation.voidedAt })
        .from(vehicleDayAllocation)
        .where(eq(vehicleDayAllocation.id, expiredAllocationId));
      expect(expiredAllocation?.voidedAt).not.toBeNull();

      const [stillGoodRow] = await db
        .select({ status: trip.status })
        .from(trip)
        .where(eq(trip.id, stillGoodHoldId));
      expect(stillGoodRow?.status).toBe("hold");

      await ctx.cleanup();
    });
  });
});
