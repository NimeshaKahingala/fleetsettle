import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import {
  accountingPeriod,
  appUser,
  businessMember,
  businessSettings,
} from "../../src/db/schema.js";
import { signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function post(body: unknown, token?: string) {
  return request("/api/business", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? bearer(token) : {}),
    },
    body: JSON.stringify(body),
  });
}

/**
 * F-0.1 / UC-08 test matrix: happy path (all four writes, in the creation
 * month) · 401 missing header · 401 verifier throws · 400 validation ·
 * 409 the same identity already has a business. No 403/404/PERIOD_CLOSED
 * case — this route has no capability gate (nothing exists yet to gate) and
 * no business selector to leak across tenants.
 */
describe("POST /api/business (P2, F-0.1/UC-08)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — one owner, settings, and the first open period covering the creation month", async () => {
    const ctx = new TestContext(db);
    const sub = `test-sub-new-owner-${crypto.randomUUID()}`;
    const token = await signAccessToken(sub);

    const res = await post(
      { name: "Perera Transport", currencyCode: "lkr", timezone: "Asia/Colombo" },
      token,
    );
    expect(res.status).toBe(201);
    const body: {
      id: string;
      name: string;
      currencyCode: string;
      timezone: string;
      accountingPeriodId: string;
    } = await res.json();
    expect(body).toMatchObject({
      name: "Perera Transport",
      currencyCode: "LKR", // lower-cased input, upper-cased on the wire (W-54)
      timezone: "Asia/Colombo",
    });

    const userRows = await db.select().from(appUser).where(eq(appUser.asgardeoSub, sub));
    expect(userRows).toHaveLength(1);
    ctx.trackCreatedBusiness(body.id, userRows[0]!.id);

    const memberRows = await db
      .select()
      .from(businessMember)
      .where(eq(businessMember.businessId, body.id));
    expect(memberRows).toHaveLength(1);
    expect(memberRows[0]).toMatchObject({ userId: userRows[0]!.id, role: "owner" });

    const settingsRows = await db
      .select()
      .from(businessSettings)
      .where(eq(businessSettings.businessId, body.id));
    expect(settingsRows).toHaveLength(1);
    expect(settingsRows[0]).toMatchObject({
      autoWaiveThresholdMinor: 0n,
      paperworkWarnDays: 30,
      sendWindowStart: "08:00:00",
      sendWindowEnd: "20:00:00",
    });

    const periodRows = await db
      .select()
      .from(accountingPeriod)
      .where(eq(accountingPeriod.id, body.accountingPeriodId));
    expect(periodRows).toHaveLength(1);
    const period = periodRows[0]!;
    expect(period.status).toBe("open");
    // Covers the whole calendar month, whatever "today" is when the suite runs.
    expect(period.periodStart.slice(8, 10)).toBe("01");
    expect(period.periodStart.slice(0, 7)).toBe(period.periodEnd.slice(0, 7));

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await post({ name: "No Token Fleet", currencyCode: "LKR", timezone: "UTC" });
    expect(res.status).toBe(401);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "MISSING_TOKEN" });
  });

  it("401 — the verifier rejects a token it did not sign", async () => {
    const res = await post(
      { name: "Bad Token Fleet", currencyCode: "LKR", timezone: "UTC" },
      "not-a-real-jwt",
    );
    expect(res.status).toBe(401);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("400 — fails its own schema validation (name blank, currencyCode wrong length)", async () => {
    const token = await signAccessToken(`test-sub-bad-payload-${crypto.randomUUID()}`);
    const res = await post({ name: "", currencyCode: "LK", timezone: "Asia/Colombo" }, token);
    expect(res.status).toBe(400);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("409 — this identity already has a business (F-0.1: no multi-business membership)", async () => {
    const ctx = new TestContext(db);
    const sub = `test-sub-repeat-owner-${crypto.randomUUID()}`;
    const token = await signAccessToken(sub);

    const first = await post(
      { name: "First Fleet", currencyCode: "LKR", timezone: "Asia/Colombo" },
      token,
    );
    expect(first.status).toBe(201);
    const firstBody: { id: string; accountingPeriodId: string } = await first.json();

    const second = await post(
      { name: "Second Fleet", currencyCode: "LKR", timezone: "Asia/Colombo" },
      token,
    );
    expect(second.status).toBe(409);
    const secondBody: { code: string } = await second.json();
    expect(secondBody).toMatchObject({ code: "BUSINESS_ALREADY_EXISTS" });

    const userRows = await db.select().from(appUser).where(eq(appUser.asgardeoSub, sub));
    ctx.trackCreatedBusiness(firstBody.id, userRows[0]!.id);
    await ctx.cleanup();
  });
});
