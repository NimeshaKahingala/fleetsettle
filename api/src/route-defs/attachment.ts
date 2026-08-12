import { createRoute } from "@hono/zod-openapi";
import {
  attachmentResponseSchema,
  attachmentUploadQuerySchema,
  listAttachmentsQuerySchema,
  listAttachmentsResponseSchema,
  voidAttachmentRequestSchema,
  voidedAttachmentResponseSchema,
} from "@fleetsettle/shared/schemas";
import { z } from "zod";

const attachmentIdParams = z.object({ id: z.string().uuid() });

/**
 * A7/GAP-16. The image is the raw request body, deliberately not declared
 * here: `@hono/zod-openapi` only special-cases `application/json` and form
 * content types for body validation (confirmed against the installed
 * package, not assumed — A7's plan, "Request shape"), so a binary body is
 * read directly in the handler via `c.req.arrayBuffer()`. `id` is
 * client-minted (UUIDv7) and resent unchanged on every retry — the whole
 * idempotency contract (A7's plan, "Idempotency"); a replay of the same
 * `id` returns `200`, a first write returns `201`.
 */
export const createAttachmentRoute = createRoute({
  method: "post",
  path: "/",
  request: { query: attachmentUploadQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: attachmentResponseSchema } },
      description: "An idempotent replay of an already-uploaded attachment with this id",
    },
    201: {
      content: { "application/json": { schema: attachmentResponseSchema } },
      description: "The uploaded attachment",
    },
    400: {
      description:
        "kind does not match subjectType, the content type is not image/jpeg|png|webp, or subjectType is not yet supported by this endpoint",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot upload an attachment for this subject type" },
    404: { description: "No such subject in this business, or that subject has been voided" },
    409: { description: "This id is already in use for a different upload" },
    413: { description: "The file is larger than the 5 MiB upload limit" },
  },
});

/**
 * Streams the object's bytes — never a public bucket URL, never a
 * presigned one either (A7's plan, decisions 1–2: `business_id` is
 * re-checked on every request, so no copy of this response outlives its
 * own authorisation check). `Cache-Control: private, no-store`.
 */
export const getAttachmentRoute = createRoute({
  method: "get",
  path: "/{id}",
  request: { params: attachmentIdParams },
  responses: {
    200: { description: "The image bytes, with the stored content type" },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read attachments for this subject type" },
    404: { description: "No such attachment in this business, or it has been voided" },
  },
});

/** The metadata list for one subject, voided rows excluded, newest first. */
export const listAttachmentsRoute = createRoute({
  method: "get",
  path: "/",
  request: { query: listAttachmentsQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: listAttachmentsResponseSchema } },
      description: "Every live attachment for this subject, newest first",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read attachments for this subject type" },
  },
});

/** W-50: void, never delete — mirrors `voidExpenseRoute` exactly. The object stays in R2. */
export const voidAttachmentRoute = createRoute({
  method: "post",
  path: "/{id}/void",
  request: {
    params: attachmentIdParams,
    body: { content: { "application/json": { schema: voidAttachmentRequestSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: voidedAttachmentResponseSchema } },
      description: "The voided attachment",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot void an attachment" },
    404: { description: "No such attachment in this business" },
    409: { description: "This attachment has already been voided" },
  },
});
