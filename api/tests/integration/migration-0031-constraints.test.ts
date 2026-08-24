import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { newId } from "@fleetsettle/shared";
import { writer } from "../../src/db/client.js";
import { isUniqueViolation } from "../../src/db/pg-error.js";
import { incident, incidentRecovery } from "../../src/db/schema.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

/**
 * GAP-178/B19 and B20, migration 0031. Two constraint gaps the schema has
 * carried since 0001 — both of the kind that produce a valid-looking row
 * rather than an error, which is why neither had ever been noticed.
 */

const db = writer(TEST_DATABASE_URL);
const ctx = new TestContext(db);

afterAll(async () => {
  await ctx.cleanup();
});

const CODE_CHECK_VIOLATION = "23514";

function pgCode(err: unknown): string | undefined {
  const cause = err instanceof Error ? err.cause : undefined;
  return (cause as { code?: string } | undefined)?.code;
}

async function expectRefused(run: () => Promise<unknown>): Promise<unknown> {
  let caught: unknown;
  try {
    await run();
  } catch (err) {
    caught = err;
  }
  expect(caught, "expected the write to be refused, but it succeeded").toBeDefined();
  return caught;
}

/**
 * A business, an open period and an incident to hang claims and recoveries
 * off — the same four rows every case below needs, extracted rather than
 * repeated once SonarCloud flagged the duplication on PR #117. Teardown
 * sweeps the children first: both `incident_recovery` and `insurance_claim`
 * hold a foreign key to `incident`, and there is no cascade.
 */
async function withIncident(): Promise<{
  businessId: string;
  periodId: string;
  incidentId: string;
}> {
  const businessId = await ctx.createBusiness();
  const periodId = await ctx.createOpenPeriod(businessId);
  const vehicleId = await ctx.createVehicle(businessId);
  const incidentId = newId();
  await db
    .insert(incident)
    .values({ id: incidentId, businessId, vehicleId, occurredOn: "2026-07-05" });
  ctx.track(async () => {
    await db.execute(sql`DELETE FROM incident_recovery WHERE incident_id = ${incidentId}`);
    await db.execute(sql`DELETE FROM insurance_claim  WHERE incident_id = ${incidentId}`);
    await db.execute(sql`DELETE FROM incident WHERE id = ${incidentId}`);
  });
  return { businessId, periodId, incidentId };
}

describe("migration 0031 — B20, the four money columns with no CHECK", () => {
  /**
   * `>= 0`, not `> 0`. Three of the four are accumulators that start at zero
   * and are incremented as money arrives; `> 0` would refuse the row at the
   * moment it is created. The one nullable column is left nullable — a claim
   * that has never paid out is a different fact from one that paid zero.
   */
  it("refuses a negative rent on a billing period", async () => {
    const businessId = await ctx.createBusiness();
    const customerId = await ctx.createCustomer(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const leaseId = await ctx.createLease(businessId, vehicleId, customerId);

    const err = await expectRefused(() =>
      db.execute(sql`
        INSERT INTO billing_period (id, lease_id, seq, period_start, period_end, rent_amount_minor)
        VALUES (${newId()}, ${leaseId}, 99, '2026-07-01', '2026-07-31', -1)`),
    );
    expect(pgCode(err)).toBe(CODE_CHECK_VIOLATION);
  });

  it("refuses a negative received amount on an incident recovery", async () => {
    const { businessId, periodId, incidentId } = await withIncident();

    const err = await expectRefused(() =>
      db.execute(sql`
        INSERT INTO incident_recovery (id, business_id, incident_id, source, agreed_amount_minor,
                                       received_amount_minor, posted_period_id)
        VALUES (${newId()}, ${businessId}, ${incidentId}, 'customer', 1000, -1, ${periodId})`),
    );
    expect(pgCode(err)).toBe(CODE_CHECK_VIOLATION);
  });

  it("refuses negative excess and received amounts on an insurance claim", async () => {
    const { businessId, periodId, incidentId } = await withIncident();

    const insertClaim = (excess: number, received: number) =>
      db.execute(sql`
        INSERT INTO insurance_claim (id, business_id, incident_id, claimed_amount_minor,
                                     excess_borne_minor, received_amount_minor, status,
                                     posted_period_id)
        VALUES (${newId()}, ${businessId}, ${incidentId}, 5000, ${excess}, ${received},
                'submitted', ${periodId})`);

    expect(pgCode(await expectRefused(() => insertClaim(-1, 0)))).toBe(CODE_CHECK_VIOLATION);
    expect(pgCode(await expectRefused(() => insertClaim(0, -1)))).toBe(CODE_CHECK_VIOLATION);

    // Zero on both is the ordinary opening state and must still be accepted —
    // the reason these are `>= 0` and not `> 0`.
    await insertClaim(0, 0);
  });
});

describe("migration 0031 — B19, one live recovery per (incident, source)", () => {
  /**
   * The filed mechanism was wrong: two managers agreeing the same recovery at
   * once do not collide, they both succeed. The incident then carries two
   * claims against one source forever, and nothing surfaces it because each
   * row is individually valid.
   */
  it("refuses a second live recovery for the same source", async () => {
    const { businessId, periodId, incidentId } = await withIncident();

    const add = (id: string) =>
      db.insert(incidentRecovery).values({
        id,
        businessId,
        incidentId,
        source: "customer",
        agreedAmountMinor: 1000n,
        postedPeriodId: periodId,
      });

    const firstId = newId();
    await add(firstId);

    const err = await expectRefused(() => add(newId()));
    expect(isUniqueViolation(err, "incident_recovery_one_live_per_source")).toBe(true);

    /**
     * `WHERE voided_at IS NULL` is the constraint, not a refinement of it.
     * Money is append-only and a correction voids and replaces (W-50), so an
     * unconstrained UNIQUE would make the first wrong claim permanently
     * uncorrectable — the replacement could never be inserted alongside the
     * row it replaces.
     */
    await db.execute(sql`
      UPDATE incident_recovery
         SET voided_at = now(), voided_reason = 'corrected'
       WHERE id = ${firstId}`);

    const replacementId = newId();
    await add(replacementId);

    const { rows } = await db.execute<{ live: string }>(sql`
      SELECT count(*)::text AS live FROM incident_recovery
       WHERE incident_id = ${incidentId} AND voided_at IS NULL`);
    expect(rows[0]?.live).toBe("1");
  });
});
