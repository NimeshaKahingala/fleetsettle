/**
 * A constraint violation is the truth (CLAUDE.md → Writes: "the period-open
 * trigger is the truth; do not pre-check in application code"). The same
 * argument applies to any DB-enforced invariant, not only `PERIOD_CLOSED`:
 * catch the specific violation here and map it to the domain error it means,
 * rather than a second, application-side check that can drift from the one
 * in the schema.
 */

const UNIQUE_VIOLATION = "23505";
const EXCLUSION_VIOLATION = "23P01";
const RAISE_EXCEPTION = "P0001";

/**
 * GAP-178/B13. Migration 0031's archive guard raises this instead of the
 * default `P0001`, so the matcher below keys on the code alone.
 *
 * Every other raiser in this schema shares `P0001` and is told apart by
 * substring-matching its message — four of them, filed as B18 in this same
 * step because a migration rewording a message silently breaks the mapping.
 * A fifth would have widened the defect while pinning it. `FS0` is not a
 * class PostgreSQL defines, so nothing else can claim this code.
 */
const PARTY_ARCHIVED = "FS001";

interface PostgresError {
  code?: string;
  constraint?: string;
  message?: string;
}

function isPostgresError(err: unknown): err is PostgresError {
  return typeof err === "object" && err !== null && "code" in err;
}

/**
 * Drizzle wraps every failed query in a `DrizzleQueryError`, with the real
 * `pg`/`@neondatabase/serverless` error — the one that actually carries
 * `code`/`constraint` — one level down on `.cause` (drizzle-orm/errors.ts).
 * Unwrap it once rather than trust the outer error's shape.
 */
function pgErrorOf(err: unknown): PostgresError | undefined {
  if (isPostgresError(err) && err.code !== undefined) return err;
  const cause = err instanceof Error ? err.cause : undefined;
  return isPostgresError(cause) ? cause : undefined;
}

/**
 * True if `err` is migration 0031's archive guard — an INSERT of money
 * against a driver or customer that has been archived (W-60).
 *
 * Unlike every other raiser here this reads no message text, because it was
 * given its own SQLSTATE for exactly that reason.
 */
export function isPartyArchivedViolation(err: unknown): boolean {
  return pgErrorOf(err)?.code === PARTY_ARCHIVED;
}

/** True if `err` (or the query error wrapping it) is a violation of the named unique index or constraint. */
export function isUniqueViolation(err: unknown, constraintName: string): boolean {
  const pgError = pgErrorOf(err);
  return pgError?.code === UNIQUE_VIOLATION && pgError.constraint === constraintName;
}

/** True if `err` (or the query error wrapping it) is a violation of the named `EXCLUDE` constraint (e.g. `daily_lease_vehicle_id_daterange_excl`). */
export function isExclusionViolation(err: unknown, constraintName: string): boolean {
  const pgError = pgErrorOf(err);
  return pgError?.code === EXCLUSION_VIOLATION && pgError.constraint === constraintName;
}

/**
 * True if `err` is `assert_period_open()`'s `RAISE EXCEPTION` (DM §13,
 * migrations/0001 §"INV-10"). Every `plpgsql RAISE EXCEPTION` with no
 * explicit `ERRCODE` shares the same generic `P0001` code, so the message —
 * fixed, deliberate text the trigger itself raises — is what disambiguates
 * this one from `assert_shares_total`/`assert_advances_settled`/`assert_split_sums`,
 * the same way a constraint name disambiguates a unique violation.
 */
export function isPeriodClosedViolation(err: unknown): boolean {
  const pgError = pgErrorOf(err);
  return pgError?.code === RAISE_EXCEPTION && (pgError.message?.includes("is closed") ?? false);
}

/** True if `err` is `assert_shares_total()`'s `RAISE EXCEPTION` (INV-16, migrations/0001) — disambiguated from the other `P0001` raisers by its fixed message text, the same way `isPeriodClosedViolation` is. */
export function isSharesNotFullViolation(err: unknown): boolean {
  const pgError = pgErrorOf(err);
  return pgError?.code === RAISE_EXCEPTION && (pgError.message?.includes("must be 10000") ?? false);
}

/** True if `err` is `assert_business_has_owner()`'s `RAISE EXCEPTION` (INV-31, migrations/0010) — a revoke or role change that would leave a business with no active owner/owner-manager. */
export function isBusinessHasNoOwnerViolation(err: unknown): boolean {
  const pgError = pgErrorOf(err);
  return (
    pgError?.code === RAISE_EXCEPTION &&
    (pgError.message?.includes("would have no active owner") ?? false)
  );
}

/** True if `err` is `assert_platform_has_admin()`'s `RAISE EXCEPTION` (INV-40, migrations/0030) — the identical shape as `isBusinessHasNoOwnerViolation` above, one level up. */
export function isPlatformHasNoAdminViolation(err: unknown): boolean {
  const pgError = pgErrorOf(err);
  return (
    pgError?.code === RAISE_EXCEPTION &&
    (pgError.message?.includes("would have no active admin") ?? false)
  );
}
