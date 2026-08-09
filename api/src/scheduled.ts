import { businessToday } from "@fleetsettle/shared";
import { writer } from "./db/client.js";
import { rollDueBillingPeriods } from "./domain/billing-period.js";
import { generateDayCards } from "./domain/day-card-generation.js";
import { generateManagementFeeObligationsForAllOpenPeriods } from "./domain/management-fee.js";
import type { Bindings } from "./types.js";

function log(entry: Record<string, unknown>): void {
  // eslint-disable-next-line no-console -- IG §3.4: the one sanctioned structured-log emission point for a scheduled job — there is no request-scoped logger here (middleware/logger.ts is per-request)
  console.log(JSON.stringify(entry));
}

/**
 * TS §4's Cron Triggers (`wrangler.jsonc`'s `triggers.crons`, both `daily`).
 * Each job is idempotent by construction (its own unique index makes a
 * duplicate run a no-op, CLAUDE.md → Writes) and gets its own try/catch, so
 * one job's failure never takes the other down — and within `generate-day-cards`,
 * one lease's or daily lease's own failure is already collected rather than
 * thrown (domain/day-card-generation.ts), for the identical reason one layer
 * further in.
 *
 * `businessToday()` is called once, for the single `Asia/Colombo` timezone
 * every business in this system currently uses — a real per-business
 * timezone would need each business's own `business.timezone` resolved
 * before deciding "today" for its leases, which this pass does not build
 * (recorded in TRACKER.md, not guessed at).
 */
export async function scheduled(
  _event: ScheduledController,
  env: Bindings,
  ctx: ExecutionContext,
): Promise<void> {
  const today = businessToday();
  const db = writer(env.DATABASE_URL);

  try {
    const result = await generateDayCards(db, today);
    log({
      level: result.errors.length > 0 ? "warn" : "info",
      job: "generate-day-cards",
      today,
      allocationsCreated: result.allocationsCreated,
      dayRecordsCreated: result.dayRecordsCreated,
      errors: result.errors,
    });
  } catch (err) {
    log({
      level: "error",
      job: "generate-day-cards",
      today,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const result = await rollDueBillingPeriods(db, today);
    log({
      level: result.errors.length > 0 ? "warn" : "info",
      job: "generate-billing-periods",
      today,
      rolled: result.rolled.length,
      errors: result.errors,
    });
  } catch (err) {
    log({
      level: "error",
      job: "generate-billing-periods",
      today,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // A10a/GAP-39/W-53: catches up any open period whose management-fee
  // obligations weren't generated at period-open (an agreement granted
  // mid-period, or a period this pass never touched) — unscoped by `today`,
  // since each business's own open period already carries its own start date.
  try {
    const result = await generateManagementFeeObligationsForAllOpenPeriods(db);
    log({
      level: result.errors.length > 0 ? "warn" : "info",
      job: "generate-management-fee",
      created: result.created,
      errors: result.errors,
    });
  } catch (err) {
    log({
      level: "error",
      job: "generate-management-fee",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  ctx.waitUntil(db.$client.end());
}
