import { newId } from "@fleetsettle/shared";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { writer } from "../../src/db/client.js";
import { attachment } from "../../src/db/schema.js";
import { mintLinkedDriver, mintUser, signAccessToken } from "../support/auth.js";
import { request } from "../support/client.js";
import { TEST_DATABASE_URL, testR2 } from "../support/env.js";
import { TestContext } from "../support/factories.js";

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

const JPEG_BYTES = new TextEncoder().encode("fake-jpeg-bytes");

interface UploadQuery {
  id: string;
  kind: string;
  subjectType: string;
  subjectId: string;
  [key: string]: string;
}

async function postAttachment(
  token: string,
  query: UploadQuery,
  bytes: Uint8Array = JPEG_BYTES,
  contentType = "image/jpeg",
) {
  return request(`/api/attachment?${new URLSearchParams(query).toString()}`, {
    method: "POST",
    headers: { "Content-Type": contentType, ...bearer(token) },
    body: bytes,
  });
}

async function getAttachment(token: string, id: string) {
  return request(`/api/attachment/${id}`, { headers: bearer(token) });
}

async function listAttachments(token: string, subjectType: string, subjectId: string) {
  return request(`/api/attachment?${new URLSearchParams({ subjectType, subjectId }).toString()}`, {
    headers: bearer(token),
  });
}

async function postVoidAttachment(token: string, id: string, body: unknown) {
  return request(`/api/attachment/${id}/void`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token) },
    body: JSON.stringify(body),
  });
}

async function postExpense(token: string, body: unknown) {
  return request("/api/expense", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token) },
    body: JSON.stringify(body),
  });
}

async function postVoidExpense(token: string, id: string, body: unknown) {
  return request(`/api/expense/${id}/void`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token) },
    body: JSON.stringify(body),
  });
}

/** A live expense subject — the one call site this branch builds. */
async function createExpenseSubject(ctx: TestContext, token: string): Promise<string> {
  const res = await postExpense(token, {
    category: "fuel",
    amountMinor: "50000",
    spentOn: "2026-07-15",
  });
  const body: { id: string } = await res.json();
  ctx.trackCreatedExpense(body.id);
  return body.id;
}

/**
 * A7/GAP-16. Upload through the Worker binding, presign nothing (decisions
 * 1–2): every request re-checks `business_id` and the subject's own
 * capability, so no cached or signed URL ever outlives its own
 * authorisation check. `id` is client-minted (the same shape `newId()`
 * produces for a real client) and resent unchanged on retry — the
 * idempotency contract this suite spends most of its cases proving.
 */
