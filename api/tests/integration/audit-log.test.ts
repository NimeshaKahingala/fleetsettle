import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { mintLinkedDriver, mintUser, signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

async function postExpense(token: string, body: unknown) {
  return request("/api/expense", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

async function postVoidExpense(token: string, id: string, body: unknown) {
  return request(`/api/expense/${id}/void`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

async function getAuditLog(token: string, tableName: string, recordId: string) {
  return request(`/api/audit-log/${tableName}/${recordId}`, bearer(token));
}

interface AuditEntry {
  id: string;
  action: "insert" | "update" | "void";
  changedBy: string | null;
  changedAt: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

/**
 * F-8.6/UC-97/INV-28. Proves two things the writer alone can't: that
 * `write_audit_log()` (migration 0002) actually captures a record's whole
 * history, readable from the record itself — and that `changed_by` is a
 * real actor, not the NULL every row silently carried before `withActor`
 * (db/client.ts) started setting `fleetsettle.actor_id` on every
 * transaction.
 */
describe("see who changed what (P9, F-8.6/UC-97)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("an insert then a void both appear, newest first, attributed to the acting user", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const createRes = await postExpense(token, {
      category: "office",
      amountMinor: "50000",
      spentOn: "2026-07-15",
    });
    expect(createRes.status).toBe(201);
    const createBody: { id: string } = await createRes.json();
    ctx.trackCreatedExpense(createBody.id);

    const voidRes = await postVoidExpense(token, createBody.id, { reason: "wrong vehicle" });
    expect(voidRes.status).toBe(200);

    const res = await getAuditLog(token, "expense", createBody.id);
    expect(res.status).toBe(200);
    const body: { entries: AuditEntry[] } = await res.json();
    expect(body.entries).toHaveLength(2);

    const [newest, oldest] = body.entries;
    expect(newest).toMatchObject({ action: "void", changedBy: owner.userId });
    expect(oldest).toMatchObject({ action: "insert", changedBy: owner.userId });
    expect(newest?.after).toMatchObject({ voided_reason: "wrong vehicle" });
    expect(new Date(newest?.changedAt ?? 0).getTime()).toBeGreaterThanOrEqual(
      new Date(oldest?.changedAt ?? 0).getTime(),
    );

    await ctx.cleanup();
  });

  it("an untouched record returns an empty list, not a 404 (no distinction to leak)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await getAuditLog(token, "expense", "11111111-1111-4111-8111-111111111111");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries: [] });

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await getAuditLog("", "expense", "11111111-1111-4111-8111-111111111111");
    expect(res.status).toBe(401);
  });

  it("403 — a linked driver cannot read the audit trail", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await getAuditLog(token, "expense", "11111111-1111-4111-8111-111111111111");
    expect(res.status).toBe(403);

    await ctx.cleanup();
  });
});
