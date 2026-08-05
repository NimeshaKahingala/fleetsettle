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
