import type { BusinessDate, Minor } from "@fleetsettle/shared";
import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { recordLoanPayment, recordVehicleLoan } from "../../src/domain/vehicle-loan.js";
import { LoanPaymentExceedsRemainingError } from "../../src/errors/app-error.js";
import { mintUser } from "../support/auth.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

/**
 * GAP-185, Gitar review on PR #130: `recordLoanPayment`'s own overpayment
 * check reads every live payment and refuses one that would exceed what is
 * left to pay, but nothing serialised two concurrent calls against the
 * *same* loan before this test was written against the unfixed code and
 * observed both succeeding — the same B10 shape `gap-178-concurrency.test.ts`
 * already covers for a deposit's own parent row.
 *
 * Two real connections, not two awaits on one — `writer()` returns its own
 * pool, so two of them contend for row locks the way two Workers isolates
 * do; a single client would serialize them for free and prove nothing.
 */
async function outcome<T>(
  run: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; err: unknown }> {
  try {
    return { ok: true, value: await run() };
  } catch (err) {
    return { ok: false, err };
  }
}

describe("GAP-185 — two concurrent payments cannot together overpay a loan", () => {
  const db = writer(TEST_DATABASE_URL);
  const other = writer(TEST_DATABASE_URL);
  const ctx = new TestContext(db);

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("serializes on the parent loan row, so the second payment sees the first", async () => {
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const { userId } = await mintUser(db, ctx, businessId, "owner");

    const { loanId } = await recordVehicleLoan(db, {
      businessId,
      vehicleId,
      lender: "Peoples Leasing",
      principalMinor: 100_000n as Minor,
      totalRepayableMinor: 150_000n as Minor,
      termMonths: 12,
      startedOn: "2026-07-05" as BusinessDate,
    });
    ctx.trackCreatedVehicleLoan(loanId);

    // 150,000 left to pay, two 100,000 payments at once — individually
    // valid, together 200,000 against a loan that only ever owed 150,000.
    // Without the parent lock both read remaining=150,000, both pass, and
    // the loan is left overpaid with every row individually legitimate.
    const pay = (w: typeof db) =>
      recordLoanPayment(w, {
        businessId,
        userId,
        loanId,
        amountMinor: 100_000n as Minor,
        paidOn: "2026-07-10" as BusinessDate,
      });

    const [a, b] = await Promise.all([outcome(() => pay(db)), outcome(() => pay(other))]);
    const results = [a, b];
    const succeeded = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    if (!failed[0]?.ok) {
      expect(failed[0]?.err).toBeInstanceOf(LoanPaymentExceedsRemainingError);
    }
  });
});
