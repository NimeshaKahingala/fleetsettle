import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import {
  isBusinessHasNoOwnerViolation,
  isExclusionViolation,
  isPartyArchivedViolation,
  isPeriodClosedViolation,
  isPlatformHasNoAdminViolation,
  isSharesNotFullViolation,
  isUniqueViolation,
} from "./pg-error.js";

/**
 * B18 (evaluation, GAP-190): four `RAISE EXCEPTION`s in this schema share
 * Postgres's generic `P0001` code and are told apart only by substring-
 * matching their fixed message text — the same "pin the trigger string"
 * discipline `pg-error.ts`'s own doc comments already name but no test
 * exercised. A migration rewording any one of these four messages would
 * silently turn its `PERIOD_CLOSED`/`403`-class mapping into an unhandled
 * `500` across every endpoint that write touches, and nothing here would
 * fail until it did.
 *
 * Two layers, not one — Copilot review, PR #144, caught the first draft
 * overclaiming what a hardcoded literal alone actually guarantees:
 *  1. "the four raisers" below pin each classifier's *matching logic*
 *     against realistic synthetic messages (`%` placeholders substituted,
 *     matching what Postgres actually sends at runtime).
 *  2. "the migration text itself" below reads each migration file fresh
 *     and asserts it still contains the exact fragment the classifier
 *     checks for — this is the layer that actually fails if a migration
 *     is reworded, which a synthetic-message test alone cannot do since
 *     it never looks at the migration at all.
 */

function pgError(code: string, message?: string, constraint?: string) {
  return { code, message, constraint };
}

function readMigration(filename: string): string {
  return readFileSync(resolve(import.meta.dirname, "..", "..", "migrations", filename), "utf8");
}

describe("B18: P0001 raisers disambiguated by message text", () => {
  test("isPeriodClosedViolation matches assert_period_open()'s exact wording (migrations/0001)", () => {
    const err = pgError(
      "P0001",
      "accounting period 3f9e4b2a-1c2d-4e3f-9a8b-7c6d5e4f3a2b is closed; post to the open period with belongs_to_period_id set (W-35)",
    );
    expect(isPeriodClosedViolation(err)).toBe(true);
  });

  test("isSharesNotFullViolation matches assert_shares_total()'s exact wording (migrations/0001)", () => {
    const err = pgError("P0001", "ownership shares total 9500 bp on 2026-08-01, must be 10000");
    expect(isSharesNotFullViolation(err)).toBe(true);
  });

  test("isBusinessHasNoOwnerViolation matches assert_business_has_owner()'s exact wording (migrations/0010)", () => {
    const err = pgError(
      "P0001",
      "business 3f9e4b2a-1c2d-4e3f-9a8b-7c6d5e4f3a2b would have no active owner or owner-manager (INV-31)",
    );
    expect(isBusinessHasNoOwnerViolation(err)).toBe(true);
  });

  test("isPlatformHasNoAdminViolation matches assert_platform_has_admin()'s exact wording (migrations/0030)", () => {
    const err = pgError("P0001", "the platform would have no active admin (INV-40)");
    expect(isPlatformHasNoAdminViolation(err)).toBe(true);
  });

  test("the four raisers don't cross-match each other's message", () => {
    const periodClosed = pgError("P0001", "accounting period x is closed; post to the open period");
    const sharesNotFull = pgError("P0001", "ownership shares total 9500 bp on x, must be 10000");
    const noOwner = pgError(
      "P0001",
      "business x would have no active owner or owner-manager (INV-31)",
    );
    const noAdmin = pgError("P0001", "the platform would have no active admin (INV-40)");

    expect(isSharesNotFullViolation(periodClosed)).toBe(false);
    expect(isBusinessHasNoOwnerViolation(periodClosed)).toBe(false);
    expect(isPlatformHasNoAdminViolation(periodClosed)).toBe(false);

    expect(isPeriodClosedViolation(sharesNotFull)).toBe(false);
    expect(isPeriodClosedViolation(noOwner)).toBe(false);
    expect(isPeriodClosedViolation(noAdmin)).toBe(false);
  });

  test("a P0001 with unrelated text matches none of the four", () => {
    const err = pgError("P0001", "some other trigger's message entirely");
    expect(isPeriodClosedViolation(err)).toBe(false);
    expect(isSharesNotFullViolation(err)).toBe(false);
    expect(isBusinessHasNoOwnerViolation(err)).toBe(false);
    expect(isPlatformHasNoAdminViolation(err)).toBe(false);
  });

  test("the right message with the wrong SQLSTATE never matches", () => {
    const err = pgError("23505", "accounting period x is closed; post to the open period");
    expect(isPeriodClosedViolation(err)).toBe(false);
  });
});

