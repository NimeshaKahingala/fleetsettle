import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { mintLinkedDriver, mintUser, signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

async function markUnavailable(token: string, vehicleId: string, body: unknown) {
  return request(`/api/vehicle/${vehicleId}/unavailability`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

async function listUnavailability(token: string, vehicleId: string, from: string, to: string) {
  return request(`/api/vehicle/${vehicleId}/unavailability?from=${from}&to=${to}`, bearer(token));
}

async function voidUnavailability(
  token: string,
  vehicleId: string,
  unavailabilityId: string,
  body: unknown,
) {
  return request(`/api/vehicle/${vehicleId}/unavailability/${unavailabilityId}/void`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

/**
 * F-1.10/GAP-26 test matrix. Vehicle-level and arrangement-agnostic —
 * works regardless of the vehicle's current arrangement, unlike an
 * incident's own `off_road_from`/`off_road_to` which this deliberately
 * does not duplicate.
 */
describe("mark a vehicle off the road (P2, F-1.10/GAP-26)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — a date range with a reason", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await markUnavailable(token, vehicleId, {
      reason: "service",
      unavailableFrom: "2026-07-10",
      unavailableTo: "2026-07-14",
      note: "Clutch replacement",
    });
    expect(res.status).toBe(201);
    const body: {
      id: string;
      vehicleId: string;
      reason: string;
      unavailableFrom: string;
      unavailableTo: string | null;
      note: string | null;
    } = await res.json();
    expect(body).toMatchObject({
      vehicleId,
      reason: "service",
      unavailableFrom: "2026-07-10",
      unavailableTo: "2026-07-14",
      note: "Clutch replacement",
    });
    ctx.trackCreatedVehicleUnavailability(body.id);

    const listRes = await listUnavailability(token, vehicleId, "2026-07-01", "2026-07-31");
    expect(listRes.status).toBe(200);
    const list: { id: string }[] = await listRes.json();
    expect(list.map((r) => r.id)).toEqual([body.id]);

    await ctx.cleanup();
  });

  it("happy path — open-ended (no unavailableTo), still overlaps a later window", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await markUnavailable(token, vehicleId, {
      reason: "sale_preparation",
      unavailableFrom: "2026-07-10",
    });
    expect(res.status).toBe(201);
    const body: { id: string; unavailableTo: string | null } = await res.json();
    expect(body.unavailableTo).toBeNull();
    ctx.trackCreatedVehicleUnavailability(body.id);

    const listRes = await listUnavailability(token, vehicleId, "2026-08-01", "2026-08-31");
    const list: { id: string }[] = await listRes.json();
    expect(list.map((r) => r.id)).toEqual([body.id]);

    await ctx.cleanup();
  });

  it("works regardless of arrangement — no arrangement set at all", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId); // bare factory: no arrangement
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await markUnavailable(token, vehicleId, {
      reason: "other",
      unavailableFrom: "2026-07-10",
      unavailableTo: "2026-07-11",
    });
    expect(res.status).toBe(201);
    const body: { id: string } = await res.json();
    ctx.trackCreatedVehicleUnavailability(body.id);

    await ctx.cleanup();
  });

  it("400 — unavailableTo before unavailableFrom", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await markUnavailable(token, vehicleId, {
      reason: "service",
      unavailableFrom: "2026-07-14",
      unavailableTo: "2026-07-10",
    });
    expect(res.status).toBe(400);

    await ctx.cleanup();
  });

  it("409 VEHICLE_UNAVAILABILITY_OVERLAPS — a second live outage over the same vehicle, overlapping dates", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const first = await markUnavailable(token, vehicleId, {
      reason: "service",
      unavailableFrom: "2026-07-10",
      unavailableTo: "2026-07-14",
    });
    const firstBody: { id: string } = await first.json();
    ctx.trackCreatedVehicleUnavailability(firstBody.id);

    const second = await markUnavailable(token, vehicleId, {
      reason: "other",
      unavailableFrom: "2026-07-12",
      unavailableTo: "2026-07-20",
    });
    expect(second.status).toBe(409);
    const responseBody: { code: string } = await second.json();
    expect(responseBody).toMatchObject({ code: "VEHICLE_UNAVAILABILITY_OVERLAPS" });

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);

    const res = await request(`/api/vehicle/${vehicleId}/unavailability`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "service", unavailableFrom: "2026-07-10" }),
    });
    expect(res.status).toBe(401);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "MISSING_TOKEN" });

    await ctx.cleanup();
  });

  it("403 — a linked driver cannot mark a vehicle off the road", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await markUnavailable(token, vehicleId, {
      reason: "service",
      unavailableFrom: "2026-07-10",
    });
    expect(res.status).toBe(403);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

    await ctx.cleanup();
  });

  it("404 — the vehicle belongs to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const otherVehicleId = await ctx.createVehicle(otherBusinessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await markUnavailable(token, otherVehicleId, {
      reason: "service",
      unavailableFrom: "2026-07-10",
    });
    expect(res.status).toBe(404);

    const listRes = await listUnavailability(token, otherVehicleId, "2026-07-01", "2026-07-31");
    expect(listRes.status).toBe(404);

    await ctx.cleanup();
  });

  describe("correct or end an outage (void)", () => {
    it("happy path — voided, never deleted (W-58), and drops out of the live list", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const vehicleId = await ctx.createVehicle(businessId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const created = await markUnavailable(token, vehicleId, {
        reason: "service",
        unavailableFrom: "2026-07-10",
        unavailableTo: "2026-07-14",
      });
      const createdBody: { id: string } = await created.json();
      ctx.trackCreatedVehicleUnavailability(createdBody.id);

      const res = await voidUnavailability(token, vehicleId, createdBody.id, {
        reason: "Vehicle actually came back early",
      });
      expect(res.status).toBe(200);
      const body: { id: string; voidedAt: string } = await res.json();
      expect(body.id).toBe(createdBody.id);
      expect(body.voidedAt).toBeTruthy();

      const listRes = await listUnavailability(token, vehicleId, "2026-07-01", "2026-07-31");
      const list: { id: string }[] = await listRes.json();
      expect(list).toEqual([]);

      await ctx.cleanup();
    });

    it("after voiding, a new outage over the same dates is accepted — the exclusion constraint only guards live rows", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const vehicleId = await ctx.createVehicle(businessId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const first = await markUnavailable(token, vehicleId, {
        reason: "service",
        unavailableFrom: "2026-07-10",
        unavailableTo: "2026-07-14",
      });
      const firstBody: { id: string } = await first.json();
      ctx.trackCreatedVehicleUnavailability(firstBody.id);

      const undone = await voidUnavailability(token, vehicleId, firstBody.id, {
        reason: "Entered against the wrong vehicle",
      });
      expect(undone.status).toBe(200);

      const second = await markUnavailable(token, vehicleId, {
        reason: "other",
        unavailableFrom: "2026-07-10",
        unavailableTo: "2026-07-14",
      });
      expect(second.status).toBe(201);
      const secondBody: { id: string } = await second.json();
      ctx.trackCreatedVehicleUnavailability(secondBody.id);

      await ctx.cleanup();
    });

    it("409 VEHICLE_UNAVAILABILITY_ALREADY_VOIDED", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const vehicleId = await ctx.createVehicle(businessId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const created = await markUnavailable(token, vehicleId, {
        reason: "service",
        unavailableFrom: "2026-07-10",
      });
      const createdBody: { id: string } = await created.json();
      ctx.trackCreatedVehicleUnavailability(createdBody.id);

      const firstVoid = await voidUnavailability(token, vehicleId, createdBody.id, {
        reason: "Cancelled",
      });
      expect(firstVoid.status).toBe(200);

      const secondVoid = await voidUnavailability(token, vehicleId, createdBody.id, {
        reason: "Cancelled again",
      });
      expect(secondVoid.status).toBe(409);
      const responseBody: { code: string } = await secondVoid.json();
      expect(responseBody).toMatchObject({ code: "VEHICLE_UNAVAILABILITY_ALREADY_VOIDED" });

      await ctx.cleanup();
    });

    it("404 — the outage belongs to another vehicle", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const vehicleId = await ctx.createVehicle(businessId);
      // An explicit registration — createVehicle()'s own default truncates
      // the id to 8 hex chars, and two UUIDv7s minted a moment apart can
      // share that prefix (time-ordered ids, CLAUDE.md → Process).
      const otherVehicleId = await ctx.createVehicle(businessId, { registration: "TEST-OTHER" });
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const created = await markUnavailable(token, vehicleId, {
        reason: "service",
        unavailableFrom: "2026-07-10",
      });
      const createdBody: { id: string } = await created.json();
      ctx.trackCreatedVehicleUnavailability(createdBody.id);

      const res = await voidUnavailability(token, otherVehicleId, createdBody.id, {
        reason: "Wrong vehicle",
      });
      expect(res.status).toBe(404);

      await ctx.cleanup();
    });

    it("404 — the outage belongs to another business", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const vehicleId = await ctx.createVehicle(businessId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const token = await signAccessToken(owner.asgardeoSub);

      const created = await markUnavailable(token, vehicleId, {
        reason: "service",
        unavailableFrom: "2026-07-10",
      });
      const createdBody: { id: string } = await created.json();
      ctx.trackCreatedVehicleUnavailability(createdBody.id);

      const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
      const otherOwner = await mintUser(db, ctx, otherBusinessId, "owner");
      const otherToken = await signAccessToken(otherOwner.asgardeoSub);

      const res = await voidUnavailability(otherToken, vehicleId, createdBody.id, {
        reason: "Not yours",
      });
      expect(res.status).toBe(404);

      await ctx.cleanup();
    });

    it("403 — a linked driver cannot correct an outage", async () => {
      const ctx = new TestContext(db);
      const businessId = await ctx.createBusiness();
      const vehicleId = await ctx.createVehicle(businessId);
      const driverId = await ctx.createDriver(businessId);
      const owner = await mintUser(db, ctx, businessId, "owner");
      const ownerToken = await signAccessToken(owner.asgardeoSub);

      const created = await markUnavailable(ownerToken, vehicleId, {
        reason: "service",
        unavailableFrom: "2026-07-10",
      });
      const createdBody: { id: string } = await created.json();
      ctx.trackCreatedVehicleUnavailability(createdBody.id);

      const linked = await mintLinkedDriver(db, ctx, driverId);
      const linkedToken = await signAccessToken(linked.asgardeoSub);

      const res = await voidUnavailability(linkedToken, vehicleId, createdBody.id, {
        reason: "x",
      });
      expect(res.status).toBe(403);

      await ctx.cleanup();
    });
  });
});
