import { afterAll, describe, expect, it } from "vitest";
import { writer } from "../../src/db/client.js";
import { mintLinkedDriver, mintUser, signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

async function postMileagePackage(token: string, body: unknown) {
  return request("/api/mileage-package", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token).headers },
    body: JSON.stringify(body),
  });
}

async function listMileagePackages(token: string) {
  return request("/api/mileage-package", bearer(token));
}

async function archiveMileagePackage(token: string, id: string) {
  return request(`/api/mileage-package/${id}/archive`, {
    method: "POST",
    ...bearer(token),
  });
}

/**
 * F-1.9/UC-18 test matrix. 401 and 403 are proven once here rather than per
 * route — all three share the same `authMiddleware` chain and the same
 * `manageEntities` capability check (already exhaustively covered for the
 * middleware itself in auth.test.ts).
 */
describe("mileage packages (Web-P6a, F-1.9/UC-18)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — create, list, archive; archiving never deletes", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const created = await postMileagePackage(token, {
      name: "Standard 100",
      dailyLimitKm: 100,
      excessRateMinorPerKm: "5000",
    });
    expect(created.status).toBe(201);
    const createdBody: { id: string; name: string; archivedAt: string | null } =
      await created.json();
    expect(createdBody).toMatchObject({ name: "Standard 100", archivedAt: null });
    ctx.trackCreatedMileagePackage(createdBody.id);

    const listedBeforeArchive = await listMileagePackages(token);
    expect(listedBeforeArchive.status).toBe(200);
    const beforeBody: Array<{ id: string; archivedAt: string | null }> =
      await listedBeforeArchive.json();
    expect(beforeBody.map((p) => p.id)).toContain(createdBody.id);
    expect(beforeBody.find((p) => p.id === createdBody.id)?.archivedAt).toBeNull();

    const archived = await archiveMileagePackage(token, createdBody.id);
    expect(archived.status).toBe(200);
    const archivedBody: { id: string; archivedAt: string | null } = await archived.json();
    expect(archivedBody.id).toBe(createdBody.id);
    expect(archivedBody.archivedAt).not.toBeNull();

    // Still present, not deleted (F-1.9's Accept: "deleting a package leaves every lease using it untouched").
    const listedAfterArchive = await listMileagePackages(token);
    const afterBody: Array<{ id: string; archivedAt: string | null }> =
      await listedAfterArchive.json();
    expect(afterBody.find((p) => p.id === createdBody.id)?.archivedAt).not.toBeNull();

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await request("/api/mileage-package");
    expect(res.status).toBe(401);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "MISSING_TOKEN" });
  });

  it("403 — a linked driver cannot manage mileage packages (manageEntities is STAFF-only)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await listMileagePackages(token);
    expect(res.status).toBe(403);
    const responseBody: { code: string } = await res.json();
    expect(responseBody).toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

    await ctx.cleanup();
  });

  it("404 — archiving a package belonging to another business", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    const otherBusinessId = await ctx.createBusiness({ name: "Someone Else's Fleet" });
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const otherOwner = await mintUser(db, ctx, otherBusinessId, "owner");
    const otherToken = await signAccessToken(otherOwner.asgardeoSub);
    const otherCreated = await postMileagePackage(otherToken, {
      name: "Someone else's package",
      dailyLimitKm: 150,
      excessRateMinorPerKm: "6000",
    });
    const otherBody: { id: string } = await otherCreated.json();
    ctx.trackCreatedMileagePackage(otherBody.id);

    const res = await archiveMileagePackage(token, otherBody.id);
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });
});
