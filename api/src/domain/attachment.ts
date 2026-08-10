import {
  findAttachmentForBusiness,
  insertAttachment,
  voidAttachmentRow,
  type AttachmentRow,
} from "../queries/attachment.js";
import { isUniqueViolation } from "../db/pg-error.js";
import {
  AttachmentAlreadyVoidedError,
  AttachmentIdConflictError,
  NotFoundError,
} from "../errors/app-error.js";
import type { Writer } from "../db/client.js";

export interface UploadAttachmentInput {
  id: string;
  businessId: string;
  kind: string;
  subjectType: string;
  subjectId: string;
  contentType: string;
  bytes: ArrayBuffer;
  uploadedBy?: string;
}

export interface UploadedAttachment {
  row: AttachmentRow;
  /** True only when this call actually wrote the row — the handler's whole 201-vs-200 decision (A7's plan, "Idempotency"). */
  created: boolean;
}

function sameUpload(row: AttachmentRow, input: UploadAttachmentInput): boolean {
  return (
    row.kind === input.kind &&
    row.subjectType === input.subjectType &&
    row.subjectId === input.subjectId
  );
}

/**
 * A7's plan, "Idempotency — the Retry button makes this mandatory, and the
 * compensation rule has to be exact". `id` is client-minted and resent
 * unchanged on every retry of the same photo (`PhotoCapture`'s own Retry
 * affordance), so this must be safe to call twice with the same `id`
 * without writing a second row or orphaning a second R2 object.
 *
 * The sequence, in the order the plan's trace of the broken first draft
 * requires: pre-read by `id` before touching anything, so a plain replay
 * never touches R2 at all; write R2 with a *fresh* key, then insert; on a
 * unique-violation race (another request for the same `id` won between this
 * request's pre-read and its insert), delete only the object *this attempt*
 * just wrote and return the winner's row — never the object an earlier,
 * successful attempt wrote, which is the orphan the first draft still
 * allowed.
 */
export async function uploadAttachment(
  writer: Writer,
  bucket: R2Bucket,
  input: UploadAttachmentInput,
): Promise<UploadedAttachment> {
  const existing = await findAttachmentForBusiness(writer, input.businessId, input.id);
  if (existing) {
    if (!sameUpload(existing, input)) throw new AttachmentIdConflictError();
    // A matching id is the same upload fact regardless of whether it has
    // since been voided (W-50: voiding marks the row, it does not erase
    // what happened) — not a case the plan's own trace names, but falling
    // through unhandled would be worse than this one extra branch.
    return { row: existing, created: false };
  }

  const r2Key = crypto.randomUUID();
  await bucket.put(r2Key, input.bytes, { httpMetadata: { contentType: input.contentType } });

  try {
    await writer.transaction((tx) =>
      insertAttachment(tx, {
        id: input.id,
        businessId: input.businessId,
        kind: input.kind,
        r2Key,
        contentType: input.contentType,
        sizeBytes: input.bytes.byteLength,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        ...(input.uploadedBy !== undefined ? { uploadedBy: input.uploadedBy } : {}),
      }),
    );
  } catch (err) {
    // Only ever this attempt's own object — an object an earlier, already-
    // successful attempt wrote belongs to the row that insert produced, and
    // deleting it would destroy a good upload (the exact failure mode this
    // whole sequence exists to prevent).
    await bucket.delete(r2Key);
    if (isUniqueViolation(err, "attachment_pkey")) {
      const winner = await findAttachmentForBusiness(writer, input.businessId, input.id);
      if (winner && sameUpload(winner, input)) return { row: winner, created: false };
      if (winner) throw new AttachmentIdConflictError();
    }
    throw err;
  }

  const row = await findAttachmentForBusiness(writer, input.businessId, input.id);
  // The insert this function's own transaction just committed — always present.
  return { row: row as AttachmentRow, created: true };
}

export interface VoidAttachmentInput {
  businessId: string;
  attachmentId: string;
  reason: string;
  userId: string;
}

export interface VoidedAttachment {
  id: string;
  voidedAt: string;
}

/**
 * W-50: void, never delete — the R2 object stays (A7's plan, decision 3).
 * Not a money table, so no `PERIOD_CLOSED` path exists to catch here.
 * Mirrors `voidExpense`'s own existence/already-voided guard exactly.
 */
export async function voidAttachment(
  writer: Writer,
  input: VoidAttachmentInput,
): Promise<VoidedAttachment> {
  const existing = await findAttachmentForBusiness(writer, input.businessId, input.attachmentId);
  if (!existing) throw new NotFoundError("No such attachment in this business");
  if (existing.voidedAt !== null) throw new AttachmentAlreadyVoidedError();

  const voided = await writer.transaction((tx) =>
    voidAttachmentRow(tx, input.attachmentId, {
      voidedReason: input.reason,
      voidedBy: input.userId,
    }),
  );
  return { id: input.attachmentId, voidedAt: voided.voidedAt };
}
