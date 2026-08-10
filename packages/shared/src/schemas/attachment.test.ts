import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_CONTENT_TYPES,
  ATTACHMENT_SUBJECT_KIND_PAIRS,
  attachmentUploadQuerySchema,
  isLegalAttachmentSubjectKindPair,
} from "./attachment.js";

const id = "11111111-1111-4111-8111-111111111111";
const subjectId = "22222222-2222-4222-8222-222222222222";

describe("isLegalAttachmentSubjectKindPair", () => {
  it("accepts every pair migration 0013's CHECK allows", () => {
    for (const pair of ATTACHMENT_SUBJECT_KIND_PAIRS) {
      expect(isLegalAttachmentSubjectKindPair(pair.subjectType, pair.kind)).toBe(true);
    }
  });

  it("rejects a condition_handover on an expense — the pair the CHECK exists to forbid", () => {
    expect(isLegalAttachmentSubjectKindPair("expense", "condition_handover")).toBe(false);
  });

  it("rejects an expense_receipt on a lease", () => {
    expect(isLegalAttachmentSubjectKindPair("lease", "expense_receipt")).toBe(false);
  });
});

describe("attachmentUploadQuerySchema", () => {
  it("accepts a matching kind/subjectType pair", () => {
    const result = attachmentUploadQuerySchema.safeParse({
      id,
      kind: "expense_receipt",
      subjectType: "expense",
      subjectId,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a mismatched pair with a field-level error on kind, not a raw constraint violation", () => {
    const result = attachmentUploadQuerySchema.safeParse({
      id,
      kind: "condition_handover",
      subjectType: "expense",
      subjectId,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["kind"]);
    }
  });

  it("rejects a non-uuid id", () => {
    const result = attachmentUploadQuerySchema.safeParse({
      id: "not-a-uuid",
      kind: "expense_receipt",
      subjectType: "expense",
      subjectId,
    });
    expect(result.success).toBe(false);
  });
});

describe("ATTACHMENT_CONTENT_TYPES", () => {
  it("is exactly the three formats migration 0013's content_type CHECK allows", () => {
    expect(ATTACHMENT_CONTENT_TYPES).toEqual(["image/jpeg", "image/png", "image/webp"]);
  });
});
