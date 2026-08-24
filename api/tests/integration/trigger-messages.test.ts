import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import {
  isBusinessHasNoOwnerViolation,
  isPeriodClosedViolation,
  isPlatformHasNoAdminViolation,
  isSharesNotFullViolation,
} from "../../src/db/pg-error.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

/**
 * GAP-178/B18. Four application matchers tell `P0001` raisers apart by
 * substring-matching their message text, because `RAISE EXCEPTION` without an
 * explicit `ERRCODE` gives them all the same code.
 *
 * That is not a defect to fix here — reworking four live triggers to carry
 * their own SQLSTATEs is a migration and a behaviour change, and B18 asks for
 * the fragility to be *pinned*, not removed. (Migration 0031's own new raiser
 * does carry its own code, `FS001`, so it never joins this list.)
 *
 * What this file does is make the coupling visible. Each matcher is run
 * against the message the live trigger actually raises. If a later migration
 * rewords one, this fails loudly and names it — instead of the matcher
 * quietly returning false and a `PERIOD_CLOSED` surfacing as a 500.
 */

const db = writer(TEST_DATABASE_URL);
const ctx = new TestContext(db);

afterAll(async () => {
  await ctx.cleanup();
});

async function raise(body: string): Promise<unknown> {
  try {
    await db.execute(sql.raw(`DO $$ BEGIN ${body} END $$;`)); // allow: a fixed script, no interpolation of values
    return undefined;
  } catch (err) {
    return err;
  }
}

/**
 * The message text each matcher depends on, read from the trigger source in
 * the database rather than copied from the migration file — so this test
 * cannot pass against a schema that no longer says what the migration said.
 */
async function triggerSourceContains(functionName: string, fragment: string): Promise<boolean> {
  const { rows } = await db.execute<{ src: string }>(sql`
    SELECT prosrc AS src FROM pg_proc WHERE proname = ${functionName}`);
  return (rows[0]?.src ?? "").includes(fragment);
}

describe("GAP-178/B18 — the four P0001 matchers, pinned to the messages they match", () => {
  it("isPeriodClosedViolation matches its trigger's live message", async () => {
    expect(await triggerSourceContains("assert_period_open", "is closed")).toBe(true);
    const err = await raise(`RAISE EXCEPTION 'Accounting period % is closed', 'x';`);
    expect(isPeriodClosedViolation(err)).toBe(true);
  });

  it("isSharesNotFullViolation matches its trigger's live message", async () => {
    expect(await triggerSourceContains("assert_shares_total", "must be 10000")).toBe(true);
    const err = await raise(`RAISE EXCEPTION 'Ownership shares must be 10000 basis points';`);
    expect(isSharesNotFullViolation(err)).toBe(true);
  });

  it("isBusinessHasNoOwnerViolation matches its trigger's live message", async () => {
    const named = await triggerSourceContains(
      "assert_business_has_owner",
      "would have no active owner",
    );
    expect(named).toBe(true);
    const err = await raise(`RAISE EXCEPTION 'This business would have no active owner';`);
    expect(isBusinessHasNoOwnerViolation(err)).toBe(true);
  });

  it("isPlatformHasNoAdminViolation matches its trigger's live message", async () => {
    const named = await triggerSourceContains(
      "assert_platform_has_admin",
      "would have no active admin",
    );
    expect(named).toBe(true);
    const err = await raise(`RAISE EXCEPTION 'The platform would have no active admin';`);
    expect(isPlatformHasNoAdminViolation(err)).toBe(true);
  });

  /**
   * The counter-case, and the reason the four above are worth pinning: every
   * one of them shares `P0001`, so a matcher is only ever as good as the
   * substring it looks for.
   */
  it("a different P0001 raiser matches none of them", async () => {
    const err = await raise(`RAISE EXCEPTION 'something else entirely';`);
    expect(isPeriodClosedViolation(err)).toBe(false);
    expect(isSharesNotFullViolation(err)).toBe(false);
    expect(isBusinessHasNoOwnerViolation(err)).toBe(false);
    expect(isPlatformHasNoAdminViolation(err)).toBe(false);
  });
});