describe("upload an attachment (A7/GAP-16)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — 201, the row's fields, and exactly one R2 object", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);
    const expenseId = await createExpenseSubject(ctx, token);

    const id = newId();
    const before = testR2.objectCount;
    const res = await postAttachment(token, {
      id,
      kind: "expense_receipt",
      subjectType: "expense",
      subjectId: expenseId,
    });
    expect(res.status).toBe(201);
    const body: {
      id: string;
      kind: string;
      subjectType: string;
      subjectId: string;
      contentType: string;
      sizeBytes: number;
    } = await res.json();
    expect(body).toMatchObject({
      id,
      kind: "expense_receipt",
      subjectType: "expense",
      subjectId: expenseId,
      contentType: "image/jpeg",
      sizeBytes: JPEG_BYTES.byteLength,
    });
    expect(testR2.objectCount).toBe(before + 1);

    await ctx.cleanup();
  });

  it("idempotent replay — the identical id twice yields 201 then 200, one row, one object", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);
    const expenseId = await createExpenseSubject(ctx, token);

    const id = newId();
    const query = { id, kind: "expense_receipt", subjectType: "expense", subjectId: expenseId };
    const before = testR2.objectCount;

    const first = await postAttachment(token, query);
    expect(first.status).toBe(201);

    const second = await postAttachment(token, query);
    expect(second.status).toBe(200);
    const secondBody: { id: string } = await second.json();
    expect(secondBody.id).toBe(id);

    // A replay must never touch R2 again — only the first attempt wrote.
    expect(testR2.objectCount).toBe(before + 1);

    await ctx.cleanup();
  });

  it("concurrency — two requests racing on the same id still leave exactly one row and one object", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);
    const expenseId = await createExpenseSubject(ctx, token);

    const id = newId();
    const query = { id, kind: "expense_receipt", subjectType: "expense", subjectId: expenseId };
    const before = testR2.objectCount;

    const [a, b] = await Promise.all([postAttachment(token, query), postAttachment(token, query)]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);

    expect(testR2.objectCount).toBe(before + 1);
    const rows = await db.select().from(attachment).where(eq(attachment.id, id));
    expect(rows).toHaveLength(1);

    await ctx.cleanup();
  });

  it("409 — the same id reused for a different subject is a conflict, not a replay", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);
    const firstExpenseId = await createExpenseSubject(ctx, token);
    const secondExpenseId = await createExpenseSubject(ctx, token);

    const id = newId();
    const first = await postAttachment(token, {
      id,
      kind: "expense_receipt",
      subjectType: "expense",
      subjectId: firstExpenseId,
    });
    expect(first.status).toBe(201);

    const res = await postAttachment(token, {
      id,
      kind: "expense_receipt",
      subjectType: "expense",
      subjectId: secondExpenseId,
    });
    expect(res.status).toBe(409);
    const body: { code: string } = await res.json();
    expect(body).toMatchObject({ code: "ATTACHMENT_ID_CONFLICT" });

    await ctx.cleanup();
  });

  it("400 — kind does not match subjectType", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);
    const expenseId = await createExpenseSubject(ctx, token);

    const res = await postAttachment(token, {
      id: newId(),
      kind: "condition_handover",
      subjectType: "expense",
      subjectId: expenseId,
    });
    expect(res.status).toBe(400);

    await ctx.cleanup();
  });

  it("400 — a subjectType that is legal in the database but not built by this branch's API", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postAttachment(token, {
      id: newId(),
      kind: "condition_handover",
      subjectType: "lease",
      subjectId: newId(),
    });
    expect(res.status).toBe(400);
    const body: { code: string } = await res.json();
    expect(body).toMatchObject({ code: "ATTACHMENT_SUBJECT_UNSUPPORTED" });

    await ctx.cleanup();
  });

  it("400 — a content type outside the image/jpeg|png|webp allowlist", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);
    const expenseId = await createExpenseSubject(ctx, token);

    const res = await postAttachment(
      token,
      { id: newId(), kind: "expense_receipt", subjectType: "expense", subjectId: expenseId },
      JPEG_BYTES,
      "application/pdf",
    );
    expect(res.status).toBe(400);
    const body: { code: string } = await res.json();
    expect(body).toMatchObject({ code: "ATTACHMENT_TYPE_UNSUPPORTED" });

    await ctx.cleanup();
  });

  it("413 — larger than the 5 MiB server cap", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);
    const expenseId = await createExpenseSubject(ctx, token);

    const tooLarge = new Uint8Array(5 * 1024 * 1024 + 1);
    const before = testR2.objectCount;
    const res = await postAttachment(
      token,
      { id: newId(), kind: "expense_receipt", subjectType: "expense", subjectId: expenseId },
      tooLarge,
    );
    expect(res.status).toBe(413);
    const body: { code: string } = await res.json();
    expect(body).toMatchObject({ code: "ATTACHMENT_TOO_LARGE" });
    // Rejected before ever touching R2.
    expect(testR2.objectCount).toBe(before);

    await ctx.cleanup();
  });

  it("404 — the subject belongs to another business", async () => {
    const ctx = new TestContext(db);
    const other = new TestContext(db);
    const otherBusinessId = await other.createBusiness({ name: "Someone Else's Fleet" });
    await other.createOpenPeriod(otherBusinessId);
    const otherOwner = await mintUser(db, other, otherBusinessId, "owner");
    const otherToken = await signAccessToken(otherOwner.asgardeoSub);
    const otherExpenseId = await createExpenseSubject(other, otherToken);

    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postAttachment(token, {
      id: newId(),
      kind: "expense_receipt",
      subjectType: "expense",
      subjectId: otherExpenseId,
    });
    expect(res.status).toBe(404);

    await ctx.cleanup();
    await other.cleanup();
  });

  it("404 — uploading to an already-voided expense", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);
    const expenseId = await createExpenseSubject(ctx, token);
    await postVoidExpense(token, expenseId, { reason: "wrong vehicle" });

    const res = await postAttachment(token, {
      id: newId(),
      kind: "expense_receipt",
      subjectType: "expense",
      subjectId: expenseId,
    });
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await postAttachment("", {
      id: newId(),
      kind: "expense_receipt",
      subjectType: "expense",
      subjectId: newId(),
    });
    expect(res.status).toBe(401);
  });

  it("403 — a linked driver cannot upload an expense receipt", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await postAttachment(token, {
      id: newId(),
      kind: "expense_receipt",
      subjectType: "expense",
      subjectId: newId(),
    });
    expect(res.status).toBe(403);

    await ctx.cleanup();
  });
});

