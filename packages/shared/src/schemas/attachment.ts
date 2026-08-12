import { z } from "zod";
import { uuidSchema } from "./common.js";

/** Migration 0013's `attachment_content_type_allowed` CHECK — one list, so the handler's own check and the database's can never quietly drift apart. */
export const ATTACHMENT_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AttachmentContentType = (typeof ATTACHMENT_CONTENT_TYPES)[number];

/** DM §12's `CHECK` on `attachment.kind`, unchanged since migration 0001. */
export const attachmentKindSchema = z.enum([
  "condition_handover",
  "condition_return",
  "expense_receipt",
  "odometer",
  "incident",
  "ticket",
]);
export type AttachmentKind = z.infer<typeof attachmentKindSchema>;

/**
 * A7's plan, "The subject dispatch table": every subject `attachment` can
 * legally point at, not only the one this branch's API accepts — GAP-16's
 * five call sites, condensed to their owning entity (`lease` covers both
 * the handover and return condition sets, W-30: the pair is one artefact).
 */
export const attachmentSubjectTypeSchema = z.enum([
  "expense",
  "lease",
  "incident",
  "odometer_reading",
  "post_closure_charge",
]);
export type AttachmentSubjectType = z.infer<typeof attachmentSubjectTypeSchema>;

/**
 * `kind` and `subjectType` are not independent — a `condition_handover` on
 * an `expense` is nonsense the database would otherwise store happily.
 * Mirrors migration 0013's `attachment_kind_subject_type_pair` CHECK
 * exactly; kept as one list so the two can never quietly drift apart.
 */
export const ATTACHMENT_SUBJECT_KIND_PAIRS: readonly {
  readonly subjectType: AttachmentSubjectType;
  readonly kind: AttachmentKind;
}[] = [
  { subjectType: "expense", kind: "expense_receipt" },
  { subjectType: "lease", kind: "condition_handover" },
  { subjectType: "lease", kind: "condition_return" },
  { subjectType: "incident", kind: "incident" },
  { subjectType: "odometer_reading", kind: "odometer" },
  { subjectType: "post_closure_charge", kind: "ticket" },
];

export function isLegalAttachmentSubjectKindPair(
  subjectType: AttachmentSubjectType,
  kind: AttachmentKind,
): boolean {
  return ATTACHMENT_SUBJECT_KIND_PAIRS.some(
    (pair) => pair.subjectType === subjectType && pair.kind === kind,
  );
}

/**
 * `POST /api/attachment?id=&kind=&subjectType=&subjectId=` — the image is
 * the raw request body, not declared here (A7's plan, "Request shape":
 * `@hono/zod-openapi` only special-cases JSON and form content types, so a
 * binary body is read directly in the handler via `c.req.arrayBuffer()`).
 * `id` is client-minted (UUIDv7) and resent unchanged on every retry — the
 * whole client half of the idempotency contract (A7's plan, "Idempotency").
 * This schema only checks what is legal in the database; whether this
 * branch's API actually accepts a given `subjectType` is a second,
 * deliberately separate gate the handler enforces (A7's plan, decision 5).
 */
export const attachmentUploadQuerySchema = z
  .object({
    id: uuidSchema,
    kind: attachmentKindSchema,
    subjectType: attachmentSubjectTypeSchema,
    subjectId: uuidSchema,
  })
  .superRefine((v, ctx) => {
    if (!isLegalAttachmentSubjectKindPair(v.subjectType, v.kind)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `kind "${v.kind}" is not valid for subjectType "${v.subjectType}"`,
        path: ["kind"],
      });
    }
  });
export type AttachmentUploadQuery = z.infer<typeof attachmentUploadQuerySchema>;

/** `GET /api/attachment?subjectType=&subjectId=` — the metadata list for one subject, voided rows excluded. */
export const listAttachmentsQuerySchema = z.object({
  subjectType: attachmentSubjectTypeSchema,
  subjectId: uuidSchema,
});
export type ListAttachmentsQuery = z.infer<typeof listAttachmentsQuerySchema>;

export const attachmentResponseSchema = z.object({
  id: uuidSchema,
  kind: attachmentKindSchema,
  subjectType: attachmentSubjectTypeSchema,
  subjectId: uuidSchema,
  contentType: z.string(),
  // eslint-disable-next-line no-restricted-syntax -- byte count, not money
  sizeBytes: z.number().int().positive(),
  uploadedAt: z.string(),
});
export type AttachmentResponse = z.infer<typeof attachmentResponseSchema>;

export const listAttachmentsResponseSchema = z.array(attachmentResponseSchema);
export type ListAttachmentsResponse = z.infer<typeof listAttachmentsResponseSchema>;

/** `POST /api/attachment/{id}/void` — mirrors `voidExpenseRequestSchema`: void, never delete (W-50), a reason always required. */
export const voidAttachmentRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type VoidAttachmentRequest = z.infer<typeof voidAttachmentRequestSchema>;

export const voidedAttachmentResponseSchema = z.object({
  id: uuidSchema,
  voidedAt: z.string(),
});
export type VoidedAttachmentResponse = z.infer<typeof voidedAttachmentResponseSchema>;
