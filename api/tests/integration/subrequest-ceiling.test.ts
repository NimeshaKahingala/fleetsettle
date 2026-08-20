import { newId } from "@fleetsettle/shared";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { accountingPeriod } from "../../src/db/schema.js";
import { mintUser, signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";
import { countFetches } from "../support/subrequests.js";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

/**
 * GAP-145: `GET /api/partner/{userId}` was found live-500ing on a
 * six-vehicle business — 79 Cloudflare subrequests against Workers Free's
 * 50-subrequest ceiling, one HTTP round trip per Neon query, before this
 * gap batched `getVehicleMonthReport`'s per-vehicle loop and made
 * `sumAllTimeEarnedForUser` flat in period count instead of looping
 * `getVehicleMonthReport` once per accounting period. This is that
 * measurement turned into a standing regression guard — 35, deliberately
 * well under 50, because staying on the Free plan (the recorded decision)
 * means there is no margin to absorb a miss.
 */
describe("GAP-145: subrequest ceiling on the report/summary endpoints", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("GET /api/partner/{userId} stays under the Free-plan ceiling with six vehicles and several closed periods behind the open one", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();

    // Six vehicles, matching the live business the QA pass actually found
    // this on (QA-FINDINGS-2026-08-19's F-8/GAP-145 repro).
    for (let i = 0; i < 6; i++) {
      await ctx.createVehicle(businessId, { registration: `SR-${String(1000 + i)}` });
    }

    // Six closed periods behind the open one — sumAllTimeEarnedForUser is
    // the half of this endpoint that scales with period count rather than
    // vehicle count, and this is the axis GAP-145's second layer exists for.
    for (let m = 1; m <= 6; m++) {
      const id = newId();
      const mm = String(m).padStart(2, "0");
      await db.insert(accountingPeriod).values({
        id,
        businessId,
        periodStart: `2026-${mm}-01`,
        periodEnd: `2026-${mm}-28`,
        status: "closed",
      });
      ctx.track(async () => {
        // eslint-disable-next-line no-restricted-syntax -- allow: test fixture teardown on a disposable Neon branch (IG §8.3), the same shape TestContext's own sanctioned helpers use
        await db.delete(accountingPeriod).where(eq(accountingPeriod.id, id));
      });
    }
    await ctx.createOpenPeriod(businessId, { periodStart: "2026-07-01", periodEnd: "2026-07-31" });

    // The exact live shape: an owner-manager with no ownership_share and no
    // management_fee_agreement on any vehicle — an ordinary state, not a
    // contrived edge case (F-8's own finding).
    const owner = await mintUser(db, ctx, businessId, "owner_manager");
    const token = await signAccessToken(owner.asgardeoSub);

    const { result: res, count } = await countFetches(async () =>
      request(`/api/partner/${owner.userId}`, bearer(token)),
    );

    expect(res.status).toBe(200);
    expect(count).toBeLessThan(35);

    await ctx.cleanup();
  });
});
