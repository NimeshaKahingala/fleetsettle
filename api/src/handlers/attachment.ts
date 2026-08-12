import { ATTACHMENT_CONTENT_TYPES, type AttachmentSubjectType } from "@fleetsettle/shared/schemas";
import type { RouteHandler } from "@hono/zod-openapi";
import type { Capability } from "../auth/policy.js";
import { requireBusinessId, requireCapability, requireUserId } from "../auth/context.js";
import type { Reader } from "../db/client.js";
import { uploadAttachment, voidAttachment } from "../domain/attachment.js";
import {
  AttachmentSubjectUnsupportedError,
  AttachmentTooLargeError,
  AttachmentTypeUnsupportedError,
  NotFoundError,
  ValidationError,
} from "../errors/app-error.js";
import { findExpenseForBusiness } from "../queries/expense.js";
import {
  findAttachmentForBusiness,
  listAttachmentsForSubject,
  type AttachmentListRow,
  type AttachmentRow,
} from "../queries/attachment.js";
import type {
  createAttachmentRoute,
  getAttachmentRoute,
  listAttachmentsRoute,
  voidAttachmentRoute,
} from "../route-defs/attachment.js";
import type { Env } from "../types.js";

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

interface AttachmentSubjectSupport {
  capability: Capability;
  /** Undefined = no such subject in this business. `voidedAt` lets the caller decide what "voided" means for an upload vs. a read. */
  findSubject: (
    reader: Reader,
    businessId: string,
    subjectId: string,
  ) => Promise<{ voidedAt: string | null } | undefined>;
}

/**
 * A7's plan, decision 5: "legal in the database" (migration 0013's CHECK,
 * every `AttachmentSubjectType`) and "supported by this branch's API" are
 * two separate gates. Only `expense` is populated — every other legal
 * subject type fails here with a deliberate 400, not a missing-map-entry
 * exception (finding D). A second branch adds a row here per new call site,
 * never a hardcoded capability check bypassing this map.
 */
const SUPPORTED_ATTACHMENT_SUBJECTS: Partial<
  Record<AttachmentSubjectType, AttachmentSubjectSupport>
> = {
  expense: {
    capability: "dailyOperations",
    findSubject: async (reader, businessId, subjectId) => {
      const row = await findExpenseForBusiness(reader, businessId, subjectId);
      return row ? { voidedAt: row.voidedAt } : undefined;
    },
  },
};

function requireSupportedSubject(subjectType: AttachmentSubjectType): AttachmentSubjectSupport {
  const entry = SUPPORTED_ATTACHMENT_SUBJECTS[subjectType];
  if (!entry) throw new AttachmentSubjectUnsupportedError();
  return entry;
}

function toAttachmentResponse(row: AttachmentRow | AttachmentListRow) {
  return {
    id: row.id,
    kind: row.kind,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    uploadedAt: row.uploadedAt,
  } as const;
}

/**
 * A7/GAP-16. Order: reject an unsupported `subjectType` before anything
 * else (decision 5) → capability from the dispatch map (finding D) →
 * `businessId` → the subject itself, re-checked in this business and not
 * voided (a voided subject 404s, indistinguishable from a missing one) →
 * content type and size, ahead of touching R2 → the domain's own
 * pre-read/write/insert idempotency sequence.
 */
