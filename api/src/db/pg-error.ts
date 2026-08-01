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

interface PostgresError {
  code?: string;
  constraint?: string;
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
