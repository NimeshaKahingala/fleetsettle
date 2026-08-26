import { addCalendarMonths, businessToday, newId } from "@fleetsettle/shared";
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

    /**
     * GAP-179/B27 pins the bucket edges, because moving this arithmetic from
     * JS `Date.parse` into SQL `date - date` is exactly the change that can
     * shift a boundary by one day without any existing test noticing — the
     * happy path above only exercises the middle of one bucket. Every
     * `<=` edge is asserted from both sides, plus the day after.
     */
    it("GAP-179 — every bucket boundary lands on the documented side of the edge", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const asOf = "2026-07-15";

      // One customer per case, so each row is its own party and the buckets
      // cannot merge — this asserts bucketing, not aggregation.
      const cases: { dueOn: string; bucket: string; note: string }[] = [
        { dueOn: "2026-08-01", bucket: "current", note: "not yet due" },
        { dueOn: "2026-07-15", bucket: "current", note: "due today — 0 days late" },
        { dueOn: "2026-07-14", bucket: "1-30", note: "1 day late" },
        { dueOn: "2026-06-15", bucket: "1-30", note: "30 days late" },
        { dueOn: "2026-06-14", bucket: "31-60", note: "31 days late" },
        { dueOn: "2026-05-16", bucket: "31-60", note: "60 days late" },
        { dueOn: "2026-05-15", bucket: "61-90", note: "61 days late" },
        { dueOn: "2026-04-16", bucket: "61-90", note: "90 days late" },
        { dueOn: "2026-04-15", bucket: "over-90", note: "91 days late" },
      ];

      const expected = new Map<string, string>();
      for (const [i, c] of cases.entries()) {
        const customerId = await ctx.createCustomer(businessId, { name: `Ageing ${String(i)}` });
        await ctx.createObligation(businessId, periodId, {
          direction: "owed_to_us",
          partyType: "customer",
          customerId,
          amountMinor: BigInt(1000 * (i + 1)),
          status: "pending",
          dueOn: c.dueOn,
        });
        expected.set(customerId, c.bucket);
      }

      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await getReport(`/ageing?asOfDate=${asOf}`, token);
      expect(res.status).toBe(200);
      const rows: { partyId: string; bucket: string; outstandingMinor: string }[] =
        await res.json();
      expect(rows).toHaveLength(cases.length);

      const actual = new Map(rows.map((r) => [r.partyId, r.bucket]));
      for (const [i, c] of cases.entries()) {
        const customerId = [...expected.keys()][i] as string;
        expect(`${c.note}: ${actual.get(customerId) ?? "missing"}`).toBe(`${c.note}: ${c.bucket}`);
      }

      await ctx.cleanup();
    });

    it("GAP-179 — a party's total is the sum of its buckets, and a fully settled due drops out entirely", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const customerId = await ctx.createCustomer(businessId);

      // Two dues in the same bucket for one party — must add, not appear twice.
      for (const dueOn of ["2026-06-01", "2026-06-02"]) {
        await ctx.createObligation(businessId, periodId, {
          direction: "owed_to_us",
          partyType: "customer",
          customerId,
          amountMinor: 30_000n,
          status: "pending",
          dueOn,
        });
      }
      // A third due in a different bucket for the same party — its own row,
      // never folded into one bucket for the party's whole balance (UC-78's
      // own stated correctness question).
      await ctx.createObligation(businessId, periodId, {
        direction: "owed_to_us",
        partyType: "customer",
        customerId,
        amountMinor: 5_000n,
        status: "pending",
        dueOn: "2026-07-14",
      });
      // Settled to nothing: dropped as a row, never netted against the rest.
      await ctx.createObligation(businessId, periodId, {
        direction: "owed_to_us",
        partyType: "customer",
        customerId,
        amountMinor: 9_000n,
        settledMinor: 9_000n,
        status: "pending",
        dueOn: "2026-06-01",
      });

      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await getReport("/ageing?asOfDate=2026-07-15", token);
      expect(res.status).toBe(200);
      const rows: { bucket: string; outstandingMinor: string }[] = await res.json();

      const byBucket = new Map(rows.map((r) => [r.bucket, r.outstandingMinor]));
      expect(byBucket.get("31-60")).toBe("60000");
      expect(byBucket.get("1-30")).toBe("5000");
      expect(rows).toHaveLength(2);

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

  describe("distributable cash (GAP-186/UC-109, W-70)", () => {
    async function postLoan(token: string, body: unknown) {
      return request("/api/vehicle-loan", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...bearer(token).headers },
        body: JSON.stringify(body),
      });
    }

    it("with no loans, cash on hand includes deposit cash physically held, and distributing it back out nets to just the payment total — a manager can read it too (W-70)", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const customerId = await ctx.createCustomer(businessId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const manager = await mintUser(db, ctx, businessId, "manager");

      const paymentId = newId();
      await db.insert(payment).values({
        id: paymentId,
        businessId,
        direction: "received",
        partyType: "customer",
        partyCustomerId: customerId,
        amountMinor: 50_000n,
        occurredOn: "2026-07-05",
        handledByUserId: owner.userId,
        postedPeriodId: periodId,
      });
      ctx.trackCreatedPayment(paymentId);

      const depositId = await ctx.createDeposit(businessId, { partyType: "customer", customerId });
      await ctx.createDepositMovement(businessId, periodId, depositId, {
        movementType: "taken",
        amountMinor: 8_000n,
        occurredOn: "2026-07-05",
      });

      const managerToken = await signAccessToken(manager.asgardeoSub);
      const res = await getReport("/distributable-cash", managerToken);
      expect(res.status).toBe(200);
      const body: {
        cashOnHandMinor: string;
        depositsHeldMinor: string;
        loanInstalmentsDueMinor: string | null;
        distributableMinor: string | null;
      } = await res.json();

      // The business physically holds 58,000 (50,000 payment + 8,000 deposit
      // cash) and owes 8,000 back to the customer, so 50,000 is distributable —
      // cashOnHandMinor must include the deposit cash, not just the payment.
      expect(body).toMatchObject({
        cashOnHandMinor: "58000",
        depositsHeldMinor: "8000",
        loanInstalmentsDueMinor: "0",
        distributableMinor: "50000",
      });

      await ctx.cleanup();
    });

    it("an open loan with a monthly figure reduces distributable by overdue plus the next instalment (Q-5)", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const vehicleId = await ctx.createVehicle(businessId);
      const owner = await mintUser(db, ctx, businessId, "owner");

      const paymentId = newId();
      await db.insert(payment).values({
        id: paymentId,
        businessId,
        direction: "received",
        partyType: "customer",
        partyCustomerId: await ctx.createCustomer(businessId),
        amountMinor: 200_000n,
        occurredOn: "2026-07-05",
        handledByUserId: owner.userId,
        postedPeriodId: periodId,
      });
      ctx.trackCreatedPayment(paymentId);

      const token = await signAccessToken(owner.asgardeoSub);
      // Started 3 months back (relative to whenever this test actually
      // runs, never a hardcoded date the server's own businessToday() would
      // disagree with) with a 10,000 monthly instalment and nothing ever
      // paid — 3 instalments already overdue (30,000) plus the next one
      // falling due (10,000) = 40,000 due, per Q-5.
      const startedOn = addCalendarMonths(businessToday(), -3);
      const loanRes = await postLoan(token, {
        vehicleId,
        lender: "Peoples Leasing",
        principalMinor: "1000000",
        totalRepayableMinor: "1500000",
        termMonths: 50,
        monthlyPaymentMinor: "10000",
        startedOn,
      });
      expect(loanRes.status).toBe(201);
      const loan: { id: string } = await loanRes.json();
      ctx.trackCreatedVehicleLoan(loan.id);

      const res = await getReport("/distributable-cash", token);
      expect(res.status).toBe(200);
      const body: {
        cashOnHandMinor: string;
        loanInstalmentsDueMinor: string | null;
        distributableMinor: string | null;
      } = await res.json();
      expect(body.cashOnHandMinor).toBe("200000");
      expect(body.loanInstalmentsDueMinor).toBe("40000");
      expect(body.distributableMinor).toBe("160000");

      await ctx.cleanup();
    });

    it("W-56 — an open loan with no monthly figure degrades the whole report to not available, never a fabricated 0", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId);
      const vehicleId = await ctx.createVehicle(businessId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const loanRes = await postLoan(token, {
        vehicleId,
        lender: "Peoples Leasing",
        principalMinor: "100000",
        totalRepayableMinor: "150000",
        termMonths: 12,
        startedOn: "2026-07-05",
      });
      const loan: { id: string } = await loanRes.json();
      ctx.trackCreatedVehicleLoan(loan.id);

      const res = await getReport("/distributable-cash", token);
      expect(res.status).toBe(200);
      const body: { loanInstalmentsDueMinor: string | null; distributableMinor: string | null } =
        await res.json();
      expect(body.loanInstalmentsDueMinor).toBeNull();
      expect(body.distributableMinor).toBeNull();

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

    it("GAP-147/REV-2026-08-19-03 — a still-unconfirmed (open) day never inflates leaseEligible, in either grouping", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const vehicleId = await ctx.createVehicle(businessId);
      const driverId = await ctx.createDriver(businessId);
      const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId);

      // A confirmed lost day and a confirmed ran day on two different
      // Fridays (2026-07-03, 2026-07-10) — leaseEligible for that weekday
      // bucket must read exactly 2, not 3.
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
        { state: "ran_paid_full" },
      );
      // A third Friday, left unconfirmed — createDayRecord's own default
      // state. Pre-GAP-147, this was silently counted into leaseEligible
      // too (ran + lost + open, not ran + lost).
      await ctx.createDayRecord(
        businessId,
        periodId,
        dailyLeaseId,
        vehicleId,
        driverId,
        "2026-07-17",
      );

      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await getReport("/lost-days?from=2026-07-01&to=2026-07-31", token);
      expect(res.status).toBe(200);
      const body: {
        byWeekday: { driverId: string; lost: number; ran: number; leaseEligible: number }[];
        byMonth: { driverId: string; lost: number; ran: number; leaseEligible: number }[];
      } = await res.json();

      const weekdayRow = body.byWeekday.find((r) => r.driverId === driverId);
      expect(weekdayRow).toMatchObject({ lost: 1, ran: 1, leaseEligible: 2 });

      const monthRow = body.byMonth.find((r) => r.driverId === driverId);
      expect(monthRow).toMatchObject({ lost: 1, ran: 1, leaseEligible: 2 });

      await ctx.cleanup();
    });

    it("GAP-147/REV-2026-08-19-03 — a bucket made up entirely of still-open days is absent, never a manufactured leaseEligible: 0 (W-56)", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const vehicleId = await ctx.createVehicle(businessId);
      const driverId = await ctx.createDriver(businessId);
      const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId);

      // The whole window is one unconfirmed day — nothing here is a fact
      // yet, so this driver should carry no row at all in either grouping,
      // not a bare "0 / 0".
      await ctx.createDayRecord(
        businessId,
        periodId,
        dailyLeaseId,
        vehicleId,
        driverId,
        "2026-07-03",
      );

      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await getReport("/lost-days?from=2026-07-01&to=2026-07-31", token);
      expect(res.status).toBe(200);
      const body: {
        byWeekday: { driverId: string }[];
        byMonth: { driverId: string }[];
      } = await res.json();

      expect(body.byWeekday.some((r) => r.driverId === driverId)).toBe(false);
      expect(body.byMonth.some((r) => r.driverId === driverId)).toBe(false);

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
      const body: {
        totalMinor: string;
        byType: Array<{ adjustmentType: string; totalMinor: string }>;
      } = await res.json();
      expect(body.totalMinor).toBe("2000");
      expect(body.byType).toEqual([{ adjustmentType: "waiver", totalMinor: "2000" }]);

      await ctx.cleanup();
    });

    it("GAP-73: windows on occurred_on (when the waiver was given), not created_at (when the row was entered)", async () => {
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

      // U-8: any record can be entered for a past date. Given 15 June,
      // entered 2 July — a report windowed on created_at would land this in
      // July; occurred_on keeps it in June, where it was actually given.
      await ctx.createAdjustment(businessId, periodId, obligationId, {
        adjustmentType: "waiver",
        amountMinor: 2_000n,
        sign: -1,
        occurredOn: "2026-06-15",
        createdAt: "2026-07-02T10:00:00+05:30",
      });

      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const juneRes = await getReport("/goodwill?from=2026-06-01&to=2026-06-30", token);
      const juneBody: { totalMinor: string } = await juneRes.json();
      expect(juneBody.totalMinor).toBe("2000");

      const julyRes = await getReport("/goodwill?from=2026-07-01&to=2026-07-31", token);
      const julyBody: { totalMinor: string } = await julyRes.json();
      expect(julyBody.totalMinor).toBe("0");

      await ctx.cleanup();
    });

    it("GAP-73: honours sign — a sign=1 goodwill entry claws back rather than inflating the total, grouped separately by type", async () => {
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
        adjustmentType: "goodwill",
        amountMinor: 3_000n,
        sign: -1,
        occurredOn: "2026-06-05",
      });
      // A correction reversing part of a prior goodwill entry — sign = 1,
      // an increase to what's owed, not a fresh discount.
      await ctx.createAdjustment(businessId, periodId, obligationId, {
        adjustmentType: "goodwill",
        amountMinor: 1_000n,
        sign: 1,
        occurredOn: "2026-06-10",
      });
      await ctx.createAdjustment(businessId, periodId, obligationId, {
        adjustmentType: "waiver",
        amountMinor: 500n,
        sign: -1,
        occurredOn: "2026-06-20",
      });

      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await getReport("/goodwill?from=2026-06-01&to=2026-06-30", token);
      expect(res.status).toBe(200);
      const body: {
        totalMinor: string;
        byType: Array<{ adjustmentType: string; totalMinor: string }>;
      } = await res.json();
      // 3,000 given, 1,000 clawed back, 500 waived: net 2,500.
      expect(body.totalMinor).toBe("2500");
      expect(body.byType).toEqual(
        expect.arrayContaining([
          { adjustmentType: "goodwill", totalMinor: "2000" },
          { adjustmentType: "waiver", totalMinor: "500" },
        ]),
      );

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

    it("GAP-19 — revenuePerAvailableDayMinor: only revenue whose own due/closing date falls inside the window, never prorated (W-25)", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const vehicleId = await ctx.createVehicle(businessId);
      const driverId = await ctx.createDriver(businessId);

      // Inside the window: a daily-amount obligation (5,000) and a closed
      // trip (30,000) — 35,000 total, over 14 available days = 2,500/day.
      await ctx.createObligation(businessId, periodId, {
        vehicleId,
        driverId,
        kind: "daily_amount",
        direction: "owed_to_us",
        amountMinor: 5_000n,
        dueOn: "2026-07-08",
      });
      await ctx.createTrip(businessId, vehicleId, periodId, {
        agreedAmountMinor: 30_000n,
        closingDate: "2026-07-10",
      });
      // Outside the window entirely — a monthly rent obligation due before
      // it starts. Proves the window is a hard filter, not a share of a
      // period this report never even asked for.
      await ctx.createObligation(businessId, periodId, {
        vehicleId,
        driverId,
        kind: "rent",
        direction: "owed_to_us",
        amountMinor: 100_000n,
        dueOn: "2026-06-20",
      });

      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await getReport(
        `/utilisation?vehicleId=${vehicleId}&from=2026-07-01&to=2026-07-14`,
        token,
      );
      expect(res.status).toBe(200);
      const body: { totalDays: number; offRoadDays: number; revenuePerAvailableDayMinor: string } =
        await res.json();
      expect(body).toMatchObject({
        totalDays: 14,
        offRoadDays: 0,
        revenuePerAvailableDayMinor: "2500",
      });

      await ctx.cleanup();
    });

    it("GAP-19 — revenuePerAvailableDayMinor is null, never a guessed 0, when the whole window is off the road (W-56)", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const vehicleId = await ctx.createVehicle(businessId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const incidentId = await openIncident(token, vehicleId);
      ctx.trackCreatedIncident(incidentId);
      const offRoadRes = await recordOffRoad(token, incidentId, "2026-07-01", "2026-07-14");
      expect(offRoadRes.status).toBe(200);

      const res = await getReport(
        `/utilisation?vehicleId=${vehicleId}&from=2026-07-01&to=2026-07-14`,
        token,
      );
      expect(res.status).toBe(200);
      const body: { totalDays: number; offRoadDays: number; revenuePerAvailableDayMinor: null } =
        await res.json();
      expect(body).toMatchObject({
        totalDays: 14,
        offRoadDays: 14,
        revenuePerAvailableDayMinor: null,
      });

      await ctx.cleanup();
    });

    it("GAP-26 — an incident's own off-road window and a separately-logged vehicle_unavailability outage never double-count an overlapping day", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const vehicleId = await ctx.createVehicle(businessId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const incidentId = await openIncident(token, vehicleId);
      ctx.trackCreatedIncident(incidentId);
      // Incident: 07-11..07-12 (2 days). Separately-logged outage: 07-12..07-13
      // (2 days). They share 07-12 — the union is 3 days (11, 12, 13), never
      // the naive sum of 4.
      const offRoadRes = await recordOffRoad(token, incidentId, "2026-07-11", "2026-07-12");
      expect(offRoadRes.status).toBe(200);

      const unavailRes = await request(`/api/vehicle/${vehicleId}/unavailability`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...bearer(token).headers },
        body: JSON.stringify({
          reason: "service",
          unavailableFrom: "2026-07-12",
          unavailableTo: "2026-07-13",
        }),
      });
      expect(unavailRes.status).toBe(201);
      const unavailBody: { id: string } = await unavailRes.json();
      ctx.trackCreatedVehicleUnavailability(unavailBody.id);

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
      expect(body.offRoadDays).toBe(3);
      expect(body).toMatchObject({ earningDays: 0, idleDays: 11, offRoadDays: 3, totalDays: 14 });

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

  describe("vehicle year (GAP-18/UC-73, owners only)", () => {
    it("happy path — earned, costs, profit, owner shares and overheads for the window", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const vehicleA = await ctx.createVehicle(businessId, { registration: "A-1111" });
      const customerId = await ctx.createCustomer(businessId);

      await ctx.createObligation(businessId, periodId, {
        direction: "owed_to_us",
        partyType: "customer",
        customerId,
        vehicleId: vehicleA,
        kind: "rent",
        amountMinor: 50_000n,
        dueOn: "2026-03-15",
      });
      const costExpenseId = newId();
      await db.insert(expense).values({
        id: costExpenseId,
        businessId,
        vehicleId: vehicleA,
        category: "other",
        amountMinor: 9_000n,
        spentOn: "2026-05-10",
        borneBy: "us",
        postedPeriodId: periodId,
      });
      ctx.trackCreatedExpense(costExpenseId);

      // An overhead cost — no vehicle — inside the window, beneath vehicle profit rather than spread across it.
      const overheadExpenseId = newId();
      await db.insert(expense).values({
        id: overheadExpenseId,
        businessId,
        category: "office",
        amountMinor: 4_000n,
        spentOn: "2026-06-01",
        borneBy: "us",
        postedPeriodId: periodId,
      });
      ctx.trackCreatedExpense(overheadExpenseId);

      const owner1 = await mintUser(db, ctx, businessId, "owner");
      const share1Id = newId();
      await db.insert(ownershipShare).values([
        {
          id: share1Id,
          vehicleId: vehicleA,
          userId: owner1.userId,
          shareBp: 10_000,
          effectiveFrom: "2026-01-01",
        },
      ]);
      ctx.trackCreatedOwnershipShares([share1Id]);

      const token = await signAccessToken(owner1.asgardeoSub);

      const res = await getReport("/vehicle-year?from=2026-01-01&to=2026-12-31", token);
      expect(res.status).toBe(200);
      const body: {
        from: string;
        to: string;
        overheadsMinor: string;
        vehicles: {
          vehicleId: string;
          earnedMinor: string;
          costsMinor: string;
          profitMinor: string;
          ownerShares: { userId: string; profitShareMinor: string }[];
        }[];
      } = await res.json();

      expect(body).toMatchObject({ from: "2026-01-01", to: "2026-12-31", overheadsMinor: "4000" });
      const rowA = body.vehicles.find((v) => v.vehicleId === vehicleA);
      expect(rowA).toMatchObject({
        earnedMinor: "50000",
        costsMinor: "9000",
        profitMinor: "41000",
      });
      expect(rowA?.ownerShares).toHaveLength(1);
      expect(rowA?.ownerShares[0]).toMatchObject({
        userId: owner1.userId,
        profitShareMinor: "41000",
      });

      await ctx.cleanup();
    });

    it("403 — a manager cannot reach it at all (UC-73's own Sees line, narrower than vehicle-month)", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const manager = await mintUser(db, ctx, businessId, "manager");
      const token = await signAccessToken(manager.asgardeoSub);

      const res = await getReport("/vehicle-year?from=2026-01-01&to=2026-12-31", token);
      expect(res.status).toBe(403);

      await ctx.cleanup();
    });

    it("400 — GAP-92: from after to is refused", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await getReport("/vehicle-year?from=2026-12-31&to=2026-01-01", token);
      expect(res.status).toBe(400);

      await ctx.cleanup();
    });

    it("404 — a named vehicle belongs to another business", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
      const otherVehicleId = await ctx.createVehicle(otherBusinessId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await getReport(
        `/vehicle-year?vehicleId=${otherVehicleId}&from=2026-01-01&to=2026-12-31`,
        token,
      );
      expect(res.status).toBe(404);

      await ctx.cleanup();
    });
  });

  describe("export (GAP-18/UC-99 CSV half, owners only)", () => {
    it("happy path — text/csv, oldest first, plain decimal amounts", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const vehicleId = await ctx.createVehicle(businessId, { registration: "A-1111" });
      const customerId = await ctx.createCustomer(businessId);

      await ctx.createObligation(businessId, periodId, {
        direction: "owed_to_us",
        partyType: "customer",
        customerId,
        vehicleId,
        kind: "rent",
        amountMinor: 50_000n,
        dueOn: "2026-03-15",
      });
      const expenseId = newId();
      await db.insert(expense).values({
        id: expenseId,
        businessId,
        vehicleId,
        category: "fuel",
        amountMinor: 2_550n,
        spentOn: "2026-01-05",
        borneBy: "us",
        postedPeriodId: periodId,
      });
      ctx.trackCreatedExpense(expenseId);

      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await getReport("/export?from=2026-01-01&to=2026-12-31", token);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/^text\/csv/);
      expect(res.headers.get("content-disposition")).toContain("attachment");
      const csv = await res.text();
      const lines = csv.trim().split("\r\n");
      // GAP-173: "Belongs to" appended last so the original five columns keep
      // their positions for anything already parsing this export.
      expect(lines[0]).toBe("Date,Vehicle,Type,Direction,Amount (Rs),Belongs to");
      // Oldest first: the fuel expense (Jan) before the rent obligation (Mar).
      // Both post into the period their own date falls in, so both are
      // ordinary facts and the new column is empty — the common case.
      expect(lines[1]).toBe("2026-01-05,A-1111,Fuel,Out,25.50,");
      expect(lines[2]).toBe("2026-03-15,A-1111,Rent,In,500.00,");

      await ctx.cleanup();
    });

    it("CWE-1236 — a vehicle registration starting with a formula character is neutralised, not written live", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      // registration has no character restriction (z.string().trim().min(1).max(50)) —
      // this is what a normal "add a vehicle" call can produce, not a crafted DB row.
      // No comma/quote in the payload, so this exercises only the formula guard,
      // not RFC 4180 quoting (a separate, already-covered concern) at the same time.
      const vehicleId = await ctx.createVehicle(businessId, { registration: "=SUM(A1:A9)" });
      const customerId = await ctx.createCustomer(businessId);
      await ctx.createObligation(businessId, periodId, {
        direction: "owed_to_us",
        partyType: "customer",
        customerId,
        vehicleId,
        kind: "rent",
        amountMinor: 50_000n,
        dueOn: "2026-03-15",
      });

      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await getReport("/export?from=2026-01-01&to=2026-12-31", token);
      expect(res.status).toBe(200);
      const csv = await res.text();
      const lines = csv.trim().split("\r\n");
      // A leading quote reads as literal text in Excel/Sheets, never as a formula.
      // Trailing comma is GAP-173's empty "Belongs to" column — this obligation
      // posted into the period its own date falls in, so it is not a late fact.
      expect(lines[1]).toBe("2026-03-15,'=SUM(A1:A9),Rent,In,500.00,");
      expect(lines[1]).not.toMatch(/^2026-03-15,=/);

      await ctx.cleanup();
    });

    /**
     * GAP-175: the export pulled four sources and showed an accountant
     * neither an insurer settlement nor a write-off nor a customer's agreed
     * contribution. The last assertion is the one that matters most:
     * `fileInsuranceClaim` writes an `insurance_claim` **and** an
     * `incident_recovery` with `source: 'insurer'` in the same transaction,
     * and `settleInsuranceClaim` then writes the identical
     * `received_amount_minor` to both — so exporting `incident_recovery` as
     * its own source, which is the literal reading of this gap, would have
     * reported every insurer settlement twice.
     */
    it("GAP-175 — settlements, contributions and write-offs all reach the export, and an insurer settlement appears exactly once", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId);
      const vehicleId = await ctx.createVehicle(businessId, { registration: "B-2222" });
      const customerId = await ctx.createCustomer(businessId);
      const leaseId = await ctx.createLease(businessId, vehicleId, customerId);
      // owner_manager is in both STAFF and OWNERS, so one token can record the
      // facts and then run the owners-only export.
      const staff = await mintUser(db, ctx, businessId, "owner_manager");
      const token = await signAccessToken(staff.asgardeoSub);
      const post = (path: string, body: unknown) =>
        request(path, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...bearer(token).headers },
          body: JSON.stringify(body),
        });

      // A lease on the incident is what makes a customer contribution billable.
      const opened = await post("/api/incident", {
        vehicleId,
        leaseId,
        occurredOn: "2026-07-08",
      });
      expect(opened.status).toBe(201);
      const { id: incidentId }: { id: string } = await opened.json();
      ctx.trackCreatedIncident(incidentId);

      const agreed = await post(`/api/incident/${incidentId}/customer-contribution`, {
        agreedAmountMinor: "20000",
        agreedOn: "2026-07-20",
      });
      expect(agreed.status).toBe(201);

      const filed = await post(`/api/incident/${incidentId}/insurance-claim`, {
        claimedAmountMinor: "75000",
        excessBorneMinor: "15000",
        claimedOn: "2026-07-10",
      });
      expect(filed.status).toBe(201);
      const { id: claimId }: { id: string } = await filed.json();
      const settled = await post(`/api/incident/${incidentId}/insurance-claim/${claimId}/settle`, {
        receivedAmountMinor: "60000",
        receivedOn: "2026-09-15",
      });
      expect(settled.status).toBe(200);

      const written = await post("/api/write-off", {
        partyType: "customer",
        partyCustomerId: customerId,
        vehicleId,
        amountMinor: "40000",
        reason: "customer unreachable after three attempts",
        writtenOffOn: "2026-10-01",
      });
      expect(written.status).toBe(201);
      const { id: writeOffId }: { id: string } = await written.json();
      ctx.trackCreatedWriteOff(writeOffId);

      const res = await getReport("/export?from=2026-01-01&to=2026-12-31", token);
      expect(res.status).toBe(200);
      const lines = (await res.text()).trim().split("\r\n");

      // The customer half of an incident recovery, read from the obligation it
      // raises rather than from `incident_recovery` (which carries no date).
      expect(lines).toContain("2026-07-20,B-2222,Customer contribution,In,200.00,");
      // Recognised on `received_on`, not on the date the claim was filed —
      // W-11: expected money is not earned money.
      expect(lines).toContain("2026-09-15,B-2222,Insurance settlement,In,600.00,");
      expect(lines).toContain("2026-10-01,B-2222,Write-off,Out,400.00,");

      // The double-count guard. 600.00 arrived once, so it is reported once.
      expect(lines.filter((l) => l.includes("Insurance settlement"))).toHaveLength(1);
      expect(lines.filter((l) => l.includes("600.00"))).toHaveLength(1);

      await ctx.cleanup();
    });

    it("GAP-175 — a voided write-off leaves the export, the way a voided expense already does", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.createOpenPeriod(businessId);
      const vehicleId = await ctx.createVehicle(businessId, { registration: "C-3333" });
      const customerId = await ctx.createCustomer(businessId);
      const staff = await mintUser(db, ctx, businessId, "owner_manager");
      const token = await signAccessToken(staff.asgardeoSub);
      const post = (path: string, body: unknown) =>
        request(path, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...bearer(token).headers },
          body: JSON.stringify(body),
        });

      const written = await post("/api/write-off", {
        partyType: "customer",
        partyCustomerId: customerId,
        vehicleId,
        amountMinor: "40000",
        reason: "recorded against the wrong customer",
        writtenOffOn: "2026-10-01",
      });
      expect(written.status).toBe(201);
      const { id: writeOffId }: { id: string } = await written.json();
      ctx.trackCreatedWriteOff(writeOffId);

      const before = await getReport("/export?from=2026-01-01&to=2026-12-31", token);
      expect((await before.text()).trim().split("\r\n")).toContain(
        "2026-10-01,C-3333,Write-off,Out,400.00,",
      );

      const voided = await post(`/api/write-off/${writeOffId}/void`, {
        reason: "recorded against the wrong customer",
      });
      expect(voided.status).toBe(200);

      const after = await getReport("/export?from=2026-01-01&to=2026-12-31", token);
      const afterLines = (await after.text()).trim().split("\r\n");
      expect(afterLines.filter((l) => l.includes("Write-off"))).toHaveLength(0);

      await ctx.cleanup();
    });

    it("403 — a manager cannot export", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const manager = await mintUser(db, ctx, businessId, "manager");
      const token = await signAccessToken(manager.asgardeoSub);

      const res = await getReport("/export?from=2026-01-01&to=2026-12-31", token);
      expect(res.status).toBe(403);

      await ctx.cleanup();
    });

    it("400 — GAP-92: from after to is refused", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await getReport("/export?from=2026-12-31&to=2026-01-01", token);
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
      "/distributable-cash",
      "/lost-days?from=2026-07-01&to=2026-07-31",
    ];
    const ownerOnlyGated = [
      "/goodwill?from=2026-07-01&to=2026-07-31",
      `/utilisation?vehicleId=${PLACEHOLDER_UUID}&from=2026-07-01&to=2026-07-31`,
      "/vehicle-year?from=2026-07-01&to=2026-07-31",
      "/export?from=2026-07-01&to=2026-07-31",
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