describe("B18: the migration text itself still contains what each classifier looks for", () => {
  test("assert_period_open() in migrations/0001 still raises with 'is closed'", () => {
    const sql = readMigration("0001_initial_schema.sql");
    expect(sql).toContain("FUNCTION assert_period_open()");
    expect(sql).toMatch(/RAISE EXCEPTION 'accounting period %[^']*is closed/);
  });

  test("assert_shares_total() in migrations/0001 still raises with 'must be 10000'", () => {
    const sql = readMigration("0001_initial_schema.sql");
    expect(sql).toContain("FUNCTION assert_shares_total()");
    expect(sql).toMatch(/RAISE EXCEPTION 'ownership shares total[^']*must be 10000/);
  });

  test("assert_business_has_owner() in migrations/0010 still raises with 'would have no active owner'", () => {
    const sql = readMigration("0010_business_member_invite.sql");
    expect(sql).toContain("FUNCTION assert_business_has_owner()");
    expect(sql).toMatch(/RAISE EXCEPTION 'business %[^']*would have no active owner/);
  });

  test("assert_platform_has_admin() in migrations/0030 still raises with 'would have no active admin'", () => {
    const sql = readMigration("0030_platform_tier.sql");
    expect(sql).toContain("FUNCTION assert_platform_has_admin()");
    expect(sql).toMatch(/RAISE EXCEPTION 'the platform would have no active admin/);
  });
});

describe("the other pg-error classifiers, for completeness — none had a test before this file", () => {
  test("isPartyArchivedViolation keys on FS001 alone, no message text", () => {
    expect(isPartyArchivedViolation(pgError("FS001"))).toBe(true);
    expect(isPartyArchivedViolation(pgError("FS001", "any message at all"))).toBe(true);
    expect(isPartyArchivedViolation(pgError("P0001", "irrelevant"))).toBe(false);
  });

  test("isUniqueViolation requires both the 23505 code and the named constraint", () => {
    const err = pgError("23505", undefined, "loan_payment_replaces_id_key");
    expect(isUniqueViolation(err, "loan_payment_replaces_id_key")).toBe(true);
    expect(isUniqueViolation(err, "some_other_constraint")).toBe(false);
    expect(
      isUniqueViolation(
        pgError("23P01", undefined, "loan_payment_replaces_id_key"),
        "loan_payment_replaces_id_key",
      ),
    ).toBe(false);
  });

  test("isExclusionViolation requires both the 23P01 code and the named constraint", () => {
    const err = pgError("23P01", undefined, "daily_lease_vehicle_id_daterange_excl");
    expect(isExclusionViolation(err, "daily_lease_vehicle_id_daterange_excl")).toBe(true);
    expect(isExclusionViolation(err, "some_other_constraint")).toBe(false);
  });

  test("every classifier unwraps a DrizzleQueryError-shaped wrapper via .cause", () => {
    const wrapped = new Error("Failed query") as Error & { cause: unknown };
    wrapped.cause = pgError("P0001", "accounting period x is closed; post to the open period");
    expect(isPeriodClosedViolation(wrapped)).toBe(true);
  });

  test("a plain, unrelated error never matches", () => {
    expect(isPeriodClosedViolation(new Error("boom"))).toBe(false);
    expect(isPeriodClosedViolation(undefined)).toBe(false);
    expect(isPeriodClosedViolation("not an error")).toBe(false);
  });
});