/**
 * Streamed through the Worker, never a public or presigned URL (decisions
 * 1–2) — re-authorised on every request. Decision 4: reads are gated
 * exactly like writes, so a linked driver gets 403, never a subject-
 * specific 404, since this branch gives drivers no attachment read path.
 */
describe("read an attachment (A7/GAP-16)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — the exact bytes, content type, and QA/dev diagnostics come back", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);
    const expenseId = await createExpenseSubject(ctx, token);

    const id = newId();
    await postAttachment(token, {
      id,
      kind: "expense_receipt",
      subjectType: "expense",
      subjectId: expenseId,
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const res = await getAttachment(token, id);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/jpeg");
      expect(res.headers.get("cache-control")).toBe("private, no-store, no-transform");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(bytes).toEqual(JPEG_BYTES);

      const readDiagnostic = logSpy.mock.calls
        .map(([line]) => JSON.parse(String(line)) as { msg?: string })
        .find((entry) => entry.msg === "attachment object read");
      expect(readDiagnostic).toMatchObject({
        level: "info",
        businessId,
        attachmentId: id,
        dbContentType: "image/jpeg",
        dbSizeBytes: JPEG_BYTES.byteLength,
        r2SizeBytes: JPEG_BYTES.byteLength,
        r2HttpContentType: "image/jpeg",
      });
    } finally {
      logSpy.mockRestore();
    }

    await ctx.cleanup();
  });

  it("404 — a voided attachment", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);
    const expenseId = await createExpenseSubject(ctx, token);

    const id = newId();
    await postAttachment(token, {
      id,
      kind: "expense_receipt",
      subjectType: "expense",
      subjectId: expenseId,
    });
    await postVoidAttachment(token, id, { reason: "wrong photo" });

    const res = await getAttachment(token, id);
    expect(res.status).toBe(404);

    await ctx.cleanup();
  });

  it("404 — the attachment belongs to another business", async () => {
    const ctx = new TestContext(db);
    const other = new TestContext(db);
    const otherBusinessId = await other.createBusiness({ name: "Someone Else's Fleet" });
    await other.createOpenPeriod(otherBusinessId);
    const otherOwner = await mintUser(db, other, otherBusinessId, "owner");
    const otherToken = await signAccessToken(otherOwner.asgardeoSub);
    const otherExpenseId = await createExpenseSubject(other, otherToken);
    const otherAttachmentId = newId();
    await postAttachment(otherToken, {
      id: otherAttachmentId,
      kind: "expense_receipt",
      subjectType: "expense",
      subjectId: otherExpenseId,
    });

    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await getAttachment(token, otherAttachmentId);
    expect(res.status).toBe(404);

    await ctx.cleanup();
    await other.cleanup();
  });

  it("404, logged as an error — the row exists but its R2 object has gone missing (corruption, not an ordinary miss)", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);
    const expenseId = await createExpenseSubject(ctx, token);

    const id = newId();
    await postAttachment(token, {
      id,
      kind: "expense_receipt",
      subjectType: "expense",
      subjectId: expenseId,
    });
    const [row] = await db.select().from(attachment).where(eq(attachment.id, id));
    // Simulate the object vanishing from the bucket independently of the row.
    await testR2.delete(row!.r2Key);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await getAttachment(token, id);
    expect(res.status).toBe(404);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"level":"error"'));
    logSpy.mockRestore();

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await getAttachment("", newId());
    expect(res.status).toBe(401);
  });

  it("403 — a linked driver cannot read an expense receipt", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);
    const expenseId = await createExpenseSubject(ctx, token);
    const id = newId();
    await postAttachment(token, {
      id,
      kind: "expense_receipt",
      subjectType: "expense",
      subjectId: expenseId,
    });

    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const driverToken = await signAccessToken(linked.asgardeoSub);

    const res = await getAttachment(driverToken, id);
    expect(res.status).toBe(403);

    await ctx.cleanup();
  });
});

