import { newId } from "@fleetsettle/shared";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

  /**
   * Reads the CI assertion rather than restating it.
   *
   * The first version of this test embedded its own copy of the catalogue
   * query, which SonarCloud flagged as duplication on PR #117 — correctly,
   * and the criticism lands harder than a style rule: the whole argument for
   * a catalogue-derived set is that one definition cannot disagree with
   * itself, and three transcriptions of one query are three chances for it
   * to. Running the file means this test fails for the same reason
   * `check:drift` does, never for a different one.
   *
   * The migration keeps its own copy, unavoidably: it is frozen forward-only
   * SQL (CLAUDE.md → Process) and cannot read a file that may change after
   * it has run.
   */
  /**
   * Claude's review of PR #117 found the INSERT-only rationale was half an
   * argument. W-50 is void-*and-replace*: voiding an archived party's
   * historical row is an UPDATE and passed, but entering its replacement is
   * an INSERT and was refused — so a correction left the original struck out
   * with nothing standing in its place, which is worse than not correcting
   * it. U-5 was preserved in exactly the half that loses information.
   */
  it("allows a W-50 replacement naming the same archived party — the other half of U-5", async () => {
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const { userId } = await mintUser(db, ctx, businessId, "owner");
    const originalId = await ctx.createObligation(businessId, periodId, {
      partyType: "driver",
      driverId,
    });

    await archive(driver, driverId, userId);

    // The void half — an UPDATE, always allowed.
    await db
      .update(obligation)
      .set({ voidedAt: sql`now()`, voidedReason: "wrong figure" })
      .where(eq(obligation.id, originalId));

    // The replace half — an INSERT, and the one this test exists for.
    // `replaces_id` has to be present *in the INSERT*: setting it afterwards
    // is a bare insert as far as a BEFORE INSERT trigger is concerned, which
    // is how the first version of this test failed.
    const replacementId = newId();
    ctx.track(async () => {
      await db.execute(sql`DELETE FROM obligation WHERE id = ${replacementId}`);
    });
    await db.execute(sql`
      INSERT INTO obligation (id, business_id, direction, party_type, party_driver_id, kind,
                              source_type, amount_minor, due_on, effective_due_on, status,
                              posted_period_id, replaces_id)
      VALUES (${replacementId}, ${businessId}, 'owed_to_us', 'driver', ${driverId},
              'other', 'correction', 2000, '2026-07-15', '2026-07-15', 'pending',
              ${periodId}, ${originalId})`);

    const [row] = await db
      .select({ id: obligation.id })
      .from(obligation)
      .where(eq(obligation.id, replacementId));
    expect(row?.id).toBe(replacementId);
  });

  it("still refuses a replacement that moves money to a different archived party", async () => {
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const keptDriverId = await ctx.createDriver(businessId);
    const otherDriverId = await ctx.createDriver(businessId, { name: "Other" });
    const { userId } = await mintUser(db, ctx, businessId, "owner");
    const originalId = await ctx.createObligation(businessId, periodId, {
      partyType: "driver",
      driverId: keptDriverId,
    });

    await archive(driver, otherDriverId, userId);

    // `replaces_id` is an exemption for restating *this* party's own fact,
    // never a way to post new money against a different archived one.
    let caught: unknown;
    try {
      await db.execute(sql`
        INSERT INTO obligation (id, business_id, direction, party_type, party_driver_id, kind,
                                source_type, amount_minor, due_on, effective_due_on, status,
                                posted_period_id, replaces_id)
        VALUES (gen_random_uuid(), ${businessId}, 'owed_to_us', 'driver', ${otherDriverId},
                'other', 'test_fixture', 1000, '2026-07-15', '2026-07-15', 'pending',
                ${periodId}, ${originalId})`);
    } catch (err) {
      caught = err;
    }
    expect(isPartyArchivedViolation(caught)).toBe(true);
  });

  it("covers every party column of every money table — the CI drift query, run here", async () => {
    const assertion = readFileSync(
      resolve(import.meta.dirname, "../../scripts/assert-no-archive-guard-drift.sql"),
      "utf8",
    );
    // The file is read verbatim and carries no interpolation — IG §10.3 is
    // about values reaching SQL as text, and running the CI assertion
    // unaltered is the entire point of this test.
    const query = sql.raw(assertion); // allow: a fixed script from this repo, no interpolation
    const { rows } = await db.execute<{ table_name: string; party_column: string }>(query);
    expect(rows).toEqual([]);
  });
});
