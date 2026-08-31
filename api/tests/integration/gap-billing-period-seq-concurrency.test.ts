import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { billingPeriod, obligation } from "../../src/db/schema.js";
import { generateNextBillingPeriod } from "../../src/domain/billing-period.js";
import { outcome } from "../support/concurrency.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

/**
 * M-2, 31 Aug 2026 — `generateNextBillingPeriod`'s own doc comment claimed
 * "either path re-firing is a no-op, not a duplicate due," and this file's
 * own predecessor (`lease.test.ts`) stated the race was "not re-tested
 * here." The claim had never actually been exercised: the recovery path
 * re-read `findLatestBillingPeriodForLease` *after* the winner's own row
 * had already committed, computed `latest.seq + 1` — one seq past the row
 * that actually collided — found nothing at that seq, and rethrew the
 * original unique violation as a 500. Fixed by threading the *colliding*
 * seq (computed inside the losing call's own transaction, before its own
 * `INSERT` ever ran) out to the catch, rather than re-deriving a new one
 * that may already have moved on.
 *
 * Two real connections, not two awaits on one — see
 * gap-178-concurrency.test.ts's own note: a single client would serialize
 * the two for free and prove nothing.
 */

const db = writer(TEST_DATABASE_URL);
const other = writer(TEST_DATABASE_URL);
const ctx = new TestContext(db);

afterAll(async () => {
  await ctx.cleanup();
});

describe("M-2 — two concurrent calls generating the same lease's next billing period", () => {
  it("both return the identical seq-2 row rather than one 500ing", async () => {
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId, { periodStart: "2026-01-01", periodEnd: "2026-12-31" });
    const vehicleId = await ctx.createVehicle(businessId);
    const customerId = await ctx.createCustomer(businessId);
    const leaseId = await ctx.createLease(businessId, vehicleId, customerId, {
      status: "active",
      startDate: "2026-01-12",
    });

    // seq 1, uncontested — establishes a real "latest" so both racing calls
    // below are genuinely both attempting seq 2, not each independently
    // computing seq 1 against an empty table (which the unique index would
    // not even distinguish from a legitimate first call).
    const firstPeriod = await generateNextBillingPeriod(db, { businessId, leaseId });
    expect(firstPeriod.billingPeriod.seq).toBe(1);
    // Created outside any ctx.create* helper, so tracked by hand — deletes
    // run LIFO, and both were registered after createLease/createVehicle/
    // createCustomer above, so they clear before the rows they reference.
    ctx.track(async () => {
      await db.delete(obligation).where(eq(obligation.id, firstPeriod.obligationId as string));
      await db.delete(billingPeriod).where(eq(billingPeriod.id, firstPeriod.billingPeriod.id));
    });

    const [a, b] = await Promise.all([
      outcome(() => generateNextBillingPeriod(db, { businessId, leaseId })),
      outcome(() => generateNextBillingPeriod(other, { businessId, leaseId })),
    ]);

    // Before this fix, the losing side of the race threw a raw 500
    // (PERIOD_CLOSED's own catch never matched, so it fell through
    // unhandled) instead of returning the winner's own row.
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) {
      throw new Error(`expected both calls to succeed — a.ok=${String(a.ok)} b.ok=${String(b.ok)}`);
    }

    expect(a.value.billingPeriod.seq).toBe(2);
    expect(b.value.billingPeriod.seq).toBe(2);
    // Both calls must agree on exactly which row seq 2 is — not two
    // different ids that happen to share a seq number.
    expect(a.value.billingPeriod.id).toBe(b.value.billingPeriod.id);
    // Exactly one of the two actually inserted; the other replayed.
    expect([a.value.created, b.value.created].sort()).toEqual([false, true]);

    ctx.track(async () => {
      if (a.value.obligationId) {
        await db.delete(obligation).where(eq(obligation.id, a.value.obligationId));
      }
      await db.delete(billingPeriod).where(eq(billingPeriod.id, a.value.billingPeriod.id));
    });

    const rows = await db
      .select({ id: billingPeriod.id, seq: billingPeriod.seq })
      .from(billingPeriod)
      .where(eq(billingPeriod.leaseId, leaseId));
    // Exactly one row per seq — the race never produced a duplicate.
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.seq === 2)).toHaveLength(1);
  });
});
