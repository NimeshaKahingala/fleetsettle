import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { isPartyArchivedViolation } from "../../src/db/pg-error.js";
import { customer, driver, obligation } from "../../src/db/schema.js";
import { mintUser } from "../support/auth.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

/**
 * GAP-178/B13, migration 0031. The archived-party guard, and the two
 * decisions inside it that only a live database can settle: that it fires on
 * INSERT, and that it does *not* fire on UPDATE.
 *
 * `archiveDriver` checks for open money outside its transaction, so a
 * concurrent write can land money against the party between the check and
 * the archive. The application-side half of that race is PR B's; this is the
 * database-side half, and it is a trigger rather than a lock on each write
 * path because there are too many write paths to enumerate by review and a
 * new one added later would reopen the race in silence.
 */

const db = writer(TEST_DATABASE_URL);
const ctx = new TestContext(db);

afterAll(async () => {
  await ctx.cleanup();
});

/**
 * The archive itself, written directly rather than through the endpoint: this
 * suite is about what the *database* does once a party carries `voided_at`,
 * and going through `POST /archive` would drag W-60's open-money check in
 * front of every case here. `voided_by` is not optional — migration 0023's
 * `driver_void_check`/`customer_void_check` require the trio to be set
 * together, so a void always says who.
 */
async function archive(
  table: typeof driver | typeof customer,
  id: string,
  userId: string,
): Promise<void> {
  await db
    .update(table)
    .set({ voidedAt: sql`now()`, voidedReason: "test archive", voidedBy: userId })
    .where(eq(table.id, id));
}

describe("migration 0031 — the archived-party guard", () => {
  it("refuses new money against an archived driver, with its own SQLSTATE", async () => {
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const { userId } = await mintUser(db, ctx, businessId, "owner");
    await archive(driver, driverId, userId);

    let caught: unknown;
    try {
      await ctx.createObligation(businessId, periodId, { partyType: "driver", driverId });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    // Keyed on the code, never the message. Four existing matchers key on
    // P0001 message substrings (B18); this one was given FS001 so that no
    // message text is load-bearing and a reworded RAISE cannot break it.
    expect(isPartyArchivedViolation(caught)).toBe(true);
  });

  it("refuses new money against an archived customer too", async () => {
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const customerId = await ctx.createCustomer(businessId);
    const { userId } = await mintUser(db, ctx, businessId, "owner");
    await archive(customer, customerId, userId);

    let caught: unknown;
    try {
      await ctx.createObligation(businessId, periodId, { partyType: "customer", customerId });
    } catch (err) {
      caught = err;
    }
    expect(isPartyArchivedViolation(caught)).toBe(true);
  });

  it("leaves a live party alone", async () => {
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);

    const id = await ctx.createObligation(businessId, periodId, { partyType: "driver", driverId });
    expect(id).toBeTruthy();
  });

  /**
   * The INSERT-only decision, as a test rather than a comment.
   *
   * W-60 refuses archiving while money is still *open*, so what survives
   * archival is settled history — and U-5 promises that history stays
   * correctable, with W-50 making the correction a void, which is an UPDATE.
   * A guard firing on UPDATE would refuse a documented correction in order to
   * enforce a rule that never asked for it.
   */
  it("still allows an archived party's own history to be voided — U-5/W-50", async () => {
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const obligationId = await ctx.createObligation(businessId, periodId, {
      partyType: "driver",
      driverId,
    });

    const { userId } = await mintUser(db, ctx, businessId, "owner");
    await archive(driver, driverId, userId);

    await db
      .update(obligation)
      .set({ voidedAt: sql`now()`, voidedReason: "corrected after archival" })
      .where(eq(obligation.id, obligationId));

    const [row] = await db
      .select({ voidedAt: obligation.voidedAt })
      .from(obligation)
      .where(eq(obligation.id, obligationId));
    expect(row?.voidedAt).not.toBeNull();
  });

  it("unarchiving reopens the party to new money — the documented remedy", async () => {
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const { userId } = await mintUser(db, ctx, businessId, "owner");
    await archive(driver, driverId, userId);

    await db
      .update(driver)
      .set({ voidedAt: null, voidedReason: null, voidedBy: null })
      .where(eq(driver.id, driverId));

    const id = await ctx.createObligation(businessId, periodId, { partyType: "driver", driverId });
    expect(id).toBeTruthy();
  });

  it("covers every money table that names a party, and the set comes from the catalogue", async () => {
    const { rows } = await db.execute<{ table_name: string }>(sql`
      SELECT c.relname AS table_name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
         AND EXISTS (SELECT 1 FROM pg_attribute p
                      WHERE p.attrelid = c.oid AND NOT p.attisdropped
                        AND p.attname = 'posted_period_id')
         AND EXISTS (SELECT 1 FROM pg_attribute p
                      WHERE p.attrelid = c.oid AND NOT p.attisdropped
                        AND p.attname IN ('driver_id', 'customer_id',
                                          'party_driver_id', 'party_customer_id'))
         AND NOT EXISTS (SELECT 1 FROM pg_trigger g
                          WHERE g.tgrelid = c.oid AND NOT g.tgisinternal
                            AND g.tgname = c.relname || '_archive_guard')
       ORDER BY c.relname`);

    // Same query api/scripts/assert-no-archive-guard-drift.sql runs in CI.
    // Asserted here as well so a developer running the suite locally sees a
    // missing guard without needing the drift job.
    expect(rows).toEqual([]);
  });
});
