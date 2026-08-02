import { addDays, businessToday } from "@fleetsettle/shared";
import { writer } from "../../src/db/client.js";
import { afterAll, describe, expect, it } from "vitest";
import { mintLinkedDriver, mintUser, signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

function getPaperworkWarnings(token: string) {
  return request("/api/home/paperwork-warnings", bearer(token));
}

function getDepositReleases(token: string) {
  return request("/api/home/deposit-releases", bearer(token));
}

interface PaperworkWarningBody {
  subjectType: "vehicle" | "driver";
  subjectId: string;
  subjectLabel: string;
  docType: string;
  expiryDate: string;
  isExpired: boolean;
}

interface DepositReleaseBody {
  depositId: string;
  partyType: "customer" | "driver";
  partyId: string;
  partyName: string | null;
  holdReleaseDate: string;
  heldMinor: string;
}

/**
 * F-10.1/UC-92 and F-2.7/UC-16 step 6 (P13's own remaining scope, TRACKER.md):
 * both turned out to be a live home-screen read rather than a cron, so
 * they're exercised the same way every other `GET` endpoint is — through
 * HTTP, not `domain/` directly. Neither takes a date query param; both read
 * the server's own `businessToday()` (Asia/Colombo), so fixtures are built
 * relative to that same reference point rather than a fixed calendar date.
 */
describe("home screen reads (P13, F-10.1/F-2.7)", () => {
  const db = writer(TEST_DATABASE_URL);
  const today = businessToday();
  afterAll(async () => {
    await db.$client.end();
  });

  describe("GET /api/home/paperwork-warnings", () => {
    it("warns inside the window (default 30 days), keeps warning past expiry, and excludes anything further out", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();

      const vehicleSoon = await ctx.createVehicle(businessId, { registration: "SOON-1" });
      await ctx.createVehicleDocument(vehicleSoon, {
        docType: "insurance",
        expiryDate: addDays(today, 10),
      });

      const vehicleExpired = await ctx.createVehicle(businessId, { registration: "EXP-1" });
      await ctx.createVehicleDocument(vehicleExpired, {
        docType: "registration",
        expiryDate: addDays(today, -5),
      });

      const vehicleFar = await ctx.createVehicle(businessId, { registration: "FAR-1" });
      await ctx.createVehicleDocument(vehicleFar, {
        docType: "insurance",
        expiryDate: addDays(today, 90),
      });

      const driverSoon = await ctx.createDriver(businessId, {
        name: "Licence Driver",
        licenceExpiry: addDays(today, 3),
      });
      const driverFar = await ctx.createDriver(businessId, {
        name: "Fine For Now",
        licenceExpiry: addDays(today, 200),
      });
      void driverFar;

      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await getPaperworkWarnings(token);
      expect(res.status).toBe(200);
      const body: PaperworkWarningBody[] = await res.json();

      const bySubject = new Map(body.map((r) => [r.subjectId, r]));
      expect(bySubject.get(vehicleSoon)).toMatchObject({
        subjectType: "vehicle",
        subjectLabel: "SOON-1",
        docType: "insurance",
        isExpired: false,
      });
      expect(bySubject.get(vehicleExpired)).toMatchObject({
        subjectType: "vehicle",
        subjectLabel: "EXP-1",
        docType: "registration",
        isExpired: true,
      });
      expect(bySubject.get(driverSoon)).toMatchObject({
        subjectType: "driver",
        subjectLabel: "Licence Driver",
        docType: "licence",
        isExpired: false,
      });
      expect(bySubject.has(vehicleFar)).toBe(false);
      expect(bySubject.has(driverFar)).toBe(false);

      await ctx.cleanup();
    });

    it("reads business_settings.paperwork_warn_days rather than assuming 30 everywhere", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      await ctx.setPaperworkWarnDays(businessId, 5);

      const vehicleId = await ctx.createVehicle(businessId, { registration: "NARROW-1" });
      await ctx.createVehicleDocument(vehicleId, {
        docType: "insurance",
        expiryDate: addDays(today, 20), // inside the default 30-day window, outside this business's 5-day one
      });

      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await getPaperworkWarnings(token);
      expect(res.status).toBe(200);
      const body: PaperworkWarningBody[] = await res.json();
      expect(body.some((r) => r.subjectId === vehicleId)).toBe(false);

      await ctx.cleanup();
    });

    it("401 — missing Authorization header", async () => {
      const res = await request("/api/home/paperwork-warnings");
      expect(res.status).toBe(401);
    });

    it("403 — a linked driver has no dailyOperations capability", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const driverId = await ctx.createDriver(businessId);
      const linked = await mintLinkedDriver(db, ctx, driverId);
      const token = await signAccessToken(linked.asgardeoSub);

      const res = await getPaperworkWarnings(token);
      expect(res.status).toBe(403);

      await ctx.cleanup();
    });
  });

  describe("GET /api/home/deposit-releases", () => {
    it("surfaces a hold_window deposit once its release date has arrived, never one still held or still waiting", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const periodId = await ctx.createOpenPeriod(businessId);
      const customerId = await ctx.createCustomer(businessId, { name: "Ready Rentals" });

      const dueId = await ctx.createDeposit(businessId, {
        partyType: "customer",
        customerId,
        status: "hold_window",
        holdReleaseDate: today,
      });
      await ctx.createDepositMovement(businessId, periodId, dueId, {
        movementType: "taken",
        amountMinor: 25_000n,
        occurredOn: addDays(today, -40),
      });

      const notYetId = await ctx.createDeposit(businessId, {
        partyType: "customer",
        customerId,
        status: "hold_window",
        holdReleaseDate: addDays(today, 5),
      });
      await ctx.createDepositMovement(businessId, periodId, notYetId, {
        movementType: "taken",
        amountMinor: 12_000n,
        occurredOn: addDays(today, -10),
      });

      const stillHeldId = await ctx.createDeposit(businessId, {
        partyType: "customer",
        customerId,
        status: "held",
      });
      await ctx.createDepositMovement(businessId, periodId, stillHeldId, {
        movementType: "taken",
        amountMinor: 8_000n,
        occurredOn: today,
      });

      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const res = await getDepositReleases(token);
      expect(res.status).toBe(200);
      const body: DepositReleaseBody[] = await res.json();

      expect(body.map((r) => r.depositId)).toEqual([dueId]);
      expect(body[0]).toMatchObject({
        partyType: "customer",
        partyId: customerId,
        partyName: "Ready Rentals",
        holdReleaseDate: today,
        heldMinor: "25000",
      });

      await ctx.cleanup();
    });

    it("401 — missing Authorization header", async () => {
      const res = await request("/api/home/deposit-releases");
      expect(res.status).toBe(401);
    });

    it("403 — a linked driver has no dailyOperations capability", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const driverId = await ctx.createDriver(businessId);
      const linked = await mintLinkedDriver(db, ctx, driverId);
      const token = await signAccessToken(linked.asgardeoSub);

      const res = await getDepositReleases(token);
      expect(res.status).toBe(403);

      await ctx.cleanup();
    });
  });
});
