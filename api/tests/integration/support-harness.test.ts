import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";
import { mintUser, mintLinkedDriver } from "../support/auth.js";
import { request } from "../support/client.js";

/**
 * Proves the harness itself, before any endpoint leans on it (IG §8.3): a
 * fixture can be built against a real Neon branch, `TestContext` tears it
 * down again in FK-safe order, and `app.request()` reaches the same
 * database through the real middleware chain.
 */
describe("tests/support harness", () => {
  const db = writer(TEST_DATABASE_URL);

  afterAll(async () => {
    await db.end();
  });

  it("creates a full fixture across every factory and tears it down again", async () => {
    const ctx = new TestContext(db);

    const businessId = await ctx.createBusiness({ name: "Harness Fleet" });
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const driverId = await ctx.createDriver(businessId);
    const customerId = await ctx.createCustomer(businessId);
    await ctx.createLease(businessId, vehicleId, customerId);

    const owner = await mintUser(db, ctx, businessId, "owner");
    await mintLinkedDriver(db, ctx, driverId);

    const before = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM business WHERE id = $1",
      [businessId],
    );
    expect(before.rows[0]?.n).toBe(1);

    const member = await db.query<{ role: string }>(
      "SELECT role FROM business_member WHERE user_id = $1",
      [owner.userId],
    );
    expect(member.rows[0]?.role).toBe("owner");

    const linked = await db.query<{ linked_user_id: string }>(
      "SELECT linked_user_id FROM driver WHERE id = $1",
      [driverId],
    );
    expect(linked.rows[0]?.linked_user_id).toBeTruthy();

    await ctx.cleanup();

    const after = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM business WHERE id = $1",
      [businessId],
    );
    expect(after.rows[0]?.n).toBe(0);
  });

  it("app.request() reaches the same real database via /api/ready", async () => {
    const res = await request("/api/ready");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
