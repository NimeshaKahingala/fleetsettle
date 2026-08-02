import { newId } from "@fleetsettle/shared";
import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { bankingEvent, expense, ownershipShare, payment } from "../../src/db/schema.js";
import { mintLinkedDriver, mintUser, signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

function getReport(path: string, token: string) {
  return request(`/api/reports${path}`, bearer(token));
}

async function openIncident(token: string, vehicleId: string) {
  const res = await request("/api/incident", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify({ vehicleId, occurredOn: "2026-07-11" }),
  });
  const body: { id: string } = await res.json();
  return body.id;
}

async function recordOffRoad(token: string, incidentId: string, from: string, to: string) {
  return request(`/api/incident/${incidentId}/off-road`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify({ offRoadFrom: from, offRoadTo: to, rentTreatment: "continue" }),
  });
}

const PLACEHOLDER_UUID = "00000000-0000-4000-8000-000000000000";

/**
 * P11: the DM §15 report queries surfaced through `GET /api/reports/*`.
 * `viewReports` (owner/owner-manager/manager) gates seven; `viewOwnerOnlyReports`
 * (owner/owner-manager) gates two — UC-77/UC-79's own "Sees" line.
 */
describe("reports (P11)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  describe("vehicle month (UC-70)", () => {
    it("happy path — earned, costs, profit and each owner's share, per vehicle", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const vehicleA = await ctx.createVehicle(businessId, { registration: "A-1111" });
      const vehicleB = await ctx.createVehicle(businessId, { registration: "B-2222" });
      const customerId = await ctx.createCustomer(businessId);

      // Vehicle A: 50,000 earned (rent, kind-filtered), 9,000 cost (an `us`-borne expense) — 41,000 profit.
      await ctx.createObligation(businessId, periodId, {
        direction: "owed_to_us",
        partyType: "customer",
        customerId,
        vehicleId: vehicleA,
        kind: "rent",
        amountMinor: 50_000n,
        dueOn: "2026-07-01",
      });

      const costExpenseId = newId();
      await db.insert(expense).values({
        id: costExpenseId,
        businessId,
        vehicleId: vehicleA,
        category: "other",
        amountMinor: 9_000n,
        spentOn: "2026-07-10",
        borneBy: "us",
        postedPeriodId: periodId,
      });
      ctx.trackCreatedExpense(costExpenseId);

      const owner1 = await mintUser(db, ctx, businessId, "owner");
      const owner2 = await mintUser(db, ctx, businessId, "owner_manager");
      const share1Id = newId();
      const share2Id = newId();
      await db.insert(ownershipShare).values([
        {
          id: share1Id,
          vehicleId: vehicleA,
          userId: owner1.userId,
          shareBp: 6000,
          effectiveFrom: "2026-01-01",
        },
        {
          id: share2Id,
          vehicleId: vehicleA,
          userId: owner2.userId,
          shareBp: 4000,
          effectiveFrom: "2026-01-01",
        },
      ]);
      ctx.trackCreatedOwnershipShares([share1Id, share2Id]);

      const owner1Token = await signAccessToken(owner1.asgardeoSub);

      const res = await getReport(`/vehicle-month?periodId=${periodId}`, owner1Token);
      expect(res.status).toBe(200);
      const body: {
        period: { id: string };
        vehicles: {
          vehicleId: string;
          earnedMinor: string;
          costsMinor: string;
          profitMinor: string;
          ownerShares: { userId: string; shareBp: number; profitShareMinor: string }[];
        }[];
      } = await res.json();

      expect(body.period.id).toBe(periodId);
      const rowA = body.vehicles.find((v) => v.vehicleId === vehicleA);
      expect(rowA).toMatchObject({
        earnedMinor: "50000",
        costsMinor: "9000",
        profitMinor: "41000",
      });
      const shareByUser = new Map(rowA?.ownerShares.map((s) => [s.userId, s.profitShareMinor]));
      expect(shareByUser.get(owner1.userId)).toBe("24600");
      expect(shareByUser.get(owner2.userId)).toBe("16400");

      const rowB = body.vehicles.find((v) => v.vehicleId === vehicleB);
      expect(rowB).toMatchObject({ earnedMinor: "0", costsMinor: "0", profitMinor: "0" });
      expect(rowB?.ownerShares).toEqual([]);

      await ctx.cleanup();
    });

    it("single-vehicle scope via ?vehicleId=", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const vehicleId = await ctx.createVehicle(businessId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await getReport(
        `/vehicle-month?periodId=${periodId}&vehicleId=${vehicleId}`,
        token,
      );
      expect(res.status).toBe(200);
      const body: { vehicles: { vehicleId: string }[] } = await res.json();
      expect(body.vehicles).toHaveLength(1);
      expect(body.vehicles[0]?.vehicleId).toBe(vehicleId);

      await ctx.cleanup();
    });

    it("404 — no such accounting period in this business", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await getReport(`/vehicle-month?periodId=${PLACEHOLDER_UUID}`, token);
      expect(res.status).toBe(404);

      await ctx.cleanup();
    });

    it("404 — the vehicle belongs to another business", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
      const otherVehicleId = await ctx.createVehicle(otherBusinessId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await getReport(
        `/vehicle-month?periodId=${periodId}&vehicleId=${otherVehicleId}`,
        token,
      );
      expect(res.status).toBe(404);

      await ctx.cleanup();
    });
  });

  describe("trip ranking (UC-71)", () => {
    it("happy path — ranked by profit; profit-per-km is null with no closing odometer", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const vehicleId = await ctx.createVehicle(businessId, { registration: "T-9999" });

      // Trip 1: 60,000 agreed, 9,000 driver fee, 3,000 fuel cost, no odometer pair — profit 48,000, distance/ratio null.
      const trip1 = await ctx.createTrip(businessId, vehicleId, periodId, {
        agreedAmountMinor: 60_000n,
        driverFeeMinor: 9_000n,
      });
      const expense1 = newId();
      await db.insert(expense).values({
        id: expense1,
        businessId,
        tripId: trip1,
        category: "fuel",
        amountMinor: 3_000n,
        spentOn: "2026-07-02",
        borneBy: "us",
        postedPeriodId: periodId,
      });
      ctx.trackCreatedExpense(expense1);

      // Trip 2: 20,000 agreed, 2,000 driver fee, no expense (a real zero cost), 350km distance — profit 18,000.
      const openingReadingId = await ctx.createOdometerReading(
        businessId,
        vehicleId,
        1000,
        "2026-07-05",
      );
      const closingReadingId = await ctx.createOdometerReading(
        businessId,
        vehicleId,
        1350,
        "2026-07-08",
      );
      const trip2 = await ctx.createTrip(businessId, vehicleId, periodId, {
        agreedAmountMinor: 20_000n,
        driverFeeMinor: 2_000n,
        startDate: "2026-07-05",
        endDate: "2026-07-08",
        openingOdometerId: openingReadingId,
        closingOdometerId: closingReadingId,
      });

      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await getReport("/trips", token);
      expect(res.status).toBe(200);
      const rows: {
        id: string;
        profitMinor: string;
        distanceKm: number | null;
        profitPerKm: number | null;
      }[] = await res.json();

      const row1 = rows.find((r) => r.id === trip1);
      const row2 = rows.find((r) => r.id === trip2);
      expect(row1).toMatchObject({ profitMinor: "48000", distanceKm: null, profitPerKm: null });
      expect(row2?.profitMinor).toBe("18000");
      expect(row2?.distanceKm).toBe(350);
      expect(row2?.profitPerKm).toBeCloseTo(18000 / 350, 5);

      // Ranked by profit, largest first.
      expect(rows.findIndex((r) => r.id === trip1)).toBeLessThan(
        rows.findIndex((r) => r.id === trip2),
      );

      await ctx.cleanup();
    });
  });

  describe("fuel efficiency (UC-72)", () => {
    it("happy path — km/l needs the previous fill's own reading; the first fill is null", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const vehicleId = await ctx.createVehicle(businessId);

      const reading1 = await ctx.createOdometerReading(businessId, vehicleId, 1000, "2026-07-05");
      const fill1 = newId();
      await db.insert(expense).values({
        id: fill1,
        businessId,
        vehicleId,
        category: "fuel",
        amountMinor: 5_000n,
        spentOn: "2026-07-05",
        borneBy: "us",
        litres: 20,
        odometerReadingId: reading1,
        postedPeriodId: periodId,
      });
      ctx.trackCreatedExpense(fill1);

      const reading2 = await ctx.createOdometerReading(businessId, vehicleId, 1300, "2026-07-15");
      const fill2 = newId();
      await db.insert(expense).values({
        id: fill2,
        businessId,
        vehicleId,
        category: "fuel",
        amountMinor: 6_000n,
        spentOn: "2026-07-15",
        borneBy: "us",
        litres: 25,
        odometerReadingId: reading2,
        postedPeriodId: periodId,
      });
      ctx.trackCreatedExpense(fill2);

      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await getReport(
        `/fuel-efficiency?vehicleId=${vehicleId}&from=2026-07-01&to=2026-07-31`,
        token,
      );
      expect(res.status).toBe(200);
      const body: { points: { spentOn: string; kmPerLitre: number | null }[] } = await res.json();
      expect(body.points).toHaveLength(2);
      expect(body.points[0]?.kmPerLitre).toBeNull();
      expect(body.points[1]?.kmPerLitre).toBe(12);

      await ctx.cleanup();
    });

    it("404 — the vehicle belongs to another business", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
      const otherVehicleId = await ctx.createVehicle(otherBusinessId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await getReport(
        `/fuel-efficiency?vehicleId=${otherVehicleId}&from=2026-07-01&to=2026-07-31`,
        token,
      );
      expect(res.status).toBe(404);

      await ctx.cleanup();
    });
  });

  describe("receivables (UC-74)", () => {
    it("happy path — one row per party, resolved to a display name", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const customerId = await ctx.createCustomer(businessId, { name: "Big School" });
      const driverId = await ctx.createDriver(businessId, { name: "Sunil" });

      await ctx.createObligation(businessId, periodId, {
        direction: "owed_to_us",
        partyType: "customer",
        customerId,
        amountMinor: 50_000n,
        settledMinor: 10_000n,
        status: "part_paid",
        dueOn: "2026-07-01",
      });
      await ctx.createObligation(businessId, periodId, {
        direction: "owed_to_us",
        partyType: "driver",
        driverId,
        amountMinor: 20_000n,
        settledMinor: 5_000n,
        status: "part_paid",
        dueOn: "2026-07-10",
      });

      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await getReport("/receivables", token);
      expect(res.status).toBe(200);
      const rows: { partyType: string; partyName: string | null; outstandingMinor: string }[] =
        await res.json();

      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        partyType: "customer",
        partyName: "Big School",
        outstandingMinor: "40000",
      });
      expect(rows[1]).toMatchObject({
        partyType: "driver",
        partyName: "Sunil",
        outstandingMinor: "15000",
      });

      await ctx.cleanup();
    });
  });

  describe("ageing (UC-78)", () => {
    it("happy path — buckets from the obligation's own effective due date", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const customerId = await ctx.createCustomer(businessId);

      await ctx.createObligation(businessId, periodId, {
        direction: "owed_to_us",
        partyType: "customer",
        customerId,
        amountMinor: 30_000n,
        status: "pending",
        dueOn: "2026-06-01",
      });

      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await getReport("/ageing?asOfDate=2026-07-15", token);
      expect(res.status).toBe(200);
      const rows: { bucket: string; outstandingMinor: string }[] = await res.json();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ bucket: "31-60", outstandingMinor: "30000" });

      await ctx.cleanup();
    });
  });

  describe("cash position (UC-75)", () => {
    it("happy path — held per partner, deposits shown beside it as a liability", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const customerId = await ctx.createCustomer(businessId);
      const owner = await mintUser(db, ctx, businessId, "owner");

      const paymentId = newId();
      await db.insert(payment).values({
        id: paymentId,
        businessId,
        direction: "received",
        partyType: "customer",
        partyCustomerId: customerId,
        amountMinor: 30_000n,
        occurredOn: "2026-07-05",
        handledByUserId: owner.userId,
        postedPeriodId: periodId,
      });
      ctx.trackCreatedPayment(paymentId);

      const bankingEventId = newId();
      await db.insert(bankingEvent).values({
        id: bankingEventId,
        businessId,
        fromUserId: owner.userId,
        amountRecordedMinor: 10_000n,
        amountCountedMinor: 10_000n,
        bankedOn: "2026-07-06",
        destination: "bank",
        postedPeriodId: periodId,
      });
      ctx.trackCreatedBankingEvent(bankingEventId);

      const depositId = await ctx.createDeposit(businessId, { partyType: "customer", customerId });
      await ctx.createDepositMovement(businessId, periodId, depositId, {
        movementType: "taken",
        amountMinor: 5_000n,
        occurredOn: "2026-07-05",
      });

      const token = await signAccessToken(owner.asgardeoSub);
      const res = await getReport("/cash-position", token);
      expect(res.status).toBe(200);
      const body: {
        partners: { userId: string; heldMinor: string }[];
        depositsHeldMinor: string;
      } = await res.json();

      const ownerRow = body.partners.find((p) => p.userId === owner.userId);
      expect(ownerRow?.heldMinor).toBe("20000");
      expect(body.depositsHeldMinor).toBe("5000");

      await ctx.cleanup();
    });
  });

  describe("lost days (UC-76)", () => {
    it("happy path — resolved to a driver name, the denominator is ran + lost", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const vehicleId = await ctx.createVehicle(businessId);
      const driverId = await ctx.createDriver(businessId, { name: "Kamal" });
      const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId);

      await ctx.createDayRecord(
        businessId,
        periodId,
        dailyLeaseId,
        vehicleId,
        driverId,
        "2026-07-03",
        { state: "did_not_run", expectedMinor: 5_000n, lostReason: "no_passengers" },
      );
      await ctx.createDayRecord(
        businessId,
        periodId,
        dailyLeaseId,
        vehicleId,
        driverId,
        "2026-07-10",
        { state: "did_not_run", expectedMinor: 5_000n, lostReason: "no_passengers" },
      );
      await ctx.createDayRecord(
        businessId,
        periodId,
        dailyLeaseId,
        vehicleId,
        driverId,
        "2026-07-04",
        { state: "ran_paid_full" },
      );
      await ctx.createDayRecord(
        businessId,
        periodId,
        dailyLeaseId,
        vehicleId,
        driverId,
        "2026-07-11",
        { state: "ran_paid_full" },
      );
      await ctx.createDayRecord(
        businessId,
        periodId,
        dailyLeaseId,
        vehicleId,
        driverId,
        "2026-07-18",
        { state: "ran_paid_full" },
      );

      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await getReport("/lost-days?from=2026-07-01&to=2026-07-31", token);
      expect(res.status).toBe(200);
      const rows: {
        driverId: string;
        driverName: string | null;
        lost: number;
        ran: number;
        lostValueMinor: string;
      }[] = await res.json();

      const driverRows = rows.filter((r) => r.driverId === driverId);
      const totalLost = driverRows.reduce((sum, r) => sum + r.lost, 0);
      const totalRan = driverRows.reduce((sum, r) => sum + r.ran, 0);
      const totalLostValue = driverRows.reduce((sum, r) => sum + BigInt(r.lostValueMinor), 0n);
      expect(totalLost).toBe(2);
      expect(totalRan).toBe(3);
      expect(totalLostValue).toBe(10_000n);
      expect(driverRows[0]?.driverName).toBe("Kamal");

      await ctx.cleanup();
    });
  });

  describe("goodwill (UC-77, owners only)", () => {
    it("happy path — every waiver/goodwill adjustment given in the window", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const driverId = await ctx.createDriver(businessId);
      const obligationId = await ctx.createObligation(businessId, periodId, {
        direction: "owed_to_us",
        partyType: "driver",
        driverId,
        amountMinor: 10_000n,
      });

      await ctx.createAdjustment(businessId, periodId, obligationId, {
        adjustmentType: "waiver",
        amountMinor: 2_000n,
        sign: -1,
      });

      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await getReport("/goodwill?from=2020-01-01&to=2099-12-31", token);
      expect(res.status).toBe(200);
      const body: { totalMinor: string } = await res.json();
      expect(body.totalMinor).toBe("2000");

      await ctx.cleanup();
    });
  });

  describe("utilisation (UC-79, owners only)", () => {
    it("happy path — earning/idle/off-road days, always computable (W-56)", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const vehicleId = await ctx.createVehicle(businessId);
      const driverId = await ctx.createDriver(businessId);
      const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId);

      for (const date of ["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04", "2026-07-05"]) {
        await ctx.createVehicleDayAllocation(businessId, vehicleId, date, "A");
      }
      for (const date of ["2026-07-06", "2026-07-07"]) {
        await ctx.createVehicleDayAllocation(businessId, vehicleId, date, "C");
      }
      for (const date of ["2026-07-08", "2026-07-09", "2026-07-10"]) {
        await ctx.createDayRecord(businessId, periodId, dailyLeaseId, vehicleId, driverId, date, {
          state: "ran_paid_full",
        });
      }

      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const incidentId = await openIncident(token, vehicleId);
      ctx.trackCreatedIncident(incidentId);
      const offRoadRes = await recordOffRoad(token, incidentId, "2026-07-11", "2026-07-12");
      expect(offRoadRes.status).toBe(200);

      const res = await getReport(
        `/utilisation?vehicleId=${vehicleId}&from=2026-07-01&to=2026-07-14`,
        token,
      );
      expect(res.status).toBe(200);
      const body: {
        earningDays: number;
        idleDays: number;
        offRoadDays: number;
        totalDays: number;
      } = await res.json();
      expect(body).toMatchObject({ earningDays: 10, idleDays: 2, offRoadDays: 2, totalDays: 14 });

      await ctx.cleanup();
    });

    it("404 — the vehicle belongs to another business", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
      const otherVehicleId = await ctx.createVehicle(otherBusinessId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await getReport(
        `/utilisation?vehicleId=${otherVehicleId}&from=2026-07-01&to=2026-07-14`,
        token,
      );
      expect(res.status).toBe(404);

      await ctx.cleanup();
    });
  });

  describe("access boundary — every report", () => {
    const staffGated = [
      `/vehicle-month?periodId=${PLACEHOLDER_UUID}`,
      "/trips",
      `/fuel-efficiency?vehicleId=${PLACEHOLDER_UUID}&from=2026-07-01&to=2026-07-31`,
      "/receivables",
      "/ageing?asOfDate=2026-07-31",
      "/cash-position",
      "/lost-days?from=2026-07-01&to=2026-07-31",
    ];
    const ownerOnlyGated = [
      "/goodwill?from=2026-07-01&to=2026-07-31",
      `/utilisation?vehicleId=${PLACEHOLDER_UUID}&from=2026-07-01&to=2026-07-31`,
    ];

    it("401 — every report requires a token", async () => {
      for (const path of [...staffGated, ...ownerOnlyGated]) {
        const res = await request(`/api/reports${path}`);
        expect(res.status, path).toBe(401);
      }
    });

    it("403 — a linked driver cannot read any report (W-49: no route in)", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId);
      const driverId = await ctx.createDriver(businessId);
      const linked = await mintLinkedDriver(db, ctx, driverId);
      const token = await signAccessToken(linked.asgardeoSub);

      for (const path of [...staffGated, ...ownerOnlyGated]) {
        const res = await getReport(path, token);
        expect(res.status, path).toBe(403);
      }

      await ctx.cleanup();
    });

    it("403 — a manager cannot read the owner-only reports, but can read the rest", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId);
      const manager = await mintUser(db, ctx, businessId, "manager");
      const token = await signAccessToken(manager.asgardeoSub);

      for (const path of ownerOnlyGated) {
        const res = await getReport(path, token);
        expect(res.status, path).toBe(403);
      }

      const receivablesRes = await getReport("/receivables", token);
      expect(receivablesRes.status).toBe(200);

      await ctx.cleanup();
    });
  });
});