export const createAttachmentHandler: RouteHandler<typeof createAttachmentRoute, Env> = async (
  c,
) => {
  const query = c.req.valid("query");
  const support = requireSupportedSubject(query.subjectType);
  requireCapability(c, support.capability);
  const businessId = requireBusinessId(c);
  const userId = requireUserId(c);

  const subject = await support.findSubject(c.get("reader"), businessId, query.subjectId);
  if (!subject || subject.voidedAt !== null) {
    throw new NotFoundError("No such subject in this business");
  }

  const contentType = c.req.header("content-type");
  if (
    !contentType ||
    !(ATTACHMENT_CONTENT_TYPES as readonly string[]).includes(
      contentType.split(";")[0]?.trim() ?? "",
    )
  ) {
    throw new AttachmentTypeUnsupportedError();
  }

  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength === 0) throw new ValidationError("The uploaded file is empty");
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new AttachmentTooLargeError();

  const { row, created } = await uploadAttachment(c.get("writer"), c.env.R2, {
    id: query.id,
    businessId,
    kind: query.kind,
    subjectType: query.subjectType,
    subjectId: query.subjectId,
    contentType: contentType.split(";")[0]?.trim() ?? contentType,
    bytes,
    uploadedBy: userId,
  });

  return c.json(toAttachmentResponse(row), created ? 201 : 200);
};

/**
 * Streams the object through the Worker, never a public or presigned URL
 * (decisions 1–2) — `business_id` and the subject's own capability are
 * re-checked on every request, so no cached copy outlives its own
 * authorisation check. A row that exists but whose R2 object is missing is
 * corruption, not an ordinary miss (A7's plan, "Read semantics"): the
 * caller still gets 404, but it is logged as an error, because it means
 * decision 1's row/object guarantee has failed somewhere.
 */
export const getAttachmentHandler: RouteHandler<typeof getAttachmentRoute, Env> = async (c) => {
  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");
  const reader = c.get("reader");

  const row = await findAttachmentForBusiness(reader, businessId, id);
  if (!row || row.voidedAt !== null) throw new NotFoundError("No such attachment in this business");

  const support = requireSupportedSubject(row.subjectType as AttachmentSubjectType);
  requireCapability(c, support.capability);

  const object = await c.env.R2.get(row.r2Key);
  if (!object) {
    // eslint-disable-next-line no-console -- IG §3.4: row/object disagreement is exactly the failure decision 1 exists to prevent, and it must not be swallowed silently
    console.log(
      JSON.stringify({
        level: "error",
        msg: "attachment row exists but its R2 object is missing",
        businessId,
        attachmentId: row.id,
        r2Key: row.r2Key,
      }),
    );
    throw new NotFoundError("No such attachment in this business");
  }

  return c.body(object.body, 200, {
    "Content-Type": row.contentType,
    "Content-Length": String(row.sizeBytes),
    "Cache-Control": "private, no-store, no-transform",
    "X-Content-Type-Options": "nosniff",
  });
};

/** The metadata list for one subject — no existence check on the subject itself, the same "businessId scoping already excludes it" convention `listExpensesRoute` uses (an unowned or nonexistent subject simply returns an empty list). */
export const listAttachmentsHandler: RouteHandler<typeof listAttachmentsRoute, Env> = async (c) => {
  const query = c.req.valid("query");
  const support = requireSupportedSubject(query.subjectType);
  requireCapability(c, support.capability);
  const businessId = requireBusinessId(c);

  const rows = await listAttachmentsForSubject(
    c.get("reader"),
    businessId,
    query.subjectType,
    query.subjectId,
  );
  return c.json(rows.map(toAttachmentResponse), 200);
};

/** W-50: void, never delete. The attachment's own `subjectType` decides the capability, the same as the read path (decision 4) — resolved from a pre-read, since the route only carries the attachment id. */
export const voidAttachmentHandler: RouteHandler<typeof voidAttachmentRoute, Env> = async (c) => {
  const businessId = requireBusinessId(c);
  const userId = requireUserId(c);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");

  const row = await findAttachmentForBusiness(c.get("reader"), businessId, id);
  if (!row) throw new NotFoundError("No such attachment in this business");
  const support = requireSupportedSubject(row.subjectType as AttachmentSubjectType);
  requireCapability(c, support.capability);

  const result = await voidAttachment(c.get("writer"), {
    businessId,
    attachmentId: id,
    reason: body.reason,
    userId,
  });

  return c.json(result, 200);
};
