import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import { attachment } from "../db/schema.js";

type WriteDb = Writer | Tx;
type ReadDb = Reader | Writer | Tx;

export interface AttachmentRow {
  id: string;
  kind: string;
  subjectType: string;
  subjectId: string;
  contentType: string;
  sizeBytes: number;
  r2Key: string;
  uploadedAt: string;
  voidedAt: string | null;
}

export interface NewAttachment {
  id: string;
  businessId: string;
  kind: string;
  r2Key: string;
  contentType: string;
  sizeBytes: number;
  subjectType: string;
  subjectId: string;
  uploadedBy?: string;
}

export async function insertAttachment(db: WriteDb, values: NewAttachment): Promise<void> {
  await db.insert(attachment).values(values);
}

/**
 * Business-scoped, by id — the pre-read the idempotency sequence needs
 * before it writes anything (A7's plan, "Idempotency"), and the same lookup
 * `GET /{id}` and the void handler both use. Voided rows are included
 * deliberately: the caller decides what a voided hit means (404 on read,
 * `ATTACHMENT_ALREADY_VOIDED` on a second void) — filtering here would make
 * that distinction unreachable.
 */
export async function findAttachmentForBusiness(
  db: ReadDb,
  businessId: string,
  attachmentId: string,
): Promise<AttachmentRow | undefined> {
  const rows = await db
    .select({
      id: attachment.id,
      kind: attachment.kind,
      subjectType: attachment.subjectType,
      subjectId: attachment.subjectId,
      contentType: attachment.contentType,
      sizeBytes: attachment.sizeBytes,
      r2Key: attachment.r2Key,
      uploadedAt: attachment.uploadedAt,
      voidedAt: attachment.voidedAt,
    })
    .from(attachment)
    .where(and(eq(attachment.id, attachmentId), eq(attachment.businessId, businessId)))
    .limit(1);
  return rows[0];
}

export interface AttachmentListRow {
  id: string;
  kind: string;
  subjectType: string;
  subjectId: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
}

/** Uses `attachment_subject_live` (migration 0013) — tenant-scoped, voided rows excluded, newest first. */
export async function listAttachmentsForSubject(
  db: ReadDb,
  businessId: string,
  subjectType: string,
  subjectId: string,
): Promise<AttachmentListRow[]> {
  const rows = await db
    .select({
      id: attachment.id,
      kind: attachment.kind,
      subjectType: attachment.subjectType,
      subjectId: attachment.subjectId,
      contentType: attachment.contentType,
      sizeBytes: attachment.sizeBytes,
      uploadedAt: attachment.uploadedAt,
    })
    .from(attachment)
    .where(
      and(
        eq(attachment.businessId, businessId),
        eq(attachment.subjectType, subjectType),
        eq(attachment.subjectId, subjectId),
        isNull(attachment.voidedAt),
      ),
    )
    .orderBy(desc(attachment.uploadedAt));
  return rows;
}

/** W-50: void, never delete — the object stays in R2 (A7's plan, decision 3); this only marks the row. */
export async function voidAttachmentRow(
  db: WriteDb,
  attachmentId: string,
  values: { voidedReason: string; voidedBy: string },
): Promise<{ voidedAt: string }> {
  const rows = await db
    .update(attachment)
    .set({ voidedAt: sql`now()`, voidedReason: values.voidedReason, voidedBy: values.voidedBy })
    .where(eq(attachment.id, attachmentId))
    .returning({ voidedAt: attachment.voidedAt });
  // voidedAt is written by the SET above, in the same statement — never null on the row this WHERE just matched.
  return rows[0] as { voidedAt: string };
}
