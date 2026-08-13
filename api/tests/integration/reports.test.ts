import { newId } from "@fleetsettle/shared";
import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { advance, bankingEvent, expense, ownershipShare, payment } from "../../src/db/schema.js";
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

    it("GAP-1/W-59/INV-34 — a manager sees only the vehicle his management_fee_agreement names", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const sharedVehicle = await ctx.createVehicle(businessId, { registration: "SHARED-1" });
      const otherVehicle = await ctx.createVehicle(businessId, { registration: "OTHER-1" });
      const manager = await mintUser(db, ctx, businessId, "manager");
      await ctx.createManagementFeeAgreement(sharedVehicle, manager.userId, {
        effectiveFrom: "2026-06-01",
      });
      const token = await signAccessToken(manager.asgardeoSub);

      const res = await getReport(`/vehicle-month?periodId=${periodId}`, token);
      expect(res.status).toBe(200);
      const body: { vehicles: { vehicleId: string }[] } = await res.json();
      expect(body.vehicles.map((v) => v.vehicleId)).toEqual([sharedVehicle]);
      expect(body.vehicles.map((v) => v.vehicleId)).not.toContain(otherVehicle);

      await ctx.cleanup();
    });

    it("403 — GAP-1/W-59: a manager explicitly names a vehicle he does not manage", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const sharedVehicle = await ctx.createVehicle(businessId, { registration: "SHARED-2" });
      const otherVehicle = await ctx.createVehicle(businessId, { registration: "OTHER-2" });
      const manager = await mintUser(db, ctx, businessId, "manager");
      await ctx.createManagementFeeAgreement(sharedVehicle, manager.userId, {
        effectiveFrom: "2026-06-01",
      });
      const token = await signAccessToken(manager.asgardeoSub);

      const res = await getReport(
        `/vehicle-month?periodId=${periodId}&vehicleId=${otherVehicle}`,
        token,
      );
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

      await ctx.cleanup();
    });

    it("GAP-1/W-59/INV-34 — period overlap, not 'as of today': a manager still sees a period his agreement covered before being revoked", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId, {
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
      });
      const vehicleId = await ctx.createVehicle(businessId, { registration: "REVOKED-1" });
      const manager = await mintUser(db, ctx, businessId, "manager");
      // Effective for the first half of July only — revoked mid-period, well
      // before period end and long before "today" in this test run. "As of
      // period end" or "as of today" would both wrongly exclude this vehicle;
      // period-overlap (W-59's own decision) correctly includes it.
      await ctx.createManagementFeeAgreement(vehicleId, manager.userId, {
        effectiveFrom: "2026-07-01",
        effectiveTo: "2026-07-15",
      });
      const token = await signAccessToken(manager.asgardeoSub);

      const res = await getReport(`/vehicle-month?periodId=${periodId}`, token);
      expect(res.status).toBe(200);
      const body: { vehicles: { vehicleId: string }[] } = await res.json();
      expect(body.vehicles.map((v) => v.vehicleId)).toEqual([vehicleId]);

      await ctx.cleanup();
    });

    it("GAP-1/W-59/INV-34 — an agreement granted after the reported period ends is excluded", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId, {
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
      });
      const vehicleId = await ctx.createVehicle(businessId, { registration: "FUTURE-1" });
      const manager = await mintUser(db, ctx, businessId, "manager");
      await ctx.createManagementFeeAgreement(vehicleId, manager.userId, {
        effectiveFrom: "2026-08-01",
      });
      const token = await signAccessToken(manager.asgardeoSub);

      const res = await getReport(`/vehicle-month?periodId=${periodId}`, token);
      expect(res.status).toBe(200);
      const body: { vehicles: { vehicleId: string }[] } = await res.json();
      expect(body.vehicles).toEqual([]);

      await ctx.cleanup();
    });
  });

  describe("overheads (GAP-41/UC-66, W-32: never spread across vehicles)", () => {
    it("happy path — sums costs with no vehicle, excludes a vehicle-attributed cost the same period", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const vehicleId = await ctx.createVehicle(businessId);

      const overheadExpenseId = newId();
      await db.insert(expense).values({
        id: overheadExpenseId,
        businessId,
        category: "other",
        amountMinor: 4_400n,
        spentOn: "2026-07-05",
        borneBy: "us",
        postedPeriodId: periodId,
      });
      ctx.trackCreatedExpense(overheadExpenseId);

      const secondOverheadId = newId();
      await db.insert(expense).values({
        id: secondOverheadId,
        businessId,
        category: "legal",
        amountMinor: 5_000n,
        spentOn: "2026-07-12",
        borneBy: "us",
        postedPeriodId: periodId,
      });
      ctx.trackCreatedExpense(secondOverheadId);

      // Attributed to a vehicle, same period — must not be counted here (UC-70 already reports it).
      const vehicleExpenseId = newId();
      await db.insert(expense).values({
        id: vehicleExpenseId,
        businessId,
        vehicleId,
        category: "fuel",
        amountMinor: 9_000n,
        spentOn: "2026-07-08",
        borneBy: "us",
        postedPeriodId: periodId,
      });
      ctx.trackCreatedExpense(vehicleExpenseId);

      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await getReport(`/overheads?periodId=${periodId}`, token);
      expect(res.status).toBe(200);
      const body: { totalMinor: string } = await res.json();
      expect(body.totalMinor).toBe("9400");

      await ctx.cleanup();
    });

    it("a real zero when nothing was recorded — never NotAvailable (W-56 governs an unknown, not an absent one)", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await getReport(`/overheads?periodId=${periodId}`, token);
      expect(res.status).toBe(200);
      const body: { totalMinor: string } = await res.json();
      expect(body.totalMinor).toBe("0");

      await ctx.cleanup();
    });

    it("a voided overhead expense does not count", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const ownerToken = await signAccessToken(owner.asgardeoSub);

      const overheadExpenseId = newId();
      await db.insert(expense).values({
        id: overheadExpenseId,
        businessId,
        category: "other",
        amountMinor: 4_400n,
        spentOn: "2026-07-05",
        borneBy: "us",
        postedPeriodId: periodId,
      });
      ctx.trackCreatedExpense(overheadExpenseId);

      const managerToken = await signAccessToken(
        (await mintUser(db, ctx, businessId, "owner_manager")).asgardeoSub,
      );
      const voidRes = await request(`/api/expense/${overheadExpenseId}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...bearer(managerToken).headers },
        body: JSON.stringify({ reason: "Duplicate entry" }),
      });
      expect(voidRes.status).toBe(200);

      const res = await getReport(`/overheads?periodId=${periodId}`, ownerToken);
      expect(res.status).toBe(200);
      const body: { totalMinor: string } = await res.json();
      expect(body.totalMinor).toBe("0");

      await ctx.cleanup();
    });

    it("404 — no such accounting period in this business", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await getReport(`/overheads?periodId=${PLACEHOLDER_UUID}`, token);
      expect(res.status).toBe(404);

      await ctx.cleanup();
    });

    it("404 — the accounting period belongs to another business", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
      const otherPeriodId = await ctx.createOpenPeriod(otherBusinessId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await getReport(`/overheads?periodId=${otherPeriodId}`, token);
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
        vehicleId, // GAP-59/D-14: a trip_id now requires its matching vehicle_id
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

    it("400 — GAP-92: from after to is refused, not answered with a confident empty result", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await getReport(
        `/fuel-efficiency?vehicleId=${PLACEHOLDER_UUID}&from=2026-07-31&to=2026-07-01`,
        token,
      );
      expect(res.status).toBe(400);

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
    it("happy path — held per partner, deposits shown beside it, and GAP-70's banked/driverAdvances given their own rows", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const customerId = await ctx.createCustomer(businessId);
      const driverId = await ctx.createDriver(businessId, { name: "Kamal" });
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
        destination: "Sampath savings",
        postedPeriodId: periodId,
      });
      ctx.trackCreatedBankingEvent(bankingEventId);

      const depositId = await ctx.createDeposit(businessId, { partyType: "customer", customerId });
      await ctx.createDepositMovement(businessId, periodId, depositId, {
        movementType: "taken",
        amountMinor: 5_000n,
        occurredOn: "2026-07-05",
      });

      // issuedByUserId set explicitly — listPartnerCashPositions's held figure only subtracts
      // an advance from the partner who issued it, while GAP-70's driverAdvances breakdown
      // (queries/reports.ts::listAdvancesOutstandingByDriver) sums every outstanding advance
      // business-wide, unscoped by issuer, per DM §15. Setting the issuer here is what makes
      // the two figures reconcile in this test, the same way DM §15's own verification pass did.
      const advanceId = newId();
      await db.insert(advance).values({
        id: advanceId,
        businessId,
        driverId,
        amountMinor: 4_000n,
        issuedOn: "2026-07-05",
        issuedByUserId: owner.userId,
        status: "open",
        postedPeriodId: periodId,
      });
      ctx.trackCreatedAdvance(advanceId);

      const token = await signAccessToken(owner.asgardeoSub);
      const res = await getReport("/cash-position", token);
      expect(res.status).toBe(200);
      const body: {
        partners: { userId: string; heldMinor: string }[];
        depositsHeldMinor: string;
        banked: { destination: string; heldMinor: string }[];
        driverAdvances: { driverId: string; driverName: string | null; outstandingMinor: string }[];
      } = await res.json();

      // held = received(30,000) - banked(10,000) - advanced(4,000) = 16,000 — GAP-70's two new
      // breakdowns must stay arithmetically consistent with this figure's own subtrahends.
      const ownerRow = body.partners.find((p) => p.userId === owner.userId);
      expect(ownerRow?.heldMinor).toBe("16000");
      expect(body.depositsHeldMinor).toBe("5000");

      const bankedRow = body.banked.find((b) => b.destination === "Sampath savings");
      expect(bankedRow?.heldMinor).toBe("10000");

      const advanceRow = body.driverAdvances.find((a) => a.driverId === driverId);
      expect(advanceRow?.driverName).toBe("Kamal");
      expect(advanceRow?.outstandingMinor).toBe("4000");

      await ctx.cleanup();
    });

    it("a settled advance is excluded from driverAdvances, matching heldMinor's own exclusion", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const driverId = await ctx.createDriver(businessId);
      const owner = await mintUser(db, ctx, businessId, "owner");

      await ctx.createAdvance(businessId, periodId, driverId, {
        amountMinor: 4_000n,
        status: "settled",
      });

      const token = await signAccessToken(owner.asgardeoSub);
      const res = await getReport("/cash-position", token);
      expect(res.status).toBe(200);
      const body: { driverAdvances: { driverId: string }[] } = await res.json();

      expect(body.driverAdvances.find((a) => a.driverId === driverId)).toBeUndefined();

      await ctx.cleanup();
    });
  });

  describe("lost days (UC-76)", () => {
    it("happy path — resolved to a driver name, the denominator is ran + lost, and GAP-71's byMonth/byReason reconcile with byWeekday's own total", async () => {
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
      const body: {
        byWeekday: {
          driverId: string;
          driverName: string | null;
          lost: number;
          ran: number;
          lostValueMinor: string;
        }[];
        byMonth: {
          driverId: string;
          driverName: string | null;
          month: string;
          lost: number;
          ran: number;
          lostValueMinor: string;
        }[];
        byReason: {
          driverId: string;
          driverName: string | null;
          reason: string;
          lost: number;
          lostValueMinor: string;
        }[];
      } = await res.json();

      const weekdayRows = body.byWeekday.filter((r) => r.driverId === driverId);
      const totalLost = weekdayRows.reduce((sum, r) => sum + r.lost, 0);
      const totalRan = weekdayRows.reduce((sum, r) => sum + r.ran, 0);
      const totalLostValue = weekdayRows.reduce((sum, r) => sum + BigInt(r.lostValueMinor), 0n);
      expect(totalLost).toBe(2);
      expect(totalRan).toBe(3);
      expect(totalLostValue).toBe(10_000n);
      expect(weekdayRows[0]?.driverName).toBe("Kamal");

      // Every lost day in this window falls in July, so byMonth must reconcile exactly.
      const monthRows = body.byMonth.filter((r) => r.driverId === driverId);
      expect(monthRows).toHaveLength(1);
      expect(monthRows[0]?.month).toBe("2026-07");
      expect(monthRows[0]?.lost).toBe(2);
      expect(monthRows[0]?.ran).toBe(3);
      expect(monthRows[0]?.lostValueMinor).toBe("10000");

      // Both lost days share one reason, so byReason must also reconcile with the same total.
      const reasonRows = body.byReason.filter((r) => r.driverId === driverId);
      expect(reasonRows).toHaveLength(1);
      expect(reasonRows[0]?.reason).toBe("no_passengers");
      expect(reasonRows[0]?.lost).toBe(2);
      expect(reasonRows[0]?.lostValueMinor).toBe("10000");
      expect(reasonRows[0]?.driverName).toBe("Kamal");

      await ctx.cleanup();
    });

    it("GAP-118 (Wave 2 prerequisite) — a card voided off a superseded lease is not this driver's ran or lost day, in any of the three groupings", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const vehicleId = await ctx.createVehicle(businessId);
      const driverId = await ctx.createDriver(businessId, { name: "Sunil" });
      const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId);

      // No live write path voids a day_record yet — GAP-118's own fix is
      // Wave 2's build. Both a voided `did_not_run` and a voided
      // `ran_paid_full` card, to prove neither side of ran+lost leaks.
      await ctx.createDayRecord(
        businessId,
        periodId,
        dailyLeaseId,
        vehicleId,
        driverId,
        "2026-07-03",
        {
          state: "did_not_run",
          expectedMinor: 5_000n,
          lostReason: "no_passengers",
          voided: true,
        },
      );
      await ctx.createDayRecord(
        businessId,
        periodId,
        dailyLeaseId,
        vehicleId,
        driverId,
        "2026-07-04",
        { state: "ran_paid_full", voided: true },
      );

      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await getReport("/lost-days?from=2026-07-01&to=2026-07-31", token);
      expect(res.status).toBe(200);
      const body: {
        byWeekday: { driverId: string; lost: number; ran: number }[];
        byMonth: { driverId: string; lost: number; ran: number }[];
        byReason: { driverId: string; reason: string; lost: number }[];
      } = await res.json();

      expect(body.byWeekday.some((r) => r.driverId === driverId)).toBe(false);
      expect(body.byMonth.some((r) => r.driverId === driverId)).toBe(false);
      expect(body.byReason.some((r) => r.driverId === driverId)).toBe(false);

      await ctx.cleanup();
    });

    it("byReason splits two different reasons into two rows, each valued independently", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const vehicleId = await ctx.createVehicle(businessId);
      const driverId = await ctx.createDriver(businessId);
      const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId);

      await ctx.createDayRecord(
        businessId,
        periodId,
        dailyLeaseId,
        vehicleId,
        driverId,
        "2026-07-03",
        { state: "did_not_run", expectedMinor: 5_000n, lostReason: "breakdown" },
      );
      await ctx.createDayRecord(
        businessId,
        periodId,
        dailyLeaseId,
        vehicleId,
        driverId,
        "2026-08-03",
        { state: "did_not_run", expectedMinor: 5_000n, lostReason: "driver_day_off" },
      );

      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await getReport("/lost-days?from=2026-07-01&to=2026-08-31", token);
      expect(res.status).toBe(200);
      const body: {
        byMonth: { driverId: string; month: string; lost: number }[];
        byReason: { driverId: string; reason: string; lost: number }[];
      } = await res.json();

      const reasonRows = body.byReason.filter((r) => r.driverId === driverId);
      expect(reasonRows.map((r) => r.reason).sort()).toEqual(["breakdown", "driver_day_off"]);
      expect(reasonRows.every((r) => r.lost === 1)).toBe(true);

      const monthRows = body.byMonth.filter((r) => r.driverId === driverId);
      expect(monthRows.map((r) => r.month).sort()).toEqual(["2026-07", "2026-08"]);
      expect(monthRows.every((r) => r.lost === 1)).toBe(true);

      await ctx.cleanup();
    });

    it("400 — GAP-92: from after to is refused, not answered with a confident empty result", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await getReport("/lost-days?from=2026-07-31&to=2026-07-01", token);
      expect(res.status).toBe(400);

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

    it("GAP-72: an adjustment given late on the last day of the window is included, not silently dropped", async () => {
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

      // 8pm Colombo (Asia/Colombo, UTC+5:30) on 30 June — comfortably
      // within the window's own last day, but 14:30 UTC: a bare
      // `created_at <= '2026-06-30'` compares against UTC midnight and
      // excludes anything recorded after it, dropping this one.
      await ctx.createAdjustment(businessId, periodId, obligationId, {
        adjustmentType: "waiver",
        amountMinor: 2_000n,
        sign: -1,
        createdAt: "2026-06-30T20:00:00+05:30",
      });

      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await getReport("/goodwill?from=2026-06-01&to=2026-06-30", token);
      expect(res.status).toBe(200);
      const body: { totalMinor: string } = await res.json();
      expect(body.totalMinor).toBe("2000");

      await ctx.cleanup();
    });

    it("GAP-72: a waiver given just after midnight Colombo time counts toward its own business day, not the UTC day it lands on", async () => {
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

      // 2am Colombo on 1 January 2026 is 20:30 UTC on 31 December 2025 —
      // a bare `created_at >= '2026-01-01'` compares against UTC midnight
      // and excludes this from a report windowed on the business's own
      // 2026, even though the waiver was given on 1 January in Colombo.
      await ctx.createAdjustment(businessId, periodId, obligationId, {
        adjustmentType: "goodwill",
        amountMinor: 3_000n,
        sign: -1,
        createdAt: "2026-01-01T02:00:00+05:30",
      });

      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await getReport("/goodwill?from=2026-01-01&to=2026-12-31", token);
      expect(res.status).toBe(200);
      const body: { totalMinor: string } = await res.json();
      expect(body.totalMinor).toBe("3000");

      await ctx.cleanup();
    });

    it("400 — GAP-92: from after to is refused, not answered with a confident empty result", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await getReport("/goodwill?from=2026-07-31&to=2026-07-01", token);
      expect(res.status).toBe(400);

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

    it("400 — GAP-92: from after to is refused, not answered with a negative totalDays", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await getReport(
        `/utilisation?vehicleId=${PLACEHOLDER_UUID}&from=2026-07-14&to=2026-07-01`,
        token,
      );
      expect(res.status).toBe(400);

      await ctx.cleanup();
    });
  });

  describe("access boundary — every report", () => {
    const staffGated = [
      `/vehicle-month?periodId=${PLACEHOLDER_UUID}`,
      `/overheads?periodId=${PLACEHOLDER_UUID}`,
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
