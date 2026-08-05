import { describe, expect, it } from "vitest";
import { createAdjustmentRequestSchema } from "./adjustment.js";

const obligationId = "11111111-1111-4111-8111-111111111111";

describe("createAdjustmentRequestSchema", () => {
  it("accepts a late fee with sign +1", () => {
    const result = createAdjustmentRequestSchema.safeParse({
      obligationId,
      adjustmentType: "late_fee",
      amountMinor: "5000",
      sign: 1,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a waiver with sign -1", () => {
    const result = createAdjustmentRequestSchema.safeParse({
      obligationId,
      adjustmentType: "waiver",
      amountMinor: "34000",
      sign: -1,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a waiver with sign +1 — a waiver always reduces what is owed", () => {
    const result = createAdjustmentRequestSchema.safeParse({
      obligationId,
      adjustmentType: "waiver",
      amountMinor: "34000",
      sign: 1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a zero amount", () => {
    const result = createAdjustmentRequestSchema.safeParse({
      obligationId,
      adjustmentType: "goodwill",
      amountMinor: "0",
      sign: -1,
    });
    expect(result.success).toBe(false);
  });
});
