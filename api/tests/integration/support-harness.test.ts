import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { business, businessMember, driver } from "../../src/db/schema.js";
import { mintLinkedDriver, mintUser } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

/**
 * Proves the harness itself, before any endpoint leans on it (IG §8.3): a
 * fixture can be built against a real Neon branch, `TestContext` tears it
 * down again in FK-safe order, and `app.request()` reaches the same
 * database through the real middleware chain.
 */
describe("tests/support harness", () => {
  const db = writer(TEST_DATABASE_URL);

  afterAll(async () => {
    await db.$client.end();
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

    const before = await db
      .select({ id: business.id })
      .from(business)
      .where(eq(business.id, businessId));
    expect(before).toHaveLength(1);

    const member = await db
      .select({ role: businessMember.role })
      .from(businessMember)
      .where(eq(businessMember.userId, owner.userId));
    expect(member[0]?.role).toBe("owner");

    const linked = await db
      .select({ linkedUserId: driver.linkedUserId })
      .from(driver)
      .where(eq(driver.id, driverId));
    expect(linked[0]?.linkedUserId).toBeTruthy();

    await ctx.cleanup();

    const after = await db
      .select({ id: business.id })
      .from(business)
      .where(eq(business.id, businessId));
    expect(after).toHaveLength(0);
  });

  it("app.request() reaches the same real database via /api/ready", async () => {
    const res = await request("/api/ready");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
