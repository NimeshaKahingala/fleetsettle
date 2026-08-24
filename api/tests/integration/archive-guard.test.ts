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

  /**
   * Found by Gitar's review of PR #117. `expense` names its party
   * `borne_by_driver_id` (W-48 keeps `borne_by` and `paid_by` apart), so the
   * first draft's hard-coded four column names missed it entirely — and the
   * drift check reported clean, which is worse than the gap. An expense
   * borne by an archived driver is new money against an archived party, so
   * it is exactly what B13 forbids.
   */
  it("refuses an expense borne by an archived driver — a party column not called driver_id", async () => {
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const { userId } = await mintUser(db, ctx, businessId, "owner");
    await archive(driver, driverId, userId);

    let caught: unknown;
    try {
      await db.execute(sql`
        INSERT INTO expense (id, business_id, category, amount_minor, spent_on,
                             borne_by, borne_by_driver_id, posted_period_id)
        VALUES (gen_random_uuid(), ${businessId}, 'fuel', 5000, '2026-07-10',
                'driver', ${driverId}, ${periodId})`);
    } catch (err) {
      caught = err;
    }
    expect(isPartyArchivedViolation(caught)).toBe(true);
  });

  it("covers every party column of every money table, and the set comes from the foreign keys", async () => {
    const { rows } = await db.execute<{ table_name: string; party_column: string }>(sql`
      WITH party_columns AS (
        SELECT c.oid AS reloid, c.relname AS table_name, a.attname AS party_column
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_constraint fk ON fk.conrelid = c.oid AND fk.contype = 'f'
                               AND fk.confrelid IN ('driver'::regclass, 'customer'::regclass)
          JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = fk.conkey[1]
                             AND NOT a.attisdropped
         WHERE n.nspname = 'public' AND c.relkind = 'r'
           AND EXISTS (SELECT 1 FROM pg_attribute p
                        WHERE p.attrelid = c.oid AND NOT p.attisdropped
                          AND p.attname = 'posted_period_id')
      )
      SELECT p.table_name, p.party_column
        FROM party_columns p
       WHERE NOT EXISTS (
               SELECT 1 FROM pg_trigger g
                WHERE g.tgrelid = p.reloid AND NOT g.tgisinternal
                  AND g.tgname = p.table_name || '_archive_guard'
                  AND pg_get_triggerdef(g.oid) LIKE '%' || quote_literal(p.party_column) || '%')
       ORDER BY p.table_name, p.party_column`);

    // The same query api/scripts/assert-no-archive-guard-drift.sql runs in
    // CI. Asserted here too so a developer running the suite locally sees an
    // uncovered column without needing the drift job — and it is per
    // *column*, not per table, because a party column added to an
    // already-guarded table is the quieter of the two ways to drift.
    expect(rows).toEqual([]);
  });
});