/** The metadata list for one subject — voided rows excluded, newest first. */
describe("list attachments for a subject (A7/GAP-16)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — every live attachment for the subject, a voided one excluded", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);
    const expenseId = await createExpenseSubject(ctx, token);

    const keptId = newId();
    await postAttachment(token, {
      id: keptId,
      kind: "expense_receipt",
      subjectType: "expense",
      subjectId: expenseId,
    });
    const voidedId = newId();
    await postAttachment(token, {
      id: voidedId,
      kind: "expense_receipt",
      subjectType: "expense",
      subjectId: expenseId,
    });
    await postVoidAttachment(token, voidedId, { reason: "duplicate" });

    const res = await listAttachments(token, "expense", expenseId);
    expect(res.status).toBe(200);
    const body: Array<{ id: string }> = await res.json();
    expect(body.map((r) => r.id)).toEqual([keptId]);

    await ctx.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await listAttachments("", "expense", newId());
    expect(res.status).toBe(401);
  });

  it("403 — a linked driver cannot list expense receipts", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const token = await signAccessToken(linked.asgardeoSub);

    const res = await listAttachments(token, "expense", newId());
    expect(res.status).toBe(403);

    await ctx.cleanup();
  });
});

/** W-50: void, never delete — the R2 object stays (decision 3). */
describe("void an attachment (A7/GAP-16)", () => {
  const db = writer(TEST_DATABASE_URL);
  afterAll(async () => {
    await db.$client.end();
  });

  it("happy path — voids the row, the R2 object is untouched", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);
    const expenseId = await createExpenseSubject(ctx, token);
    const id = newId();
    await postAttachment(token, {
      id,
      kind: "expense_receipt",
      subjectType: "expense",
      subjectId: expenseId,
    });
    const before = testR2.objectCount;

    const res = await postVoidAttachment(token, id, { reason: "wrong photo" });
    expect(res.status).toBe(200);
    const body: { id: string; voidedAt: string } = await res.json();
    expect(body.id).toBe(id);
    expect(body.voidedAt).toBeTruthy();
    expect(testR2.objectCount).toBe(before);

    await ctx.cleanup();
  });

  it("409 — an already-voided attachment cannot be voided again", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);
    const expenseId = await createExpenseSubject(ctx, token);
    const id = newId();
    await postAttachment(token, {
      id,
      kind: "expense_receipt",
      subjectType: "expense",
      subjectId: expenseId,
    });
    await postVoidAttachment(token, id, { reason: "first void" });

    const res = await postVoidAttachment(token, id, { reason: "second void" });
    expect(res.status).toBe(409);
    const body: { code: string } = await res.json();
    expect(body).toMatchObject({ code: "ATTACHMENT_ALREADY_VOIDED" });

    await ctx.cleanup();
  });

  it("404 — the attachment belongs to another business", async () => {
    const ctx = new TestContext(db);
    const other = new TestContext(db);
    const otherBusinessId = await other.createBusiness({ name: "Someone Else's Fleet" });
    await other.createOpenPeriod(otherBusinessId);
    const otherOwner = await mintUser(db, other, otherBusinessId, "owner");
    const otherToken = await signAccessToken(otherOwner.asgardeoSub);
    const otherExpenseId = await createExpenseSubject(other, otherToken);
    const otherAttachmentId = newId();
    await postAttachment(otherToken, {
      id: otherAttachmentId,
      kind: "expense_receipt",
      subjectType: "expense",
      subjectId: otherExpenseId,
    });

    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);

    const res = await postVoidAttachment(token, otherAttachmentId, { reason: "x" });
    expect(res.status).toBe(404);

    await ctx.cleanup();
    await other.cleanup();
  });

  it("401 — missing Authorization header", async () => {
    const res = await postVoidAttachment("", newId(), { reason: "x" });
    expect(res.status).toBe(401);
  });

  it("403 — a linked driver cannot void an expense receipt", async () => {
    const ctx = new TestContext(db);
    const businessId = await ctx.createBusiness();
    await ctx.createOpenPeriod(businessId);
    const owner = await mintUser(db, ctx, businessId, "owner");
    const token = await signAccessToken(owner.asgardeoSub);
    const expenseId = await createExpenseSubject(ctx, token);
    const id = newId();
    await postAttachment(token, {
      id,
      kind: "expense_receipt",
      subjectType: "expense",
      subjectId: expenseId,
    });

    const driverId = await ctx.createDriver(businessId);
    const linked = await mintLinkedDriver(db, ctx, driverId);
    const driverToken = await signAccessToken(linked.asgardeoSub);

    const res = await postVoidAttachment(driverToken, id, { reason: "x" });
    expect(res.status).toBe(403);

    await ctx.cleanup();
  });
});
