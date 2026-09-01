import type { BusinessDate, Minor } from "@fleetsettle/shared";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { incidentRecovery } from "../../src/db/schema.js";
import {
  openIncident,
  recordCustomerContribution,
  recordRecoveryReceived,
  voidIncidentRecovery,
} from "../../src/domain/incident.js";
import { mintUser } from "../support/auth.js";
import { outcome } from "../support/concurrency.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

/**
 * GAP-202/NM-4 — `voidIncidentRecovery` used to read the recovery row and
 * check `receivedAmountMinor > 0` *before* opening its transaction. A
 * concurrent `recordRecoveryReceived` landing in the gap between that read
 * and the void committed money against a recovery the void then discarded
 * anyway, based on a stale "nothing received yet" snapshot — the same class
 * `write-off.ts`'s `voidWriteOff` (GAP-190/B12) and `obligation.ts`'s
 * `voidObligation` (GAP-178/B12) were already fixed for.
 *
 * Two real connections, not two awaits on one — see gap-178-concurrency.test.ts's
 * own note: a single client would serialize the two for free and prove nothing.
 */

const db = writer(TEST_DATABASE_URL);
const other = writer(TEST_DATABASE_URL);
const ctx = new TestContext(db);

afterAll(async () => {
  await ctx.cleanup();
});

describe("GAP-202/NM-4 — voiding an incident recovery checks receivedAmountMinor inside the transaction that voids", () => {
  it("never leaves a recovery both voided and carrying a real receipt", async () => {
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const vehicleId = await ctx.createVehicle(businessId);
    const customerId = await ctx.createCustomer(businessId);
    const leaseId = await ctx.createLease(businessId, vehicleId, customerId);
    const { userId } = await mintUser(db, ctx, businessId, "owner");

    const { incidentId } = await openIncident(db, {
      businessId,
      vehicleId,
      leaseId,
      occurredOn: "2026-08-05" as BusinessDate,
    });
    ctx.trackCreatedIncident(incidentId);

    const { recoveryId } = await recordCustomerContribution(db, {
      businessId,
      incidentId,
      agreedAmountMinor: 10_000n as Minor,
      agreedOn: "2026-08-06" as BusinessDate,
    });

    const [voidResult, receiveResult] = await Promise.all([
      outcome(() =>
        voidIncidentRecovery(other, {
          businessId,
          recoveryId,
          reason: "entered against the wrong customer",
          userId,
        }),
      ),
      outcome(() =>
        recordRecoveryReceived(db, {
          businessId,
          recoveryId,
          receivedAmountMinor: 10_000n as Minor,
          receivedOn: "2026-08-07" as BusinessDate,
          userId,
        }),
      ),
    ]);

    const [row] = await db
      .select({
        voidedAt: incidentRecovery.voidedAt,
        receivedAmountMinor: incidentRecovery.receivedAmountMinor,
      })
      .from(incidentRecovery)
      .where(eq(incidentRecovery.id, recoveryId));

    // Whichever order they land in, the two facts must agree: a real
    // receipt against this recovery means it is not voided. A void that
    // succeeded means nothing was ever received.
    if (row?.voidedAt !== null && (row?.receivedAmountMinor ?? 0n) > 0n) {
      expect.fail(
        `recovery ${recoveryId} is both voided and carries a ` +
          `${(row?.receivedAmountMinor ?? 0n).toString()} receipt — ` +
          `voidResult.ok=${String(voidResult.ok)} receiveResult.ok=${String(receiveResult.ok)}`,
      );
    }

    // At least one side had to have actually run its own real effect —
    // otherwise the two calls could have simply both no-op'd, which would
    // pass the invariant above without proving the lock does anything.
    expect(voidResult.ok || receiveResult.ok).toBe(true);
  });
});
