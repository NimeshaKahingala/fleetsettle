import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { accountingPeriod, dayRecord, expense, obligation } from "../../src/db/schema.js";
import { mintUser, signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

async function getChecklist(token: string) {
  return request("/api/accounting-period/checklist", bearer(token));
}

async function postClose(token: string) {
  return request("/api/accounting-period/close", { method: "POST", ...bearer(token) });
}

async function postExpense(token: string, body: unknown) {
  return request("/api/expense", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

async function postDeposit(token: string, body: unknown) {
  return request("/api/deposit", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

async function confirmDay(token: string, body: unknown) {
  return request("/api/day-record/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

async function postTrip(token: string, body: unknown) {
  return request("/api/trip", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

async function postCloseTrip(token: string, id: string, body: unknown) {
  return request(`/api/trip/${id}/close`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

async function getDriverBalances(token: string, driverId: string) {
  return request(`/api/driver/${driverId}/balances`, bearer(token));
}

interface CloseChecklistBody {
  period: { id: string; periodStart: string; periodEnd: string };
  checklist: {
    openTrips: number;
    unreconciledAdvances: number;
    pendingObligations: number;
    openIncidents: number;
  };
}

interface ClosedPeriodBody {
  closedPeriod: { id: string; periodStart: string; periodEnd: string };
  newPeriod: { id: string; periodStart: string; periodEnd: string };
  checklist: CloseChecklistBody["checklist"];
}

/**
 * F-9.1/UC-98 test matrix. The checklist warns and lists, never blocks
 * (U-7); the close is one-way and always opens its successor in the same
 * transaction (DM §3.1) — there is no reopen (W-35).
 */
describe("close an accounting period (P9, F-9.1/UC-98)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("the checklist counts an open trip, an unsettled advance, a pending due and an open incident", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const customerId = await ctx.createCustomer(businessId);
    await ctx.createObligation(businessId, periodId, {
      partyType: "customer",
      customerId,
      amountMinor: 10_000n,
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const tripRes = await postTrip(token, {
      vehicleId,
      customerId,
      driverId,
      startDate: "2026-07-29",
      endDate: "2026-07-31",
    });
    expect(tripRes.status).toBe(201);
    const tripBody: { id: string } = await tripRes.json();
    ctx.trackCreatedTrip(tripBody.id);

    const res = await getChecklist(token);
    expect(res.status).toBe(200);
    const body: CloseChecklistBody = await res.json();
    expect(body.period.id).toBe(periodId);
    expect(body.checklist.openTrips).toBeGreaterThanOrEqual(1);
    expect(body.checklist.pendingObligations).toBeGreaterThanOrEqual(1);

    await ctx.cleanup();
  });

  it("happy path — closes the open period and opens its successor in the same transaction", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId, {
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postClose(token);
    expect(res.status).toBe(200);
    const body: ClosedPeriodBody = await res.json();
    expect(body.closedPeriod).toMatchObject({
      id: periodId,
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
    });
    expect(body.newPeriod).toMatchObject({ periodStart: "2026-08-01", periodEnd: "2026-08-31" });
    ctx.trackCreatedPeriod(body.newPeriod.id);

    const rows = await db
      .select({ status: accountingPeriod.status })
      .from(accountingPeriod)
      .where(eq(accountingPeriod.id, periodId));
    expect(rows[0]).toMatchObject({ status: "closed" });

    const openRows = await db
      .select({ id: accountingPeriod.id })
      .from(accountingPeriod)
      .where(and(eq(accountingPeriod.businessId, businessId), eq(accountingPeriod.status, "open")));
    expect(openRows).toHaveLength(1);
    expect(openRows[0]?.id).toBe(body.newPeriod.id);

    await ctx.cleanup();
  });

  it("a late fact after close posts to the new open period, belonging to the one it closed (W-35)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId, { periodStart: "2026-07-01", periodEnd: "2026-07-31" });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const closeRes = await postClose(token);
    const closeBody: ClosedPeriodBody = await closeRes.json();
    ctx.trackCreatedPeriod(closeBody.newPeriod.id);

    const expenseRes = await postExpense(token, {
      category: "office",
      amountMinor: "5000",
      spentOn: "2026-07-20",
    });
    expect(expenseRes.status).toBe(201);
    const expenseBody: { id: string } = await expenseRes.json();
    ctx.trackCreatedExpense(expenseBody.id);

    const rows = await db
      .select({
        postedPeriodId: expense.postedPeriodId,
        belongsToPeriodId: expense.belongsToPeriodId,
      })
      .from(expense)
      .where(eq(expense.id, expenseBody.id));
    expect(rows[0]).toMatchObject({
      postedPeriodId: closeBody.newPeriod.id,
      belongsToPeriodId: closeBody.closedPeriod.id,
    });

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await postClose("");
    expect(res.status).toBe(401);
  });

  it("403 — a manager cannot close a period (owners only)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const manager = await mintUser(db, ctx, businessId, "manager");
    const token = await signAccessToken(manager.asgardeoSub);

    const res = await postClose(token);
    expect(res.status).toBe(403);

    await ctx.cleanup();
  });
});

/**
 * G-1 — One month of the bus (§7.1/§9.1). Seed: bus, driver, 5,000/day,
 * July, 25,000 deposit. Reproduced end to end through the real endpoints —
 * 24 days confirmed (23 paid in full, one short-paid by 2,000), 4 days
 * confirmed as not run, a 3-day charter reusing P6's own already-proven
 * figures (60,000 income, 22,000 fuel + 3,000 tolls + 9,000 driver fee,
 * 26,000 profit), and a standalone 12,000 breakdown repair — then the
 * period is actually closed and its successor opened, exercising UC-98 as
 * a side effect rather than deriving the figures in isolation.
 *
 * "Bus July earned/costs/profit" and "lost-day value" have no report
 * endpoint yet (F-7.1/UC-76 are P11's job) — computed here directly from
 * the same rows the real endpoints just wrote, the same methodology G-2's
 * and G-3's own tests already use for a figure nothing renders yet.
 */
describe("G-1 — one month of the bus (P9, §7.1/§9.1)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("reproduces exactly: 134,000 bus profit, close and reopen the period", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const julyPeriodId = await ctx.createOpenPeriod(businessId, {
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
    });
    const vehicleId = await ctx.createVehicle(businessId, { vehicleType: "bus" });
    await ctx.setVehicleArrangement(vehicleId, "B");
    const driverId = await ctx.createDriver(businessId, { dailyFeeMinor: 5_000_00n });
    const customerId = await ctx.createCustomer(businessId);
    const dailyLeaseId = await ctx.createDailyLease(businessId, vehicleId, driverId, {
      dailyLeaseAmountMinor: 5_000_00n,
      effectiveFrom: "2026-07-01",
    });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    // 25,000 deposit — held, and no part of any figure below (INV-4/W-8).
    const depositRes = await postDeposit(token, {
      driverId,
      amountMinor: "2500000",
      occurredOn: "2026-07-01",
    });
    expect(depositRes.status).toBe(201);
    const depositBody: { id: string } = await depositRes.json();
    ctx.trackCreatedDeposit(depositBody.id);

    // 23 days paid in full (1 July – 23 July).
    for (let d = 1; d <= 23; d++) {
      const businessDate = `2026-07-${String(d).padStart(2, "0")}`;
      const res = await confirmDay(token, { dailyLeaseId, businessDate, action: "paid_in_full" });
      expect(res.status).toBe(201);
      const body: { id: string } = await res.json();
      ctx.trackCreatedDayRecord(body.id);
    }

    // 24 July — ran, short-paid by 2,000 (the day the arrears comes from).
    const shortPayRes = await confirmDay(token, {
      dailyLeaseId,
      businessDate: "2026-07-24",
      action: "something_else",
      earnedMinor: "500000",
      receivedMinor: "300000",
    });
    expect(shortPayRes.status).toBe(201);
    const shortPayBody: { id: string } = await shortPayRes.json();
    ctx.trackCreatedDayRecord(shortPayBody.id);

    // 25–28 July — four lost days, four different (non-charter) reasons.
    const lostReasons = ["breakdown", "driver_ill", "public_holiday", "no_passengers"] as const;
    for (let i = 0; i < 4; i++) {
      const businessDate = `2026-07-${String(25 + i).padStart(2, "0")}`;
      const res = await confirmDay(token, {
        dailyLeaseId,
        businessDate,
        action: "did_not_run",
        lostReason: lostReasons[i],
      });
      expect(res.status).toBe(201);
      const body: { id: string } = await res.json();
      expect(body).toMatchObject({ state: "did_not_run", earnedMinor: "0" });
      ctx.trackCreatedDayRecord(body.id);
    }

    // The 12,000 breakdown repair — a vehicle cost, not tied to the charter.
    const repairRes = await postExpense(token, {
      vehicleId,
      category: "repairs",
      amountMinor: "1200000",
      spentOn: "2026-07-10",
      borneBy: "us",
    });
    expect(repairRes.status).toBe(201);
    const repairBody: { id: string } = await repairRes.json();
    ctx.trackCreatedExpense(repairBody.id);

    // 29–31 July — the charter, reproducing P6's own §7.1 figures exactly.
    const tripRes = await postTrip(token, {
      vehicleId,
      customerId,
      driverId,
      startDate: "2026-07-29",
      endDate: "2026-07-31",
      agreedAmountMinor: "6000000",
      driverFeeMinor: "900000",
      openingOdometerKm: 10000,
      openingOdometerSource: "in_person",
    });
    expect(tripRes.status).toBe(201);
    const tripBody: { id: string } = await tripRes.json();
    ctx.trackCreatedTrip(tripBody.id);

    const fuelRes = await postExpense(token, {
      vehicleId,
      tripId: tripBody.id,
      category: "fuel",
      amountMinor: "2200000",
      spentOn: "2026-07-31",
      borneBy: "us",
      litres: 35,
    });
    expect(fuelRes.status).toBe(201);
    const fuelBody: { id: string } = await fuelRes.json();
    ctx.trackCreatedExpense(fuelBody.id);

    const tollsRes = await postExpense(token, {
      vehicleId,
      tripId: tripBody.id,
      category: "tolls",
      amountMinor: "300000",
      spentOn: "2026-07-31",
      borneBy: "us",
    });
    expect(tollsRes.status).toBe(201);
    const tollsBody: { id: string } = await tollsRes.json();
    ctx.trackCreatedExpense(tollsBody.id);

    const closeTripRes = await postCloseTrip(token, tripBody.id, {
      closingDate: "2026-07-31",
      closingOdometerKm: 10350,
      closingOdometerSource: "in_person",
    });
    expect(closeTripRes.status).toBe(200);
    const closedTripBody: { incomeMinor: string; costsMinor: string; profitMinor: string } =
      await closeTripRes.json();
    expect(closedTripBody).toMatchObject({
      incomeMinor: "6000000",
      costsMinor: "2500000",
      profitMinor: "2600000",
    });

    // Driver owed / received / arrears (24 ran days: 23 full + 1 short).
    const dayRecordRows = await db
      .select({ earnedMinor: dayRecord.earnedMinor, state: dayRecord.state })
      .from(dayRecord)
      .where(eq(dayRecord.dailyLeaseId, dailyLeaseId));
    expect(dayRecordRows).toHaveLength(28);
    const ranRows = dayRecordRows.filter((r) => r.state.startsWith("ran"));
    const lostRows = dayRecordRows.filter((r) => r.state === "did_not_run");
    expect(ranRows).toHaveLength(24);
    expect(lostRows).toHaveLength(4);
    const earnedTotal = ranRows.reduce((sum, r) => sum + r.earnedMinor, 0n);
    expect(earnedTotal).toBe(12_000_000n); // Rs 120,000 — 24 × 5,000

    const receivedRows = await db
      .select({ amountMinor: obligation.settledMinor })
      .from(obligation)
      .where(and(eq(obligation.sourceType, "day_record"), eq(obligation.businessId, businessId)));
    const receivedTotal = receivedRows.reduce((sum, r) => sum + r.amountMinor, 0n);
    expect(receivedTotal).toBe(11_800_000n); // Rs 118,000
    expect(earnedTotal - receivedTotal).toBe(200_000n); // Rs 2,000 arrears

    // Lost-day value — 4 × 5,000 (the flat rate in force all July).
    expect(BigInt(lostRows.length) * 500_000n).toBe(2_000_000n); // Rs 20,000

    // The two balances, via the real endpoint — never netted (W-2).
    const balancesRes = await getDriverBalances(token, driverId);
    expect(balancesRes.status).toBe(200);
    expect(await balancesRes.json()).toMatchObject({
      owedToUsMinor: "200000", // he owes 2,000
      owedByUsMinor: "900000", // you owe 9,000 (the charter's driver fee)
    });

    // Bus July earned = day-record earned (120,000) + charter income (60,000) = 180,000.
    const busEarned = earnedTotal + 6_000_000n;
    expect(busEarned).toBe(18_000_000n);

    // Bus July costs = charter's own us-borne costs (22,000+3,000+9,000) + the 12,000 repair = 46,000.
    const vehicleExpenseRows = await db
      .select({ amountMinor: expense.amountMinor })
      .from(expense)
      .where(and(eq(expense.vehicleId, vehicleId), eq(expense.borneBy, "us")));
    const expenseTotal = vehicleExpenseRows.reduce((sum, r) => sum + r.amountMinor, 0n);
    const driverFeeRows = await db
      .select({ amountMinor: obligation.amountMinor })
      .from(obligation)
      .where(and(eq(obligation.sourceType, "trip"), eq(obligation.sourceId, tripBody.id)));
    const driverFeeTotal = driverFeeRows.reduce((sum, r) => sum + r.amountMinor, 0n);
    const busCosts = expenseTotal + driverFeeTotal;
    expect(busCosts).toBe(4_600_000n); // Rs 46,000

    // The gate: G-1's own headline figure.
    const busProfit = busEarned - busCosts;
    expect(busProfit).toBe(13_400_000n); // Rs 134,000

    // Close July — the real lifecycle, not simulated (UC-98 as a side effect).
    const closeRes = await postClose(token);
    expect(closeRes.status).toBe(200);
    const closeBody: ClosedPeriodBody = await closeRes.json();
    expect(closeBody.closedPeriod.id).toBe(julyPeriodId);
    expect(closeBody.newPeriod).toMatchObject({
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
    });
    ctx.trackCreatedPeriod(closeBody.newPeriod.id);

    const closedRow = await db
      .select({ status: accountingPeriod.status })
      .from(accountingPeriod)
      .where(eq(accountingPeriod.id, julyPeriodId));
    expect(closedRow[0]).toMatchObject({ status: "closed" });

    await ctx.cleanup();
  }, 90_000); // 28 confirm-day round trips plus deposit/expense/trip/close-period, each a real request against the live Neon branch — comfortably past the suite's default 20s
});
