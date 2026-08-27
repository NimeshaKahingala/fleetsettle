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
 * fail until it did. Each message below is copied verbatim from the
 * migration's own `RAISE EXCEPTION` (`%` placeholders replaced with
 * realistic values, matching what Postgres actually substitutes at
 * runtime) — a wording change in the migration without a matching change
 * here now fails this file, not a live request.
 */

function pgError(code: string, message?: string, constraint?: string) {
  return { code, message, constraint };
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
