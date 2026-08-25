import type { BusinessDate, Minor } from "@fleetsettle/shared";
import { and, eq, isNull, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { recordDepositMovementTx } from "../../src/domain/deposit.js";
import { settleAdvance, voidAdvance } from "../../src/domain/advance.js";
import { voidObligation } from "../../src/domain/obligation.js";
import { recordPayment } from "../../src/domain/payment.js";
import {
  advanceSettlement,
  depositMovement,
  obligation,
  paymentAllocation,
} from "../../src/db/schema.js";
import { mintUser } from "../support/auth.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

/**
 * GAP-178, the defects that only exist between two transactions.
 *
 * Each of these is written to **fail against `develop`** — every one was run
 * against the unfixed code first and observed producing the wrong number.
 * A concurrency test that has only ever passed proves nothing: it is
 * indistinguishable from a test whose two halves never actually overlapped.
 *
 * Two real connections, not two awaits on one. `writer()` returns its own
 * pool, so two of them contend for row locks the way two Workers isolates
 * do — a single client would serialize them for free and the test would pass
 * against anything.
 */

const db = writer(TEST_DATABASE_URL);
const other = writer(TEST_DATABASE_URL);
const ctx = new TestContext(db);

afterAll(async () => {
  await ctx.cleanup();
});

/** Settled and re-thrown as a value, so `Promise.all` reports both outcomes rather than the first rejection. */
async function outcome<T>(
  run: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; err: unknown }> {
  try {
    return { ok: true, value: await run() };
  } catch (err) {
    return { ok: false, err };
  }
}

describe("GAP-178/B10 — two concurrent draws cannot take a deposit below zero", () => {
  it("serializes on the parent deposit row, so the second draw sees the first", async () => {
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const { userId } = await mintUser(db, ctx, businessId, "owner");
    const depositId = await ctx.createDeposit(businessId, { partyType: "driver", driverId });
    await ctx.createDepositMovement(businessId, periodId, depositId, {
      movementType: "taken",
      amountMinor: 20_000n,
    });

    // 20,000 held, two 15,000 draws at once. Without the parent lock both
    // read `held = 20000`, both pass the check, and 30,000 leaves a 20,000
    // deposit — every row individually valid, the sum impossible.
    const draw = (w: typeof db) =>
      w.transaction((tx) =>
        recordDepositMovementTx(tx, {
          businessId,
          depositId,
          movementType: "refunded",
          amountMinor: 15_000n as Minor,
          occurredOn: "2026-07-20" as BusinessDate,
          userId,
        }),
      );

    const [a, b] = await Promise.all([outcome(() => draw(db)), outcome(() => draw(other))]);
    const succeeded = [a, b].filter((r) => r.ok).length;
    expect(succeeded).toBe(1);

    const [row] = await db
      .select({ total: sql<string>`coalesce(sum(${depositMovement.amountMinor}), 0)::text` })
      .from(depositMovement)
      .where(
        and(
          eq(depositMovement.depositId, depositId),
          eq(depositMovement.movementType, "refunded"),
          isNull(depositMovement.voidedAt),
        ),
      );
    expect(row?.total).toBe("15000");
  });
});

describe("GAP-178/B12 — a void checks its blockers inside the transaction that voids", () => {
  it("does not void an obligation while a settlement is landing against it", async () => {
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const { userId } = await mintUser(db, ctx, businessId, "owner");
    const obligationId = await ctx.createObligation(businessId, periodId, {
      partyType: "driver",
      driverId,
      kind: "other",
      amountMinor: 10_000n,
    });

    // `createObligation`'s own teardown sweeps adjustments and offset
    // allocations, but not payments — nothing had raced a real `recordPayment`
    // against it before. Registered *after* the obligation so LIFO cleanup
    // runs it *first*, or the obligation delete trips the allocation's
    // foreign key. (CI caught this as a suite-level teardown failure while
    // every test in the file passed.)
    ctx.track(async () => {
      await db.execute(sql`
        DELETE FROM payment_allocation WHERE obligation_id = ${obligationId}`);
      await db.execute(sql`DELETE FROM payment WHERE business_id = ${businessId}`);
    });

    // The blocker is a real `payment_allocation` INSERT, not an UPDATE of the
    // obligation — and that distinction is the whole test.
    //
    // The first version of this raced the void against a plain UPDATE, which
    // conflicts at row level anyway, so it passed without proving anything.
    // Gitar's review of #118 caught what that concealed: `voidObligation` had
    // been given only half the fix `voidAdvance` got. Moving its check inside
    // the transaction does not stop an allocation being *inserted* between
    // "nothing is blocking" and the void, because READ COMMITTED has no
    // predicate locking. Only the parent lock makes the two serialize.
    const [voidResult] = await Promise.all([
      outcome(() =>
        voidObligation(db, { businessId, obligationId, reason: "entered twice", userId }),
      ),
      outcome(() =>
        recordPayment(other, {
          businessId,
          partyType: "driver",
          partyId: driverId,
          direction: "received",
          amountMinor: 4_000n as Minor,
          occurredOn: "2026-07-20" as BusinessDate,
          userId,
        }),
      ),
    ]);

    const [row] = await db
      .select({ voidedAt: obligation.voidedAt, settledMinor: obligation.settledMinor })
      .from(obligation)
      .where(eq(obligation.id, obligationId));

    const allocations = await db
      .select({ id: paymentAllocation.id })
      .from(paymentAllocation)
      .where(
        and(eq(paymentAllocation.obligationId, obligationId), isNull(paymentAllocation.voidedAt)),
      );

    // Whichever order they land in, the two facts must agree: money allocated
    // against an obligation means that obligation is not voided. The reverse
    // — a void that succeeded — means nothing was allocated.
    if (voidResult.ok && row?.voidedAt !== null) {
      expect(allocations).toHaveLength(0);
      expect(row?.settledMinor).toBe(0n);
    }
  });

  it("does not void an advance while a settlement is landing against it", async () => {
    const businessId = await ctx.createBusiness();
    const periodId = await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const { userId } = await mintUser(db, ctx, businessId, "owner");
    const advanceId = await ctx.createAdvance(businessId, periodId, driverId, {
      amountMinor: 10_000n,
    });

    const [voidResult] = await Promise.all([
      outcome(() => voidAdvance(db, { businessId, advanceId, reason: "entered twice", userId })),
      // Through the real settle path, not a raw insert: the guard protects
      // against `settleAdvance`, which is what takes the matching lock. A
      // bare INSERT bypasses the application entirely and would only prove
      // that arbitrary SQL can break an invariant, which it always can.
      outcome(() =>
        settleAdvance(other, {
          businessId,
          advanceId,
          kind: "returned",
          amountMinor: 3_000n as Minor,
          occurredOn: "2026-07-20" as BusinessDate,
        }),
      ),
    ]);

    const live = await db
      .select({ id: advanceSettlement.id })
      .from(advanceSettlement)
      .where(and(eq(advanceSettlement.advanceId, advanceId), isNull(advanceSettlement.voidedAt)));

    // An advance carrying a live settlement must not read as voided.
    if (voidResult.ok && live.length > 0) {
      expect.fail(
        `voidAdvance succeeded while ${live.length.toString()} settlement(s) were live against it`,
      );
    }
  });
});
